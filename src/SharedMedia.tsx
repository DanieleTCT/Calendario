import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './lib/supabase'

type SharedFile = { name: string; metadata: { size?: number } | null }
type Playback = { object_path: string; position_seconds: number; playing: boolean; updated_at: string; server_now: string }

const bucket = 'family-shared'
const maxFileSize = 50 * 1024 * 1024

function displayName(name: string) {
  return name.replace(/^[0-9a-f-]{36}_/i, '')
}

function positionAt(playback: Playback, receivedAt: number) {
  return Math.max(0, playback.position_seconds + (playback.playing
    ? (Date.parse(playback.server_now) - Date.parse(playback.updated_at) + Date.now() - receivedAt) / 1000
    : 0))
}

export function SharedMedia({ calendarId, canEdit }: { calendarId: string; canEdit: boolean }) {
  const [files, setFiles] = useState<SharedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [joined, setJoined] = useState(false)
  const [mediaUrl, setMediaUrl] = useState('')
  const [seek, setSeek] = useState('0')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const mediaRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const roomRef = useRef<{ state: Playback; receivedAt: number } | null>(null)
  const signedRef = useRef<{ path: string; expiresAt: number } | null>(null)
  const requestRef = useRef(0)

  const loadFiles = useCallback(async () => {
    if (!supabase) return
    const all: SharedFile[] = []
    let offset = 0
    for (;;) {
      const { data, error: listError } = await supabase.storage.from(bucket).list(calendarId, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
      if (listError) { setError(`Impossibile caricare i file: ${listError.message}`); return }
      const page = data ?? []
      all.push(...page.filter((file) => file.id !== null))
      if (page.length < 100) break
      offset += page.length
    }
    setFiles(all)
  }, [calendarId])

  const applyPlayback = useCallback(() => {
    const element = mediaRef.current
    const room = roomRef.current
    if (!element || !room || !element.src || element.readyState === 0) return
    const target = positionAt(room.state, room.receivedAt)
    const duration = Number.isFinite(element.duration) ? element.duration : Infinity
    const bounded = Math.min(target, duration)
    if (Math.abs(element.currentTime - bounded) > 1.5) element.currentTime = bounded
    if (room.state.playing && target < duration) {
      if (element.paused) void element.play().catch(() => setNotice('Il browser ha bloccato la riproduzione automatica: premi “Attiva riproduzione” sul dispositivo.'))
    } else if (!element.paused) element.pause()
  }, [])

  const loadPlayback = useCallback(async () => {
    if (!supabase) return
    const request = ++requestRef.current
    const start = Date.now()
    const { data, error: roomError } = await supabase.rpc('get_shared_playback', { p_calendar_id: calendarId })
    if (request !== requestRef.current) return
    if (roomError) { setError(`Impossibile sincronizzare la riproduzione: ${roomError.message}`); return }
    const state: Playback | null = data?.[0] ?? null
    const receivedAt = Date.now() - (Date.now() - start) / 2
    setPlayback(state)
    roomRef.current = state ? { state, receivedAt } : null
    if (!state) {
      signedRef.current = null
      setMediaUrl('')
      return
    }
    if (joined && (signedRef.current?.path !== state.object_path || signedRef.current.expiresAt < Date.now())) {
      const { data: signed, error: urlError } = await supabase.storage.from(bucket).createSignedUrl(state.object_path, 3600)
      if (request !== requestRef.current) return
      if (urlError || !signed) { setError(`Impossibile aprire il file condiviso: ${urlError?.message ?? 'URL non disponibile'}`); return }
      signedRef.current = { path: state.object_path, expiresAt: Date.now() + 50 * 60 * 1000 }
      setMediaUrl(signed.signedUrl)
    } else if (joined) applyPlayback()
  }, [calendarId, joined, applyPlayback])

  useEffect(() => {
    void loadFiles()
    void loadPlayback()
    const timer = window.setInterval(() => { void loadPlayback() }, 3000)
    return () => { ++requestRef.current; window.clearInterval(timer) }
  }, [loadFiles, loadPlayback])

  const upload = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !selectedFile) return
    if (selectedFile.size > maxFileSize) { setError('Il file supera il limite di 50 MB.'); return }
    const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file'
    const path = `${calendarId}/${crypto.randomUUID()}_${safeName}`
    setBusy(true); setError(''); setNotice('')
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, selectedFile, { contentType: selectedFile.type || 'application/octet-stream' })
    if (uploadError) setError(`Impossibile caricare il file: ${uploadError.message}`)
    else {
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setNotice('File caricato nello spazio.')
      await loadFiles()
    }
    setBusy(false)
  }

  const download = async (name: string) => {
    if (!supabase) return
    setError('')
    const { data, error: urlError } = await supabase.storage.from(bucket).createSignedUrl(`${calendarId}/${name}`, 60, { download: displayName(name) })
    if (urlError || !data) { setError(`Impossibile scaricare il file: ${urlError?.message ?? 'URL non disponibile'}`); return }
    window.location.assign(data.signedUrl)
  }

  const remove = async (name: string) => {
    if (!supabase || !window.confirm(`Eliminare ${displayName(name)} per tutti i membri?`)) return
    const path = `${calendarId}/${name}`
    setBusy(true); setError('')
    const { data: removed, error: deleteError } = await supabase.storage.from(bucket).remove([path])
    if (deleteError) setError(`Impossibile eliminare il file: ${deleteError.message}`)
    else if (!removed?.length) setError('File non eliminato: potrebbe non essere più disponibile o modificabile.')
    else {
      const { error: clearError } = await supabase.rpc('clear_shared_playback', { p_calendar_id: calendarId, p_object_path: path })
      if (clearError) setError(`File eliminato, ma impossibile aggiornare la riproduzione: ${clearError.message}`)
      await Promise.all([loadFiles(), loadPlayback()])
    }
    setBusy(false)
  }

  const control = async (path: string, position: number, playing: boolean) => {
    if (!supabase) return
    setBusy(true); setError('')
    const { error: controlError } = await supabase.rpc('set_shared_playback', {
      p_calendar_id: calendarId, p_object_path: path, p_position: position, p_playing: playing,
    })
    if (controlError) setError(`Impossibile controllare la riproduzione: ${controlError.message}`)
    else await loadPlayback()
    setBusy(false)
  }

  return <section className="feature-page">
    <header className="feature-hero"><span className="feature-kicker">IL VOSTRO SPAZIO</span><h2>File e riproduzione condivisa</h2><p>Un posto per i vostri file, musica e video.</p></header>
    <p>I file sono visibili a tutti i membri dello spazio. Gli editor possono caricarli, eliminarli e controllare la riproduzione.</p>
    {error && <p className="form-message form-error" role="alert">{error}</p>}
    {notice && <p className="form-message form-notice" role="status">{notice}</p>}
    {canEdit && <details className="feature-card disclosure-card" open><summary>Carica un file</summary><form className="feature-form" onSubmit={(event) => void upload(event)}>
      <label>File (massimo 50 MB)<input ref={fileInputRef} type="file" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></label>
      <button className="primary-button" disabled={busy || !selectedFile}>Carica</button>
    </form></details>}
    <details className="feature-card disclosure-card" open><summary>File dello spazio <span className="count-pill">{files.length}</span></summary>
      {files.length === 0 ? <p>Nessun file caricato.</p> : files.map((file) => <div className="feature-row" key={file.name}>
        <span>{displayName(file.name)}{typeof file.metadata?.size === 'number' ? ` · ${(file.metadata.size / 1048576).toFixed(1)} MB` : ''}</span>
        <button disabled={busy} onClick={() => void download(file.name)}>Scarica</button>
        {canEdit && <><button disabled={busy} onClick={() => void control(`${calendarId}/${file.name}`, 0, false)}>Seleziona per riprodurre</button><button disabled={busy} onClick={() => void remove(file.name)}>Elimina</button></>}
      </div>)}
    </details>
    <details className="feature-card disclosure-card" open>
      <summary>Riproduzione sincronizzata</summary>
      <p>Ogni dispositivo deve aprire questa sezione e attivare la riproduzione. Sono supportati i formati audio e video riproducibili dal browser; la sincronizzazione è approssimativa e dipende dalla rete.</p>
      <p>{playback ? `${displayName(playback.object_path.split('/').pop() ?? '')} · ${playback.playing ? 'in riproduzione' : 'in pausa'}` : 'Nessun file selezionato.'}</p>
      <button className="primary-button" onClick={() => {
        setJoined((current) => !current)
        if (joined) { mediaRef.current?.pause(); signedRef.current = null; setMediaUrl('') }
      }}>{joined ? 'Esci dalla riproduzione' : 'Partecipa alla riproduzione'}</button>
      {joined && <><video ref={mediaRef} src={mediaUrl || undefined} controls playsInline onLoadedMetadata={applyPlayback} onError={() => { if (mediaUrl) setError('Il browser non riesce a riprodurre questo file o formato.') }} />
        <button onClick={() => {
          if (!mediaRef.current || !playback?.playing) { setNotice('Attendi che un editor avvii la riproduzione.'); return }
          void mediaRef.current.play().then(() => setNotice('')).catch(() => setNotice('Il browser non riesce ad avviare la riproduzione su questo dispositivo.'))
        }}>Attiva riproduzione</button>
      </>}
      {canEdit && playback && <div className="feature-row">
        <button disabled={busy} onClick={() => void control(playback.object_path, roomRef.current ? positionAt(roomRef.current.state, roomRef.current.receivedAt) : playback.position_seconds, !playback.playing)}>{playback.playing ? 'Pausa per tutti' : 'Riproduci per tutti'}</button>
        <label>Vai al secondo <input type="number" min="0" max="604800" step="1" value={seek} onChange={(event) => setSeek(event.target.value)} /></label>
        <button disabled={busy || seek === '' || !Number.isFinite(Number(seek)) || Number(seek) < 0 || Number(seek) > 604800} onClick={() => void control(playback.object_path, Number(seek), playback.playing)}>Vai</button>
      </div>}
    </details>
  </section>
}
