import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Heart, Maximize2, Mic, MicOff, Minimize2, Music2, Pause, Phone, PhoneOff, Play, PlayCircle, Radio, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Trash2, UsersRound, Video, VideoOff, Volume2, VolumeX, X } from 'lucide-react'
import * as tus from 'tus-js-client'
import { supabase } from './lib/supabase'

type SharedFile = { name: string; metadata: Record<string, unknown> | null }
type Playback = { object_path: string; position_seconds: number; playing: boolean; updated_at: string; server_now: string }
type LiveStream = { peerId: string; title: string }
type AudioPlaylist = { id: string; calendar_id: string; name: string; is_queue: boolean; created_by: string }
type AudioPlaylistItem = { playlist_id: string; calendar_id: string; object_path: string; position: number; added_by: string; added_at: string }
type AudioPlayerSettings = { calendar_id: string; active_playlist_id: string; shuffle: boolean; repeat_mode: 'off' | 'all' | 'one' }
type StreamSignal = {
  type: 'discover' | 'start' | 'stop' | 'join' | 'leave' | 'offer' | 'answer' | 'ice'
  from: string
  to?: string
  title?: string
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}
type CallSignal = {
  type: 'discover' | 'join' | 'leave' | 'state' | 'offer' | 'answer' | 'ice' | 'full'
  from: string
  to?: string
  name?: string
  audioEnabled?: boolean
  videoEnabled?: boolean
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}
type CallPeer = {
  peerId: string
  name: string
  audioEnabled: boolean
  videoEnabled: boolean
  stream: MediaStream | null
}
type NetworkPriority = 'movie' | 'balanced' | 'call'

const bucket = 'family-shared'
const resumableUploadThreshold = 6 * 1024 * 1024
const maxCallParticipants = 4
const bitrateProfiles: Record<NetworkPriority, { call: number; movie: number }> = {
  movie: { call: 300_000, movie: 1_500_000 },
  balanced: { call: 650_000, movie: 900_000 },
  call: { call: 1_200_000, movie: 400_000 },
}
const mediaTabs = [
  { id: 'files', label: 'Audio player', icon: PlayCircle },
  { id: 'live', label: 'Diretta', icon: Radio },
  { id: 'call', label: 'Chiamata', icon: Phone },
] as const
type MediaTab = typeof mediaTabs[number]['id']

function displayName(name: string) {
  return name.replace(/^[0-9a-f-]{36}_/i, '')
}

function isAudioFile(file: SharedFile) {
  const mimeType = file.metadata?.mimetype ?? file.metadata?.contentType
  return (typeof mimeType === 'string' && mimeType.toLocaleLowerCase().startsWith('audio/'))
    || /\.(mp3|m4a|aac|wav|ogg|opus|flac|wma|aiff)$/i.test(file.name)
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function positionAt(playback: Playback, receivedAt: number) {
  return Math.max(0, playback.position_seconds + (playback.playing
    ? (Date.parse(playback.server_now) - Date.parse(playback.updated_at) + Date.now() - receivedAt) / 1000
    : 0))
}

export function SharedMedia({ calendarId, canEdit, memberName, userId }: { calendarId: string; canEdit: boolean; memberName: string; userId: string }) {
  const [activeTab, setActiveTab] = useState<MediaTab>('files')
  const tabsId = useId()
  const [files, setFiles] = useState<SharedFile[]>([])
  const [filesLoaded, setFilesLoaded] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [playlists, setPlaylists] = useState<AudioPlaylist[]>([])
  const [playlistItems, setPlaylistItems] = useState<AudioPlaylistItem[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [playerSettings, setPlayerSettings] = useState<AudioPlayerSettings | null>(null)
  const [playlistName, setPlaylistName] = useState('')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [audioTime, setAudioTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [joined, setJoined] = useState(false)
  const [mediaUrl, setMediaUrl] = useState('')
  const [streamFile, setStreamFile] = useState<File | null>(null)
  const [streamUrl, setStreamUrl] = useState('')
  const [streamMode, setStreamMode] = useState<'file' | 'display' | null>(null)
  const [streamHost, setStreamHost] = useState<LiveStream | null>(null)
  const [watchingStream, setWatchingStream] = useState(false)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [inCall, setInCall] = useState(false)
  const [localCallStream, setLocalCallStream] = useState<MediaStream | null>(null)
  const [callPeers, setCallPeers] = useState<CallPeer[]>([])
  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [speakerEnabled, setSpeakerEnabled] = useState(true)
  const [networkPriority, setNetworkPriority] = useState<NetworkPriority>('balanced')
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [overlayIncludeSelf, setOverlayIncludeSelf] = useState(true)
  const [overlayPosition, setOverlayPosition] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'custom'>('top-right')
  const [overlayCustomPos, setOverlayCustomPos] = useState({ xPct: 70, yPct: 4 })
  const [overlayWidthPct, setOverlayWidthPct] = useState(28)
  const [overlayOpacity, setOverlayOpacity] = useState(92)
  const [isStageFullscreen, setIsStageFullscreen] = useState(false)
  const liveStageRef = useRef<HTMLDivElement>(null)
  const overlayDragRef = useRef<{ pointerId: number; startX: number; startY: number; originXPct: number; originYPct: number; stageWidth: number; stageHeight: number } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [channelReady, setChannelReady] = useState(false)
  const mediaRef = useRef<HTMLAudioElement>(null)
  const hostMediaRef = useRef<HTMLVideoElement>(null)
  const remoteMediaRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const roomRef = useRef<{ state: Playback; receivedAt: number } | null>(null)
  const signedRef = useRef<{ path: string; expiresAt: number } | null>(null)
  const requestRef = useRef(0)
  const playerDataRequestRef = useRef(0)
  const peerIdRef = useRef(crypto.randomUUID())
  const channelRef = useRef<RealtimeChannel | null>(null)
  const streamUrlRef = useRef('')
  const hostingRef = useRef(false)
  const hostTitleRef = useRef('')
  const hostStreamRef = useRef<MediaStream | null>(null)
  const localCallStreamRef = useRef<MediaStream | null>(null)
  const callActiveRef = useRef(false)
  const callNameRef = useRef(memberName)
  const networkPriorityRef = useRef<NetworkPriority>(networkPriority)
  const hostRef = useRef<LiveStream | null>(null)
  const connectionsRef = useRef(new Map<string, RTCPeerConnection>())
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>())
  const callConnectionsRef = useRef(new Map<string, RTCPeerConnection>())
  const pendingCallCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>())
  const callPeersRef = useRef<CallPeer[]>([])
  callNameRef.current = memberName
  networkPriorityRef.current = networkPriority

  const sendSignal = useCallback(async (signal: StreamSignal) => {
    const channel = channelRef.current
    if (!channel) throw new Error('Canale di streaming non connesso.')
    const status = await channel.send({ type: 'broadcast', event: 'signal', payload: signal })
    if (status !== 'ok') throw new Error(`Segnalazione WebRTC non riuscita (${status}).`)
  }, [])

  const sendCallSignal = useCallback(async (signal: CallSignal) => {
    const channel = channelRef.current
    if (!channel) throw new Error('Canale della chiamata non connesso.')
    const status = await channel.send({ type: 'broadcast', event: 'call-signal', payload: signal })
    if (status !== 'ok') throw new Error(`Segnalazione chiamata non riuscita (${status}).`)
  }, [])

  const updateCallPeer = useCallback((peerId: string, patch: Partial<CallPeer>) => {
    const current = callPeersRef.current
    const index = current.findIndex((peer) => peer.peerId === peerId)
    const existing = index === -1
      ? { peerId, name: 'Partecipante', audioEnabled: true, videoEnabled: true, stream: null }
      : current[index]
    const next = [...current]
    const updated = { ...existing, ...patch }
    if (index === -1) next.push(updated)
    else next[index] = updated
    callPeersRef.current = next
    setCallPeers(next)
  }, [])

  const removeCallPeer = useCallback((peerId: string) => {
    const next = callPeersRef.current.filter((peer) => peer.peerId !== peerId)
    callPeersRef.current = next
    setCallPeers(next)
  }, [])

  const closeCallConnection = useCallback((peerId: string) => {
    const connection = callConnectionsRef.current.get(peerId)
    if (connection) {
      connection.onicecandidate = null
      connection.ontrack = null
      connection.onconnectionstatechange = null
      connection.close()
      callConnectionsRef.current.delete(peerId)
    }
    pendingCallCandidatesRef.current.delete(peerId)
  }, [])

  const applyVideoBitrate = useCallback(async (connection: RTCPeerConnection, kind: 'call' | 'movie', priority = networkPriorityRef.current) => {
    const connectionCount = Math.max(1, kind === 'call' ? callConnectionsRef.current.size : connectionsRef.current.size)
    const bitrate = Math.floor(bitrateProfiles[priority][kind] / connectionCount)
    for (const sender of connection.getSenders()) {
      if (sender.track?.kind !== 'video') continue
      const parameters = sender.getParameters()
      if (!parameters.encodings?.length) throw new Error('Questo browser non permette di regolare il bitrate video in uscita.')
      parameters.encodings[0].maxBitrate = bitrate
      await sender.setParameters(parameters)
    }
  }, [])

  const applyConnectionBitrates = useCallback(async (kind: 'call' | 'movie', priority = networkPriorityRef.current) => {
    const connections = kind === 'call' ? [...callConnectionsRef.current.values()] : [...connectionsRef.current.values()]
    await Promise.all(connections.map((connection) => applyVideoBitrate(connection, kind, priority)))
  }, [applyVideoBitrate])

  const closeConnection = useCallback((peerId: string) => {
    const connection = connectionsRef.current.get(peerId)
    if (connection) {
      connection.onicecandidate = null
      connection.ontrack = null
      connection.onconnectionstatechange = null
      connection.close()
      connectionsRef.current.delete(peerId)
    }
    pendingCandidatesRef.current.delete(peerId)
  }, [])

  const createConnection = useCallback((peerId: string) => {
    closeConnection(peerId)
    const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    connectionsRef.current.set(peerId, connection)
    connection.onicecandidate = (event) => {
      if (!event.candidate) return
      void sendSignal({ type: 'ice', from: peerIdRef.current, to: peerId, candidate: event.candidate.toJSON() })
        .catch((signalError: unknown) => setError(`Impossibile inviare i dati di connessione: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`))
    }
    connection.ontrack = (event) => {
      if (!hostingRef.current) {
        setRemoteStream(event.streams[0] ?? new MediaStream([event.track]))
        setWatchingStream(true)
      }
    }
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') {
        setError('Connessione diretta non riuscita. Riprova o verifica che la rete consenta connessioni WebRTC.')
        closeConnection(peerId)
      }
    }
    return connection
  }, [closeConnection, sendSignal])

  const createCallConnection = useCallback((peerId: string) => {
    closeCallConnection(peerId)
    const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    callConnectionsRef.current.set(peerId, connection)
    const stream = localCallStreamRef.current
    if (stream) {
      for (const track of stream.getTracks()) connection.addTrack(track, stream)
    }
    connection.onicecandidate = (event) => {
      if (!event.candidate) return
      void sendCallSignal({ type: 'ice', from: peerIdRef.current, to: peerId, candidate: event.candidate.toJSON() })
        .catch((signalError: unknown) => setError(`Impossibile inviare i dati della chiamata: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`))
    }
    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      updateCallPeer(peerId, { stream })
    }
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') {
        setError('Connessione della chiamata non riuscita. Verifica la rete o riprova.')
        closeCallConnection(peerId)
        removeCallPeer(peerId)
      }
    }
    return connection
  }, [closeCallConnection, removeCallPeer, sendCallSignal, updateCallPeer])

  const stopCall = useCallback(() => {
    if (callActiveRef.current) {
      void sendCallSignal({ type: 'leave', from: peerIdRef.current })
        .catch((signalError: unknown) => setError(`Impossibile notificare l’uscita dalla chiamata: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`))
    }
    callActiveRef.current = false
    localCallStreamRef.current?.getTracks().forEach((track) => track.stop())
    localCallStreamRef.current = null
    setLocalCallStream(null)
    setInCall(false)
    setMicEnabled(true)
    setCameraEnabled(true)
    setSpeakerEnabled(true)
    for (const peerId of callConnectionsRef.current.keys()) closeCallConnection(peerId)
    callPeersRef.current = []
    setCallPeers([])
  }, [closeCallConnection, sendCallSignal])

  const handleCallSignal = useCallback(async (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const signal = payload as Partial<CallSignal>
    const self = peerIdRef.current
    const validTypes: CallSignal['type'][] = ['discover', 'join', 'leave', 'state', 'offer', 'answer', 'ice', 'full']
    if (typeof signal.type !== 'string' || typeof signal.from !== 'string'
      || signal.from === self || signal.from.length > 64 || !validTypes.includes(signal.type as CallSignal['type'])) return
    if (signal.to && signal.to !== self) return

    const audioEnabled = localCallStreamRef.current?.getAudioTracks().some((track) => track.enabled) ?? false
    const videoEnabled = localCallStreamRef.current?.getVideoTracks().some((track) => track.enabled) ?? false
    const announcePresence = async (type: 'discover' | 'join', to?: string) => sendCallSignal({
      type,
      from: self,
      to,
      name: callNameRef.current.slice(0, 48),
      audioEnabled,
      videoEnabled,
    })

    if (signal.type === 'discover') {
      if (!callActiveRef.current) return
      const knownPeer = callPeersRef.current.some((peer) => peer.peerId === signal.from)
      if (!knownPeer && callPeersRef.current.length >= maxCallParticipants - 1) {
        await sendCallSignal({ type: 'full', from: self, to: signal.from })
        return
      }
      updateCallPeer(signal.from, {
        name: typeof signal.name === 'string' ? signal.name.slice(0, 48) : 'Partecipante',
        audioEnabled: signal.audioEnabled !== false,
        videoEnabled: signal.videoEnabled !== false,
      })
      await announcePresence('join', signal.from)
      if (self.localeCompare(signal.from) < 0 && !callConnectionsRef.current.has(signal.from)) {
        const connection = createCallConnection(signal.from)
        await applyConnectionBitrates('call')
        const description = await connection.createOffer()
        await connection.setLocalDescription(description)
        await sendCallSignal({ type: 'offer', from: self, to: signal.from, description: connection.localDescription?.toJSON() })
      }
      return
    }
    if (signal.type === 'join') {
      if (!callActiveRef.current || signal.to !== self) return
      const knownPeer = callPeersRef.current.some((peer) => peer.peerId === signal.from)
      if (!knownPeer && callPeersRef.current.length >= maxCallParticipants - 1) {
        await sendCallSignal({ type: 'full', from: self, to: signal.from })
        return
      }
      updateCallPeer(signal.from, {
        name: typeof signal.name === 'string' ? signal.name.slice(0, 48) : 'Partecipante',
        audioEnabled: signal.audioEnabled !== false,
        videoEnabled: signal.videoEnabled !== false,
      })
      if (self.localeCompare(signal.from) < 0 && !callConnectionsRef.current.has(signal.from)) {
        const connection = createCallConnection(signal.from)
        await applyConnectionBitrates('call')
        const description = await connection.createOffer()
        await connection.setLocalDescription(description)
        await sendCallSignal({ type: 'offer', from: self, to: signal.from, description: connection.localDescription?.toJSON() })
      }
      return
    }
    if (signal.type === 'full') {
      if (callActiveRef.current) {
        setError(`La chiamata è al completo (massimo ${maxCallParticipants} partecipanti).`)
        stopCall()
      }
      return
    }
    if (signal.type === 'leave') {
      closeCallConnection(signal.from)
      removeCallPeer(signal.from)
      return
    }
    if (signal.type === 'state') {
      updateCallPeer(signal.from, {
        audioEnabled: signal.audioEnabled === true,
        videoEnabled: signal.videoEnabled === true,
      })
      return
    }
    if (signal.type === 'offer' && signal.description && callActiveRef.current) {
      const connection = createCallConnection(signal.from)
      await applyConnectionBitrates('call')
      await connection.setRemoteDescription(signal.description)
      for (const candidate of pendingCallCandidatesRef.current.get(signal.from) ?? []) {
        await connection.addIceCandidate(candidate)
      }
      pendingCallCandidatesRef.current.delete(signal.from)
      const description = await connection.createAnswer()
      await connection.setLocalDescription(description)
      await sendCallSignal({ type: 'answer', from: self, to: signal.from, description: connection.localDescription?.toJSON() })
      return
    }
    if (signal.type === 'answer' && signal.description) {
      const connection = callConnectionsRef.current.get(signal.from)
      if (!connection) return
      await connection.setRemoteDescription(signal.description)
      for (const candidate of pendingCallCandidatesRef.current.get(signal.from) ?? []) {
        await connection.addIceCandidate(candidate)
      }
      pendingCallCandidatesRef.current.delete(signal.from)
      return
    }
    if (signal.type === 'ice' && signal.candidate) {
      const connection = callConnectionsRef.current.get(signal.from)
      if (connection?.remoteDescription) await connection.addIceCandidate(signal.candidate)
      else {
        const queued = pendingCallCandidatesRef.current.get(signal.from) ?? []
        queued.push(signal.candidate)
        pendingCallCandidatesRef.current.set(signal.from, queued)
      }
    }
  }, [applyConnectionBitrates, closeCallConnection, createCallConnection, removeCallPeer, sendCallSignal, stopCall, updateCallPeer])

  const handleSignal = useCallback(async (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const signal = payload as Partial<StreamSignal>
    const self = peerIdRef.current
    if (typeof signal.type !== 'string' || typeof signal.from !== 'string' || signal.from === self) return
    if (signal.to && signal.to !== self) return
    if (signal.from.length > 64 || !['discover', 'start', 'stop', 'join', 'leave', 'offer', 'answer', 'ice'].includes(signal.type)) return

    if (signal.type === 'discover' && hostingRef.current && hostStreamRef.current) {
      await sendSignal({ type: 'start', from: self, to: signal.from, title: hostTitleRef.current })
      return
    }
    if (signal.type === 'start' && typeof signal.title === 'string') {
      if (hostRef.current && hostRef.current.peerId !== signal.from) return
      const activeHost = { peerId: signal.from, title: signal.title }
      hostRef.current = activeHost
      setStreamHost(activeHost)
      return
    }
    if (signal.type === 'stop') {
      if (hostRef.current?.peerId === signal.from) {
        hostRef.current = null
        setStreamHost(null)
        setWatchingStream(false)
        setRemoteStream(null)
        closeConnection(signal.from)
      }
      return
    }
    if (signal.type === 'join' && hostingRef.current && hostStreamRef.current) {
      createConnection(signal.from)
      const connection = connectionsRef.current.get(signal.from)
      if (!connection) throw new Error('Connessione del flusso non disponibile.')
      for (const track of hostStreamRef.current.getTracks()) connection.addTrack(track, hostStreamRef.current)
      await applyConnectionBitrates('movie')
      const description = await connection.createOffer()
      await connection.setLocalDescription(description)
      await sendSignal({ type: 'offer', from: self, to: signal.from, description: connection.localDescription?.toJSON() })
      return
    }
    if (signal.type === 'leave') {
      closeConnection(signal.from)
      return
    }
    if (signal.type === 'offer' && signal.description) {
      const connection = createConnection(signal.from)
      connection.ontrack = (event) => {
        setRemoteStream(event.streams[0] ?? new MediaStream([event.track]))
        setWatchingStream(true)
      }
      await connection.setRemoteDescription(signal.description)
      for (const candidate of pendingCandidatesRef.current.get(signal.from) ?? []) {
        await connection.addIceCandidate(candidate)
      }
      pendingCandidatesRef.current.delete(signal.from)
      const description = await connection.createAnswer()
      await connection.setLocalDescription(description)
      await sendSignal({ type: 'answer', from: self, to: signal.from, description: connection.localDescription?.toJSON() })
      return
    }
    if (signal.type === 'answer' && signal.description) {
      const connection = connectionsRef.current.get(signal.from)
      if (!connection) return
      await connection.setRemoteDescription(signal.description)
      for (const candidate of pendingCandidatesRef.current.get(signal.from) ?? []) {
        await connection.addIceCandidate(candidate)
      }
      pendingCandidatesRef.current.delete(signal.from)
      return
    }
    if (signal.type === 'ice' && signal.candidate) {
      const connection = connectionsRef.current.get(signal.from)
      if (connection?.remoteDescription) await connection.addIceCandidate(signal.candidate)
      else {
        const queued = pendingCandidatesRef.current.get(signal.from) ?? []
        queued.push(signal.candidate)
        pendingCandidatesRef.current.set(signal.from, queued)
      }
    }
  }, [applyConnectionBitrates, closeConnection, createConnection, sendSignal])

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const channel = client.channel(`shared-stream:${calendarId}`, { config: { private: true } })
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        void handleSignal(payload).catch((signalError: unknown) => {
          setError(`Errore nella connessione streaming: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`)
        })
      })
      .on('broadcast', { event: 'call-signal' }, ({ payload }) => {
        void handleCallSignal(payload).catch((signalError: unknown) => {
          setError(`Errore nella chiamata: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`)
        })
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setChannelReady(true)
          void sendSignal({ type: 'discover', from: peerIdRef.current }).catch((signalError: unknown) => {
            setError(`Impossibile cercare uno streaming attivo: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`)
          })
          if (callActiveRef.current) {
            const audioEnabled = localCallStreamRef.current?.getAudioTracks().some((track) => track.enabled) ?? false
            const videoEnabled = localCallStreamRef.current?.getVideoTracks().some((track) => track.enabled) ?? false
            void sendCallSignal({
              type: 'discover',
              from: peerIdRef.current,
              name: callNameRef.current.slice(0, 48),
              audioEnabled,
              videoEnabled,
            }).catch((signalError: unknown) => {
              setError(`Impossibile cercare una chiamata attiva: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`)
            })
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setChannelReady(false)
          setError('Canale streaming non disponibile. Controlla la connessione e i permessi Realtime.')
        }
      })
    channelRef.current = channel
    return () => {
      if (hostingRef.current) {
        void channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'stop', from: peerIdRef.current } })
      }
      if (callActiveRef.current) {
        void channel.send({ type: 'broadcast', event: 'call-signal', payload: { type: 'leave', from: peerIdRef.current } })
      }
      callActiveRef.current = false
      localCallStreamRef.current?.getTracks().forEach((track) => track.stop())
      localCallStreamRef.current = null
      for (const peerId of callConnectionsRef.current.keys()) closeCallConnection(peerId)
      callPeersRef.current = []
      channelRef.current = null
      for (const peerId of connectionsRef.current.keys()) closeConnection(peerId)
      hostStreamRef.current?.getTracks().forEach((track) => track.stop())
      hostStreamRef.current = null
      if (streamUrlRef.current) URL.revokeObjectURL(streamUrlRef.current)
      void client.removeChannel(channel)
    }
  }, [calendarId, closeCallConnection, closeConnection, handleCallSignal, handleSignal, sendCallSignal, sendSignal])

  useEffect(() => {
    if (!remoteMediaRef.current || !remoteStream) return
    remoteMediaRef.current.srcObject = remoteStream
    void remoteMediaRef.current.play().catch(() => setNotice('Premi Riproduci nel lettore per avviare lo streaming.'))
  }, [remoteStream])

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.volume = volume
  }, [volume])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsStageFullscreen(document.fullscreenElement === liveStageRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([
      applyConnectionBitrates('call', networkPriority),
      applyConnectionBitrates('movie', networkPriority),
    ])
      .catch((bitrateError: unknown) => {
        if (active) setError(`Impossibile applicare la priorità di banda: ${bitrateError instanceof Error ? bitrateError.message : 'errore sconosciuto'}`)
      })
    return () => { active = false }
  }, [applyConnectionBitrates, callPeers.length, networkPriority])

  useEffect(() => {
    if (streamMode !== 'display' || !hostMediaRef.current) return
    hostMediaRef.current.srcObject = hostStreamRef.current
    void hostMediaRef.current.play().catch(() => setNotice('L’anteprima non si è avviata automaticamente.'))
    return () => {
      if (hostMediaRef.current) hostMediaRef.current.srcObject = null
    }
  }, [streamMode])

  const startCall = async () => {
    if (!channelReady) {
      setError('Attendi la connessione al canale del calendario prima di avviare la chiamata.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Questo browser non supporta chiamate audio/video. Usa un browser aggiornato su HTTPS.')
      return
    }
    setError('')
    setNotice('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } },
      })
      if (!stream.getAudioTracks().length && !stream.getVideoTracks().length) {
        stream.getTracks().forEach((track) => track.stop())
        throw new Error('Nessun microfono o videocamera disponibile.')
      }
      localCallStreamRef.current = stream
      callActiveRef.current = true
      setLocalCallStream(stream)
      setInCall(true)
      const audio = stream.getAudioTracks().some((track) => track.enabled)
      const video = stream.getVideoTracks().some((track) => track.enabled)
      setMicEnabled(audio)
      setCameraEnabled(video)
      await sendCallSignal({
        type: 'discover',
        from: peerIdRef.current,
        name: callNameRef.current.slice(0, 48),
        audioEnabled: audio,
        videoEnabled: video,
      })
    } catch (callError) {
      stopCall()
      if (callError instanceof DOMException && callError.name === 'NotAllowedError') {
        setError('Permetti l’accesso a microfono e videocamera per iniziare la chiamata.')
      } else {
        setError(`Impossibile avviare la chiamata: ${callError instanceof Error ? callError.message : 'errore sconosciuto'}`)
      }
    }
  }

  const toggleCallTrack = (kind: 'audio' | 'video') => {
    const tracks = kind === 'audio'
      ? localCallStreamRef.current?.getAudioTracks()
      : localCallStreamRef.current?.getVideoTracks()
    const track = tracks?.[0]
    if (!track) return
    track.enabled = !track.enabled
    if (kind === 'audio') setMicEnabled(track.enabled)
    else setCameraEnabled(track.enabled)
    const audioEnabled = localCallStreamRef.current?.getAudioTracks().some((item) => item.enabled) ?? false
    const videoEnabled = localCallStreamRef.current?.getVideoTracks().some((item) => item.enabled) ?? false
    void sendCallSignal({
      type: 'state',
      from: peerIdRef.current,
      audioEnabled,
      videoEnabled,
    }).catch((signalError: unknown) => setError(`Impossibile aggiornare la chiamata: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`))
  }

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
    setFilesLoaded(true)
  }, [calendarId])

  const applyPlayback = useCallback(() => {
    const element = mediaRef.current
    const room = roomRef.current
    if (!element || !room || !element.src || element.readyState === 0) return
    const target = positionAt(room.state, room.receivedAt)
    const duration = Number.isFinite(element.duration) ? element.duration : Infinity
    const bounded = Math.min(target, duration)
    if (Math.abs(element.currentTime - bounded) > 1.5) element.currentTime = bounded
    setAudioTime(bounded)
    if (room.state.playing && target < duration) {
      if (element.paused) void element.play().catch(() => setNotice('Il browser ha bloccato la riproduzione automatica: premi “Attiva riproduzione” sul dispositivo.'))
    } else if (!element.paused) element.pause()
  }, [])

  const loadPlayback = useCallback(async (forceJoin = false) => {
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
    const objectName = state.object_path.split('/').pop() ?? ''
    const file = files.find((entry) => `${calendarId}/${entry.name}` === state.object_path)
    if ((file && !isAudioFile(file)) || (filesLoaded && !file && !isAudioFile({ name: objectName, metadata: null }))) {
      setMediaUrl('')
      setNotice('La riproduzione condivisa è un video o un file non audio: usa la sezione Diretta.')
      return
    }
    const shouldJoin = joined || forceJoin
    if (shouldJoin && (signedRef.current?.path !== state.object_path || signedRef.current.expiresAt < Date.now())) {
      const { data: signed, error: urlError } = await supabase.storage.from(bucket).createSignedUrl(state.object_path, 3600)
      if (request !== requestRef.current) return
      if (urlError || !signed) { setError(`Impossibile aprire il file condiviso: ${urlError?.message ?? 'URL non disponibile'}`); return }
      signedRef.current = { path: state.object_path, expiresAt: Date.now() + 50 * 60 * 1000 }
      setMediaUrl(signed.signedUrl)
    } else if (shouldJoin) applyPlayback()
  }, [calendarId, files, filesLoaded, joined, applyPlayback])

  const loadPlayerData = useCallback(async () => {
    if (!supabase) return
    const request = ++playerDataRequestRef.current
    const [playlistResult, settingsResult, favoritesResult] = await Promise.all([
      supabase.from('shared_audio_playlists').select('id, calendar_id, name, is_queue, created_by').eq('calendar_id', calendarId).order('is_queue', { ascending: false }).order('name'),
      supabase.from('shared_audio_player_settings').select('calendar_id, active_playlist_id, shuffle, repeat_mode').eq('calendar_id', calendarId),
      supabase.from('shared_audio_favorites').select('object_path').eq('calendar_id', calendarId).eq('user_id', userId),
    ])
    if (request !== playerDataRequestRef.current) return
    if (playlistResult.error) { setError(`Impossibile caricare le playlist: ${playlistResult.error.message}`); return }
    if (settingsResult.error) { setError(`Impossibile caricare le impostazioni del player: ${settingsResult.error.message}`); return }
    if (favoritesResult.error) { setError(`Impossibile caricare i preferiti: ${favoritesResult.error.message}`); return }

    const loadedPlaylists = (playlistResult.data ?? []) as AudioPlaylist[]
    const queue = loadedPlaylists.find((playlist) => playlist.is_queue)
    if (!queue) {
      setError('La coda audio condivisa non è configurata. Applica lo schema Supabase aggiornato.')
      return
    }
    const state = ((settingsResult.data ?? [])[0] as AudioPlayerSettings | undefined) ?? {
      calendar_id: calendarId,
      active_playlist_id: queue.id,
      shuffle: false,
      repeat_mode: 'off' as const,
    }
    const activePlaylist = loadedPlaylists.some((playlist) => playlist.id === state.active_playlist_id)
      ? state.active_playlist_id
      : queue.id
    const { data: trackRows, error: tracksError } = await supabase
      .from('shared_audio_playlist_items')
      .select('playlist_id, calendar_id, object_path, position, added_by, added_at')
      .eq('playlist_id', activePlaylist)
      .order('position')
      .order('added_at')
    if (request !== playerDataRequestRef.current) return
    if (tracksError) { setError(`Impossibile caricare la coda audio: ${tracksError.message}`); return }
    setPlaylists(loadedPlaylists)
    setPlayerSettings({ ...state, active_playlist_id: activePlaylist })
    setPlaylistItems((trackRows ?? []) as AudioPlaylistItem[])
    setFavorites((favoritesResult.data ?? []).map((favorite) => favorite.object_path as string))
  }, [calendarId, userId])

  useEffect(() => {
    void loadFiles()
    void loadPlayback()
    void loadPlayerData()
    const playbackTimer = window.setInterval(() => { void loadPlayback() }, 3000)
    const playerDataTimer = window.setInterval(() => { void loadPlayerData() }, 5000)
    return () => {
      ++requestRef.current
      ++playerDataRequestRef.current
      window.clearInterval(playbackTimer)
      window.clearInterval(playerDataTimer)
    }
  }, [loadFiles, loadPlayback, loadPlayerData])

  const upload = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !selectedFile) return
    const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file'
    const path = `${calendarId}/${crypto.randomUUID()}_${safeName}`
    setBusy(true); setError(''); setNotice('')
    setUploadProgress(selectedFile.size > resumableUploadThreshold ? 0 : null)
    try {
      const contentType = selectedFile.type || 'application/octet-stream'
      if (selectedFile.size > resumableUploadThreshold) {
        const [{ data: sessionData, error: sessionError }, projectUrl] = await Promise.all([
          supabase.auth.getSession(),
          Promise.resolve(import.meta.env.VITE_SUPABASE_URL as string | undefined),
        ])
        const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
        if (sessionError) throw sessionError
        if (!sessionData.session || !projectUrl || !apiKey) throw new Error('Sessione, URL o chiave Supabase non disponibile.')
        await new Promise<void>((resolve, reject) => {
          const uploadTask = new tus.Upload(selectedFile, {
            endpoint: `${projectUrl.replace(/\/$/, '')}/storage/v1/upload/resumable`,
            headers: { authorization: `Bearer ${sessionData.session.access_token}`, apikey: apiKey },
            metadata: { bucketName: bucket, objectName: path, contentType, cacheControl: '3600' },
            chunkSize: resumableUploadThreshold,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            removeFingerprintOnSuccess: true,
            onError: reject,
            onProgress: (uploaded, total) => setUploadProgress(Math.floor((uploaded / total) * 100)),
            onSuccess: () => resolve(),
          })
          uploadTask.start()
        })
      } else {
        const { error: uploadError } = await supabase.storage.from(bucket).upload(path, selectedFile, { contentType })
        if (uploadError) throw uploadError
      }
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setNotice('File caricato nello spazio.')
      await loadFiles()
    } catch (uploadError) {
      setError(`Impossibile caricare il file: ${uploadError instanceof Error ? uploadError.message : 'errore sconosciuto'}`)
    } finally {
      setUploadProgress(null)
      setBusy(false)
    }
  }

  const startStreaming = () => {
    if (!streamFile) return
    const url = URL.createObjectURL(streamFile)
    streamUrlRef.current = url
    hostTitleRef.current = streamFile.name
    hostingRef.current = true
    setStreamMode('file')
    const activeHost = { peerId: peerIdRef.current, title: streamFile.name }
    hostRef.current = activeHost
    setStreamUrl(url)
    setStreamHost(activeHost)
    setWatchingStream(false)
    setRemoteStream(null)
    setError('')
    setNotice('Apri il lettore e premi Riproduci: chi entra riceverà lo streaming in diretta.')
  }

  const stopStreaming = () => {
    void sendSignal({ type: 'stop', from: peerIdRef.current })
      .catch((signalError: unknown) => setError(`Impossibile notificare la chiusura dello streaming: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`))
    hostingRef.current = false
    hostStreamRef.current?.getTracks().forEach((track) => track.stop())
    hostStreamRef.current = null
    for (const peerId of connectionsRef.current.keys()) closeConnection(peerId)
    hostMediaRef.current?.pause()
    if (hostMediaRef.current) hostMediaRef.current.srcObject = null
    if (streamUrlRef.current) URL.revokeObjectURL(streamUrlRef.current)
    streamUrlRef.current = ''
    setStreamUrl('')
    setStreamMode(null)
    hostRef.current = null
    setStreamHost(null)
    setWatchingStream(false)
    setRemoteStream(null)
  }

  const startDisplayStreaming = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Questo browser non supporta la condivisione di schede o schermi. Prova con un browser aggiornato su HTTPS.')
      return
    }
    setError('')
    setNotice('')
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: true,
      })
      const videoTrack = captured.getVideoTracks()[0]
      if (!videoTrack) {
        captured.getTracks().forEach((track) => track.stop())
        throw new Error('Il browser non ha restituito una traccia video.')
      }

      const title = 'Scheda, finestra o schermo condiviso'
      hostStreamRef.current = captured
      hostTitleRef.current = title
      hostingRef.current = true
      setStreamMode('display')
      setStreamUrl('')
      setStreamFile(null)
      setWatchingStream(false)
      setRemoteStream(null)
      const activeHost = { peerId: peerIdRef.current, title }
      hostRef.current = activeHost
      setStreamHost(activeHost)
      videoTrack.onended = () => {
        stopStreaming()
        setNotice('La condivisione è stata terminata dal browser.')
      }
      void sendSignal({ type: 'start', from: peerIdRef.current, title })
        .catch((signalError: unknown) => setError(`Impossibile annunciare lo streaming: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`))
    } catch (captureError) {
      if (captureError instanceof DOMException && (captureError.name === 'NotAllowedError' || captureError.name === 'AbortError')) {
        setNotice('Condivisione annullata o non autorizzata.')
      } else {
        setError(`Impossibile condividere la scheda o lo schermo: ${captureError instanceof Error ? captureError.message : 'errore sconosciuto'}`)
      }
    }
  }

  const captureHostStream = () => {
    const element = hostMediaRef.current
    if (!element || hostStreamRef.current) return
    const mediaElement = element as HTMLVideoElement & {
      captureStream?: () => MediaStream
      mozCaptureStream?: () => MediaStream
    }
    const capture = mediaElement.captureStream ?? mediaElement.mozCaptureStream
    if (!capture) {
      setError('Questo browser non supporta lo streaming dal file locale. Prova con un browser aggiornato.')
      return
    }
    try {
      hostStreamRef.current = capture.call(element)
      setStreamMode('file')
      setStreamHost({ peerId: peerIdRef.current, title: hostTitleRef.current })
      void sendSignal({ type: 'start', from: peerIdRef.current, title: hostTitleRef.current })
        .catch((signalError: unknown) => setError(`Impossibile annunciare lo streaming: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`))
    } catch (captureError) {
      setError(`Impossibile avviare lo streaming del file: ${captureError instanceof Error ? captureError.message : 'errore sconosciuto'}`)
    }
  }

  const joinStream = () => {
    const host = hostRef.current
    if (!host || host.peerId === peerIdRef.current) return
    setWatchingStream(true)
    setError('')
    void sendSignal({ type: 'join', from: peerIdRef.current, to: host.peerId })
      .catch((signalError: unknown) => setError(`Impossibile collegarsi allo streaming: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`))
  }

  const leaveStream = () => {
    const host = hostRef.current
    if (host) {
      void sendSignal({ type: 'leave', from: peerIdRef.current, to: host.peerId })
        .catch((signalError: unknown) => setError(`Impossibile notificare l'uscita dallo streaming: ${signalError instanceof Error ? signalError.message : 'errore sconosciuto'}`))
      closeConnection(host.peerId)
    }
    setWatchingStream(false)
    setRemoteStream(null)
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
      const { error: cleanupError } = await supabase.rpc('remove_shared_audio_path', { p_calendar_id: calendarId, p_object_path: path })
      if (cleanupError) setError(`File eliminato, ma impossibile aggiornare playlist e player: ${cleanupError.message}`)
      await Promise.all([loadFiles(), loadPlayerData(), loadPlayback()])
    }
    setBusy(false)
  }

  const control = async (path: string, position: number, playing: boolean, joinPlayer = false) => {
    if (!supabase) return
    setBusy(true); setError('')
    const { error: controlError } = await supabase.rpc('set_shared_playback', {
      p_calendar_id: calendarId, p_object_path: path, p_position: position, p_playing: playing,
    })
    if (controlError) setError(`Impossibile controllare la riproduzione: ${controlError.message}`)
    else await loadPlayback(joinPlayer)
    setBusy(false)
  }

  const updatePlayerSettings = async (change: Partial<AudioPlayerSettings>) => {
    if (!supabase || !playerSettings) return
    const next = { ...playerSettings, ...change }
    setPlayerSettings(next)
    const { error: settingsError } = await supabase
      .from('shared_audio_player_settings')
      .update({ active_playlist_id: next.active_playlist_id, shuffle: next.shuffle, repeat_mode: next.repeat_mode })
      .eq('calendar_id', calendarId)
    if (settingsError) {
      setError(`Impossibile aggiornare il player condiviso: ${settingsError.message}`)
      await loadPlayerData()
    }
  }

  const addAudioToPlaylist = async (file: SharedFile, playlistId = playerSettings?.active_playlist_id) => {
    if (!supabase || !playlistId) return
    const path = `${calendarId}/${file.name}`
    const { error: addError } = await supabase.rpc('add_shared_audio_playlist_item', {
      p_calendar_id: calendarId,
      p_playlist_id: playlistId,
      p_object_path: path,
    })
    if (addError) {
      setError(`Impossibile aggiungere il brano alla playlist: ${addError.message}`)
      return
    }
    await loadPlayerData()
  }

  const playAudioFile = async (file: SharedFile) => {
    if (!supabase || !playerSettings) {
      setError('La playlist condivisa non è pronta.')
      return
    }
    const path = `${calendarId}/${file.name}`
    if (!playlistItems.some((item) => item.object_path === path)) {
      const { error: addError } = await supabase.rpc('add_shared_audio_playlist_item', {
        p_calendar_id: calendarId,
        p_playlist_id: playerSettings.active_playlist_id,
        p_object_path: path,
      })
      if (addError) {
        setError(`Impossibile aggiungere il brano alla coda: ${addError.message}`)
        return
      }
      await loadPlayerData()
    }
    setJoined(true)
    await control(path, 0, true, true)
  }

  const skipTrack = async (direction: -1 | 1) => {
    if (!supabase || !playback) return
    const element = mediaRef.current
    if (direction === -1 && element && element.currentTime > 3) {
      await control(playback.object_path, 0, true, true)
      return
    }
    const { error: advanceError } = await supabase.rpc('advance_shared_playback', {
      p_calendar_id: calendarId,
      p_current_path: playback.object_path,
      p_direction: direction,
    })
    if (advanceError) setError(`Impossibile cambiare brano: ${advanceError.message}`)
    else {
      setJoined(true)
      await loadPlayback(true)
    }
  }

  const toggleFavorite = async (file: SharedFile) => {
    if (!supabase) return
    const path = `${calendarId}/${file.name}`
    const isFavorite = favorites.includes(path)
    const { error: favoriteError } = isFavorite
      ? await supabase.from('shared_audio_favorites').delete().eq('calendar_id', calendarId).eq('user_id', userId).eq('object_path', path)
      : await supabase.from('shared_audio_favorites').insert({ calendar_id: calendarId, user_id: userId, object_path: path })
    if (favoriteError) setError(`Impossibile aggiornare i preferiti: ${favoriteError.message}`)
    else await loadPlayerData()
  }

  const createPlaylist = async (event: FormEvent) => {
    event.preventDefault()
    const name = playlistName.trim()
    if (!supabase || !name) return
    const id = crypto.randomUUID()
    const { error: createError } = await supabase.from('shared_audio_playlists').insert({
      id, calendar_id: calendarId, name, is_queue: false, created_by: userId,
    })
    if (createError) {
      setError(`Impossibile creare la playlist: ${createError.message}`)
      return
    }
    setPlaylistName('')
    await loadPlayerData()
  }

  const selectPlaylist = async (playlistId: string) => {
    if (!supabase) return
    await updatePlayerSettings({ active_playlist_id: playlistId })
    const { data: tracks, error: tracksError } = await supabase
      .from('shared_audio_playlist_items')
      .select('object_path, position')
      .eq('playlist_id', playlistId)
      .order('position')
    if (tracksError) {
      setError(`Impossibile aprire la playlist: ${tracksError.message}`)
      return
    }
    const paths = (tracks ?? []).map((track) => track.object_path as string)
    if (playback && !paths.includes(playback.object_path)) {
      if (paths.length) await control(paths[0], 0, playback.playing, joined)
      else {
        const { error: clearError } = await supabase.rpc('clear_shared_playback', {
          p_calendar_id: calendarId, p_object_path: playback.object_path,
        })
        if (clearError) setError(`Impossibile svuotare il player: ${clearError.message}`)
        else await loadPlayback()
      }
    }
    await loadPlayerData()
  }

  const deletePlaylist = async (playlist: AudioPlaylist) => {
    if (!supabase || playlist.is_queue) return
    const queue = playlists.find((entry) => entry.is_queue)
    if (!queue || !window.confirm(`Eliminare la playlist “${playlist.name}” per tutti i membri?`)) return
    if (playerSettings?.active_playlist_id === playlist.id) await selectPlaylist(queue.id)
    const { error: deleteError } = await supabase.from('shared_audio_playlists').delete().eq('id', playlist.id)
    if (deleteError) setError(`Impossibile eliminare la playlist: ${deleteError.message}`)
    else await loadPlayerData()
  }

  const removePlaylistItem = async (item: AudioPlaylistItem) => {
    if (!supabase) return
    const { error: removeError } = await supabase.rpc('remove_shared_audio_playlist_item', {
      p_calendar_id: calendarId, p_playlist_id: item.playlist_id, p_object_path: item.object_path,
    })
    if (removeError) setError(`Impossibile rimuovere il brano: ${removeError.message}`)
    else {
      await Promise.all([loadPlayerData(), loadPlayback(joined)])
    }
  }

  const movePlaylistItem = async (item: AudioPlaylistItem, delta: -1 | 1) => {
    if (!supabase) return
    const index = playlistItems.findIndex((entry) => entry.object_path === item.object_path)
    const nextPosition = index + delta
    if (index < 0 || nextPosition < 0 || nextPosition >= playlistItems.length) return
    const { error: moveError } = await supabase.rpc('move_shared_audio_playlist_item', {
      p_calendar_id: calendarId,
      p_playlist_id: item.playlist_id,
      p_object_path: item.object_path,
      p_new_position: nextPosition,
    })
    if (moveError) setError(`Impossibile riordinare la playlist: ${moveError.message}`)
    else await loadPlayerData()
  }

  const audioFiles = files.filter(isAudioFile)
  const otherFiles = files.filter((file) => !isAudioFile(file))
  const activePlaylist = playlists.find((playlist) => playlist.id === playerSettings?.active_playlist_id)
  const visibleAudioFiles = audioFiles.filter((file) => {
    const query = libraryQuery.trim().toLocaleLowerCase('it-IT')
    return !query || displayName(file.name).toLocaleLowerCase('it-IT').includes(query)
  })
  const currentFileName = playback?.object_path.split('/').pop() ?? ''

  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = mediaTabs.findIndex((tab) => tab.id === activeTab)
    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight': nextIndex = (index + 1) % mediaTabs.length; break
      case 'ArrowLeft': nextIndex = (index + mediaTabs.length - 1) % mediaTabs.length; break
      case 'Home': nextIndex = 0; break
      case 'End': nextIndex = mediaTabs.length - 1; break
      default: return
    }
    event.preventDefault()
    setActiveTab(mediaTabs[nextIndex].id)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
  }

  const hasLiveVideo = Boolean(streamMode || remoteStream)

  const beginOverlayDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button')) return
    const stage = liveStageRef.current
    if (!stage) return
    const stageRect = stage.getBoundingClientRect()
    const overlayRect = event.currentTarget.closest('.live-call-overlay')?.getBoundingClientRect()
    const originXPct = overlayPosition === 'custom'
      ? overlayCustomPos.xPct
      : overlayRect && stageRect.width > 0
        ? ((overlayRect.left - stageRect.left) / stageRect.width) * 100
        : 65
    const originYPct = overlayPosition === 'custom'
      ? overlayCustomPos.yPct
      : overlayRect && stageRect.height > 0
        ? ((overlayRect.top - stageRect.top) / stageRect.height) * 100
        : 4
    event.currentTarget.setPointerCapture(event.pointerId)
    overlayDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originXPct,
      originYPct,
      stageWidth: Math.max(1, stageRect.width),
      stageHeight: Math.max(1, stageRect.height),
    }
  }

  const moveOverlayDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = overlayDragRef.current
    if (!active || active.pointerId !== event.pointerId) return
    const dxPct = ((event.clientX - active.startX) / active.stageWidth) * 100
    const dyPct = ((event.clientY - active.startY) / active.stageHeight) * 100
    const maxX = Math.max(5, 100 - overlayWidthPct)
    setOverlayPosition('custom')
    setOverlayCustomPos({
      xPct: Math.max(1, Math.min(maxX, active.originXPct + dxPct)),
      yPct: Math.max(1, Math.min(78, active.originYPct + dyPct)),
    })
  }

  const endOverlayDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = overlayDragRef.current
    if (!active || active.pointerId !== event.pointerId) return
    overlayDragRef.current = null
  }

  const toggleStageFullscreen = async () => {
    const stage = liveStageRef.current
    if (!stage) return
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen()
      } else {
        await stage.requestFullscreen()
      }
    } catch {
      setNotice('Schermo intero non disponibile in questo browser.')
    }
  }

  return <section className="feature-page">
    <header className="feature-hero"><span className="feature-kicker">IL VOSTRO SPAZIO</span><h2>Audio player condiviso</h2><p>Una libreria audio e una playlist sincronizzata per il gruppo.</p></header>
    {error && <p className="form-message form-error" role="alert">{error}</p>}
    {notice && <p className="form-message form-notice" role="status">{notice}</p>}
    <div className="media-tabs" role="tablist" aria-label="Player audio, diretta e chiamata" onKeyDown={navigateTabs}>
      {mediaTabs.map(({ id, label, icon: Icon }) => <button
        key={id}
        type="button"
        id={`${tabsId}-tab-${id}`}
        role="tab"
        aria-selected={activeTab === id}
        aria-controls={`${tabsId}-panel-${id}`}
        tabIndex={activeTab === id ? 0 : -1}
        className={activeTab === id ? 'media-tab-active' : ''}
        onClick={() => setActiveTab(id)}
      ><Icon size={17} aria-hidden="true" />{label}{id === 'files' && <span className="count-pill">{audioFiles.length}</span>}{id === 'live' && streamHost && <span className="media-live-indicator">Live</span>}{id === 'call' && inCall && <span className="media-live-indicator">In chiamata</span>}</button>)}
    </div>
    <section id={`${tabsId}-panel-files`} role="tabpanel" aria-labelledby={`${tabsId}-tab-files`} tabIndex={0} hidden={activeTab !== 'files'}>
      <div className="feature-card audio-player-card">
        <div className="audio-player-now">
          <div className="audio-cover"><Music2 size={26} /></div>
          <div className="audio-player-now-copy">
            <strong>{playback ? displayName(currentFileName) : 'Seleziona un brano audio'}</strong>
            <span>{activePlaylist?.name ?? 'Coda condivisa'}{playback ? ` · ${playback.playing ? 'in riproduzione' : 'in pausa'}` : ''}</span>
          </div>
          {playback && <button className={`audio-favorite-button ${favorites.includes(playback.object_path) ? 'audio-favorite-active' : ''}`} aria-label={favorites.includes(playback.object_path) ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'} onClick={() => {
            const file = audioFiles.find((entry) => `${calendarId}/${entry.name}` === playback.object_path)
            if (file) void toggleFavorite(file)
          }}><Heart size={19} fill={favorites.includes(playback.object_path) ? 'currentColor' : 'none'} /></button>}
        </div>
        <audio
          ref={mediaRef}
          className="audio-player-engine"
          src={joined ? mediaUrl || undefined : undefined}
          preload="metadata"
          onLoadedMetadata={() => {
            if (!mediaRef.current) return
            setAudioDuration(Number.isFinite(mediaRef.current.duration) ? mediaRef.current.duration : 0)
            applyPlayback()
          }}
          onTimeUpdate={() => { if (mediaRef.current) setAudioTime(mediaRef.current.currentTime) }}
          onEnded={() => void skipTrack(1)}
          onError={() => { if (mediaUrl) setError('Il browser non riesce a riprodurre questo audio o formato.') }}
        />
        {playback && !joined && <button className="primary-button audio-join-button" onClick={() => {
          setJoined(true)
          void loadPlayback(true)
        }}>Ascolta insieme</button>}
        <div className="audio-player-controls">
          <button className={`audio-mode-button ${playerSettings?.shuffle ? 'audio-mode-active' : ''}`} aria-label={playerSettings?.shuffle ? 'Disattiva casuale' : 'Attiva casuale'} aria-pressed={playerSettings?.shuffle ?? false} disabled={!playerSettings} onClick={() => void updatePlayerSettings({ shuffle: !playerSettings?.shuffle })}><Shuffle size={17} /></button>
          <button aria-label="Brano precedente" disabled={!playback} onClick={() => void skipTrack(-1)}><SkipBack size={20} /></button>
          <button className="audio-main-control" aria-label={playback?.playing ? 'Pausa per tutti' : 'Riproduci per tutti'} disabled={!playback} onClick={() => {
            if (!playback) return
            if (!joined) setJoined(true)
            void control(playback.object_path, mediaRef.current?.currentTime ?? playback.position_seconds, !playback.playing, true)
          }}>{playback?.playing ? <Pause size={20} /> : <Play size={20} />}</button>
          <button aria-label="Brano successivo" disabled={!playback} onClick={() => void skipTrack(1)}><SkipForward size={20} /></button>
          <button className={`audio-mode-button ${playerSettings?.repeat_mode !== 'off' ? 'audio-mode-active' : ''}`} aria-label={`Ripetizione ${playerSettings?.repeat_mode ?? 'off'}`} aria-pressed={playerSettings?.repeat_mode !== 'off'} disabled={!playerSettings} onClick={() => {
            const nextMode = playerSettings?.repeat_mode === 'off' ? 'all' : playerSettings?.repeat_mode === 'all' ? 'one' : 'off'
            void updatePlayerSettings({ repeat_mode: nextMode })
          }}>{playerSettings?.repeat_mode === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}</button>
        </div>
        <div className="audio-progress-row">
          <span>{formatTime(audioTime)}</span>
          <input aria-label="Avanzamento audio" type="range" min="0" max={audioDuration || 0} step="1" value={Math.min(audioTime, audioDuration || 0)} disabled={!joined || !playback || !audioDuration} onChange={(event) => setAudioTime(Number(event.target.value))} onPointerUp={() => {
            if (playback) void control(playback.object_path, audioTime, playback.playing, true)
          }} onKeyUp={() => {
            if (playback) void control(playback.object_path, audioTime, playback.playing, true)
          }} />
          <span>{formatTime(audioDuration)}</span>
          <Volume2 size={16} aria-hidden="true" />
          <input aria-label="Volume audio" className="audio-volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
        </div>
      </div>
      <div className="feature-card audio-library-card">
        <div className="audio-library-heading"><h3>Libreria audio <span className="count-pill">{audioFiles.length}</span></h3><input aria-label="Cerca audio" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Cerca nella libreria" /></div>
        {!audioFiles.length ? <p>Nessun audio nello spazio. Carica un file audio per iniziare.</p> : visibleAudioFiles.length
          ? visibleAudioFiles.map((file) => {
            const path = `${calendarId}/${file.name}`
            const isFavorite = favorites.includes(path)
            return <div className="audio-track-row" key={file.name}>
              <button className="audio-track-play" aria-label={`Riproduci ${displayName(file.name)}`} onClick={() => void playAudioFile(file)}><Play size={16} /></button>
              <span className="audio-track-title">{displayName(file.name)}{typeof file.metadata?.size === 'number' ? <small>{` · ${(file.metadata.size / 1048576).toFixed(1)} MB`}</small> : null}</span>
              <button className={`audio-favorite-button ${isFavorite ? 'audio-favorite-active' : ''}`} aria-label={isFavorite ? `Rimuovi ${displayName(file.name)} dai preferiti` : `Aggiungi ${displayName(file.name)} ai preferiti`} onClick={() => void toggleFavorite(file)}><Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} /></button>
              <button className="audio-add-button" disabled={!playerSettings} onClick={() => void addAudioToPlaylist(file)}>Aggiungi alla playlist</button>
              <button className="audio-download-button" disabled={busy} onClick={() => void download(file.name)}>Scarica</button>
            </div>
          })
          : <p>Nessun audio corrisponde alla ricerca.</p>}
      </div>
      <div className="feature-card audio-queue-card">
        <div className="audio-library-heading">
          <h3>Playlist condivise</h3>
          <select aria-label="Playlist attiva" value={playerSettings?.active_playlist_id ?? ''} onChange={(event) => void selectPlaylist(event.target.value)}>
            {playlists.map((playlist) => <option value={playlist.id} key={playlist.id}>{playlist.name}</option>)}
          </select>
          {activePlaylist && !activePlaylist.is_queue && <button className="delete-button" onClick={() => void deletePlaylist(activePlaylist)}><Trash2 size={15} /> Elimina playlist</button>}
        </div>
        <form className="audio-create-playlist" onSubmit={(event) => void createPlaylist(event)}>
          <input aria-label="Nome nuova playlist" value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} placeholder="Crea una playlist" maxLength={60} />
          <button className="primary-button" disabled={!playlistName.trim()}>Crea playlist</button>
        </form>
        <h4>{activePlaylist?.is_queue ? 'Coda condivisa' : activePlaylist?.name ?? 'Playlist'}</h4>
        {!playlistItems.length ? <p>Playlist vuota. Aggiungi brani dalla libreria audio.</p> : playlistItems.map((item, index) => {
          const file = audioFiles.find((entry) => `${calendarId}/${entry.name}` === item.object_path)
          const isCurrent = playback?.object_path === item.object_path
          return <div className={`audio-track-row ${isCurrent ? 'audio-track-current' : ''}`} key={`${item.playlist_id}:${item.object_path}`}>
            <button className="audio-track-play" aria-label={`Riproduci ${file ? displayName(file.name) : displayName(item.object_path.split('/').pop() ?? '')}`} disabled={!file} onClick={() => file && void playAudioFile(file)}>{isCurrent && playback?.playing ? <Pause size={16} /> : <Play size={16} />}</button>
            <span className="audio-track-title">{file ? displayName(file.name) : displayName(item.object_path.split('/').pop() ?? 'File non disponibile')}</span>
            <button className="audio-order-button" aria-label="Sposta brano in alto" disabled={index === 0} onClick={() => void movePlaylistItem(item, -1)}><SkipBack size={14} /></button>
            <button className="audio-order-button" aria-label="Sposta brano in basso" disabled={index === playlistItems.length - 1} onClick={() => void movePlaylistItem(item, 1)}><SkipForward size={14} /></button>
            <button className="audio-remove-button" aria-label="Rimuovi brano dalla playlist" onClick={() => void removePlaylistItem(item)}><Trash2 size={14} /></button>
          </div>
        })}
      </div>
      {favorites.length > 0 && <details className="feature-card audio-favorites-card"><summary>Preferiti personali <span className="count-pill">{favorites.length}</span></summary>
        {favorites.map((path) => {
          const file = audioFiles.find((entry) => `${calendarId}/${entry.name}` === path)
          return <div className="audio-track-row" key={path}>
            <button className="audio-track-play" aria-label={`Riproduci ${file ? displayName(file.name) : displayName(path.split('/').pop() ?? '')}`} disabled={!file} onClick={() => file && void playAudioFile(file)}><Play size={16} /></button>
            <span className="audio-track-title">{file ? displayName(file.name) : displayName(path.split('/').pop() ?? '')}</span>
            <button className="audio-add-button" disabled={!file} onClick={() => file && void addAudioToPlaylist(file)}>Aggiungi alla playlist</button>
          </div>
        })}
      </details>}
      <details className="feature-card disclosure-card audio-archive">
        <summary>Altri file dello spazio <span className="count-pill">{otherFiles.length}</span></summary>
        <p>Video e documenti restano archiviati e scaricabili qui; per i video in diretta usa la scheda Diretta.</p>
        {otherFiles.length === 0 ? <p>Nessun file non audio.</p> : otherFiles.map((file) => <div className="feature-row" key={file.name}>
          <span>{displayName(file.name)}{typeof file.metadata?.size === 'number' ? ` · ${(file.metadata.size / 1048576).toFixed(1)} MB` : ''}</span>
          <button disabled={busy} onClick={() => void download(file.name)}>Scarica</button>
          {canEdit && <button disabled={busy} onClick={() => void remove(file.name)}>Elimina</button>}
        </div>)}
      </details>
      {canEdit && <div className="feature-card"><h3>Carica un file</h3><form className="feature-form" onSubmit={(event) => void upload(event)}>
        <label>File audio, video o documento<input ref={fileInputRef} type="file" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></label>
        {uploadProgress !== null && <p role="status">Caricamento riprendibile: {uploadProgress}%</p>}
        <button className="primary-button" disabled={busy || !selectedFile}>Carica file</button>
      </form></div>}
    </section>
    <section id={`${tabsId}-panel-live`} role="tabpanel" aria-labelledby={`${tabsId}-tab-live`} tabIndex={0} hidden={activeTab !== 'live'}>
    <div className="feature-card">
      <h3>Streaming in diretta</h3>
      <p>Chiunque appartenga allo spazio può avviare uno streaming dal proprio dispositivo. Il file non viene caricato: l’host deve restare connesso e riprodurlo; gli altri membri si collegano in diretta.</p>
      {!streamMode && <div className="feature-form">
        <label>File audio o video locale<input type="file" accept="audio/*,video/*" disabled={Boolean(streamHost && streamHost.peerId !== peerIdRef.current)} onChange={(event) => setStreamFile(event.target.files?.[0] ?? null)} /></label>
        <button className="primary-button" disabled={!streamFile || Boolean(streamHost && streamHost.peerId !== peerIdRef.current)} onClick={startStreaming}>Diventa host</button>
        <button disabled={Boolean(streamHost && streamHost.peerId !== peerIdRef.current)} onClick={() => void startDisplayStreaming()}>Condividi scheda o schermo</button>
        <p>Scegli una scheda, una finestra o l’intero schermo nel selettore del browser. Se condividi una scheda, la cattura può continuare mentre usi un’altra app; audio e comportamento dipendono dal browser e dalla scelta effettuata.</p>
      </div>}
      {streamMode && <p>Stai trasmettendo: <strong>{hostTitleRef.current}</strong>{streamMode === 'file' ? '. Lascia aperta questa pagina e avvia la riproduzione nel lettore.' : '. Puoi passare a un’altra scheda o app; la condivisione resta attiva finché non la interrompi.'}</p>}
      {watchingStream && !remoteStream && <p role="status">Connessione all’host in corso…</p>}
      {(streamMode || remoteStream) && (
        <div className="live-video-stage" ref={liveStageRef}>
          {streamMode && (
            <video
              ref={hostMediaRef}
              src={streamMode === 'file' ? streamUrl : undefined}
              muted={streamMode === 'display'}
              autoPlay={streamMode === 'display'}
              controls={streamMode === 'file'}
              controlsList="nofullscreen"
              playsInline
              onLoadedMetadata={captureHostStream}
            />
          )}
          {remoteStream && <video ref={remoteMediaRef} controls controlsList="nofullscreen" playsInline />}
          <button
            type="button"
            className="live-fullscreen-btn"
            onClick={() => void toggleStageFullscreen()}
            title={isStageFullscreen ? 'Esci da schermo intero' : 'Schermo intero con telecamere'}
            aria-label={isStageFullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
          >
            {isStageFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          {inCall && overlayVisible && (
            <div
              className={`live-call-overlay live-call-pos-${overlayPosition}`}
              style={{
                width: `${overlayWidthPct}%`,
                opacity: overlayOpacity / 100,
                ...(overlayPosition === 'custom'
                  ? { left: `${overlayCustomPos.xPct}%`, top: `${overlayCustomPos.yPct}%` }
                  : {}),
              }}
              aria-label="Partecipanti chiamata in sovraimpressione"
            >
              <div
                className="live-call-overlay-bar"
                onPointerDown={beginOverlayDrag}
                onPointerMove={moveOverlayDrag}
                onPointerUp={endOverlayDrag}
                onPointerCancel={endOverlayDrag}
              >
                <span>Chiamata · {callPeers.length + 1}/{maxCallParticipants}</span>
                <div className="live-call-overlay-mini-actions">
                  <button type="button" title={micEnabled ? 'Disattiva microfono' : 'Attiva microfono'} onClick={() => toggleCallTrack('audio')}>{micEnabled ? <Mic size={13} /> : <MicOff size={13} />}</button>
                  <button type="button" title={cameraEnabled ? 'Disattiva videocamera' : 'Attiva videocamera'} onClick={() => toggleCallTrack('video')}>{cameraEnabled ? <Video size={13} /> : <VideoOff size={13} />}</button>
                  <button type="button" title="Nascondi telecamere" onClick={() => setOverlayVisible(false)}><X size={13} /></button>
                </div>
              </div>
              <CallStage
                memberName={memberName}
                localStream={localCallStream}
                peers={callPeers}
                cameraEnabled={cameraEnabled}
                micEnabled={micEnabled}
                speakerEnabled={speakerEnabled}
                includeSelf={overlayIncludeSelf}
                compact
              />
            </div>
          )}
        </div>
      )}
      {streamMode && <div className="feature-row"><button onClick={stopStreaming}>Interrompi streaming</button></div>}
      {!streamMode && streamHost && streamHost.peerId !== peerIdRef.current && <div className="feature-row">
        <span>In diretta: {streamHost.title}</span>
        {!watchingStream ? <button onClick={joinStream}>Guarda lo streaming</button> : <button onClick={leaveStream}>Esci dallo streaming</button>}
      </div>}
      {inCall && hasLiveVideo && (
        <div className="live-overlay-controls" aria-label="Controlli sovraimpressione chiamata">
          <div className="live-overlay-toggles">
            <button type="button" className={overlayVisible ? 'primary-button' : ''} onClick={() => setOverlayVisible((v) => !v)}>
              {overlayVisible ? <Video size={15} /> : <VideoOff size={15} />}
              {overlayVisible ? 'Nascondi telecamere' : 'Mostra telecamere'}
            </button>
            <label className="live-overlay-check">
              <input type="checkbox" checked={overlayIncludeSelf} onChange={(event) => setOverlayIncludeSelf(event.target.checked)} />
              <span>Mostra anche te</span>
            </label>
          </div>
          {overlayVisible && (
            <div className="live-overlay-sliders">
              <div className="live-overlay-positions" role="group" aria-label="Posizione telecamere">
                {([
                  ['top-left', 'Alto sx'],
                  ['top-right', 'Alto dx'],
                  ['bottom-left', 'Basso sx'],
                  ['bottom-right', 'Basso dx'],
                ] as const).map(([pos, label]) => (
                  <button
                    key={pos}
                    type="button"
                    className={overlayPosition === pos ? 'live-pos-active' : ''}
                    onClick={() => setOverlayPosition(pos)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label>
                <span>Dimensione ({overlayWidthPct}%)</span>
                <input type="range" min={16} max={55} value={overlayWidthPct} onChange={(event) => setOverlayWidthPct(Number(event.target.value))} />
              </label>
              <label>
                <span>Opacità ({overlayOpacity}%)</span>
                <input type="range" min={25} max={100} value={overlayOpacity} onChange={(event) => setOverlayOpacity(Number(event.target.value))} />
              </label>
            </div>
          )}
        </div>
      )}
      <p>La connessione usa WebRTC diretto; alcune reti o browser possono impedirla. La riproduzione e il punto di avanzamento sono controllati dall’host.</p>
    </div>
    </section>
    <section id={`${tabsId}-panel-call`} role="tabpanel" aria-labelledby={`${tabsId}-tab-call`} tabIndex={0} hidden={activeTab !== 'call'}>
      <div className="feature-card media-call-card">
        <div className="media-call-heading">
          <div><h3>Chiamata del gruppo</h3><p>Parlate mentre guardate un video; la riproduzione resta attiva passando tra le schede.</p></div>
          <span className="count-pill"><UsersRound size={14} /> {inCall ? callPeers.length + 1 : 0}/{maxCallParticipants}</span>
        </div>
        {inCall ? (activeTab === 'live' && hasLiveVideo && overlayVisible
          ? <p className="media-call-popout-note">La chiamata è in sovraimpressione nel riproduttore video della scheda Diretta.</p>
          : <CallStage memberName={memberName} localStream={localCallStream} peers={callPeers} cameraEnabled={cameraEnabled} micEnabled={micEnabled} speakerEnabled={speakerEnabled} />) : <div className="media-call-empty">
          <div className="media-call-empty-icon"><Phone size={25} /></div>
          <strong>Una chiamata, senza uscire dal film</strong>
          <p>Avvia o raggiungi la chiamata condivisa con i membri di questo spazio.</p>
          <button className="primary-button" disabled={!channelReady} onClick={() => void startCall()}><Phone size={16} />{channelReady ? 'Entra nella chiamata' : 'Connessione al canale…'}</button>
        </div>}
        {inCall && <CallControls
          micEnabled={micEnabled}
          cameraEnabled={cameraEnabled}
          speakerEnabled={speakerEnabled}
          onMic={() => toggleCallTrack('audio')}
          onCamera={() => toggleCallTrack('video')}
          onSpeaker={() => setSpeakerEnabled((enabled) => !enabled)}
          onHangup={stopCall}
        />}
        <label className="media-call-quality">Priorità banda in uscita
          <select value={networkPriority} onChange={(event) => {
            const value = event.target.value
            if (value === 'movie' || value === 'balanced' || value === 'call') setNetworkPriority(value)
          }}>
            <option value="movie">Film: 1,5 Mb/s · webcam: 300 kb/s</option>
            <option value="balanced">Bilanciata: film 900 kb/s · webcam 650 kb/s</option>
            <option value="call">Chiamata: webcam 1,2 Mb/s · film 400 kb/s</option>
          </select>
        </label>
        <p className="media-call-note">La qualità imposta un limite massimo al video inviato da questo dispositivo, non garantisce banda minima. Chiamata peer-to-peer fino a {maxCallParticipants} persone; alcune reti possono impedire la connessione diretta. Audio e video sono trasmessi agli altri partecipanti, non registrati né salvati dall’app. Usa microfono e videocamera solo con il consenso delle persone presenti.</p>
      </div>
    </section>
  </section>
}

function CallStage({
  memberName,
  localStream,
  peers,
  cameraEnabled,
  micEnabled,
  speakerEnabled,
  includeSelf = true,
  compact = false,
}: {
  memberName: string
  localStream: MediaStream | null
  peers: CallPeer[]
  cameraEnabled: boolean
  micEnabled: boolean
  speakerEnabled: boolean
  includeSelf?: boolean
  compact?: boolean
}) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const peerVideoRefs = useRef(new Map<string, HTMLVideoElement>())

  const attachLocalVideo = useCallback((element: HTMLVideoElement | null) => {
    localVideoRef.current = element
    if (!element || !localStream) return
    if (element.srcObject !== localStream) element.srcObject = localStream
    void element.play().catch(() => undefined)
  }, [localStream])

  useEffect(() => {
    const element = localVideoRef.current
    if (!element) return
    if (element.srcObject !== localStream) element.srcObject = localStream
    if (localStream) void element.play().catch(() => undefined)
  }, [localStream, includeSelf, cameraEnabled])

  useEffect(() => {
    for (const peer of peers) {
      const video = peerVideoRefs.current.get(peer.peerId)
      if (!video || !peer.stream) continue
      if (video.srcObject !== peer.stream) video.srcObject = peer.stream
      void video.play().catch(() => undefined)
    }
  }, [peers])

  return <div className={`media-call-grid ${compact ? 'media-call-grid-compact' : ''}`}>
    {includeSelf && <article className="media-call-tile media-call-self">
      {localStream && <video ref={attachLocalVideo} className={!cameraEnabled ? 'media-call-video-hidden' : ''} autoPlay muted playsInline />}
      {!cameraEnabled && <div className="media-call-placeholder"><VideoOff size={compact ? 20 : 28} /><span>Videocamera disattivata</span></div>}
      <div className="media-call-tile-label"><span>{memberName} (tu)</span>{micEnabled ? <Mic size={compact ? 13 : 15} /> : <MicOff size={compact ? 13 : 15} />}</div>
    </article>}
    {peers.map((peer) => <article className="media-call-tile" key={peer.peerId}>
      {peer.stream && <video ref={(element) => {
        if (element) peerVideoRefs.current.set(peer.peerId, element)
        else peerVideoRefs.current.delete(peer.peerId)
      }} className={!peer.videoEnabled ? 'media-call-video-hidden' : ''} autoPlay playsInline muted={!speakerEnabled} />}
      {(!peer.videoEnabled || !peer.stream) && <div className="media-call-placeholder"><VideoOff size={compact ? 20 : 28} /><span>{peer.stream ? 'Videocamera disattivata' : 'Connessione in corso…'}</span></div>}
      <div className="media-call-tile-label"><span>{peer.name}</span>{peer.audioEnabled ? <Mic size={compact ? 13 : 15} /> : <MicOff size={compact ? 13 : 15} />}</div>
    </article>)}
    {!includeSelf && peers.length === 0 && <p className="media-call-waiting">In attesa di altri partecipanti in chiamata…</p>}
    {includeSelf && peers.length === 0 && !compact && <p className="media-call-waiting">Sei in chiamata. Gli altri membri possono unirsi dalla scheda Chiamata.</p>}
  </div>
}

function CallControls({
  micEnabled,
  cameraEnabled,
  speakerEnabled,
  onMic,
  onCamera,
  onSpeaker,
  onHangup,
}: {
  micEnabled: boolean
  cameraEnabled: boolean
  speakerEnabled: boolean
  onMic: () => void
  onCamera: () => void
  onSpeaker: () => void
  onHangup: () => void
}) {
  return <div className="media-call-controls">
    <button aria-pressed={!micEnabled} onClick={onMic}>{micEnabled ? <Mic size={17} /> : <MicOff size={17} />}{micEnabled ? 'Microfono' : 'Microfono disattivato'}</button>
    <button aria-pressed={!cameraEnabled} onClick={onCamera}>{cameraEnabled ? <Video size={17} /> : <VideoOff size={17} />}{cameraEnabled ? 'Videocamera' : 'Videocamera disattivata'}</button>
    <button aria-pressed={!speakerEnabled} onClick={onSpeaker}>{speakerEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}{speakerEnabled ? 'Altoparlanti' : 'Audio disattivato'}</button>
    <button className="media-call-hangup" onClick={onHangup}><PhoneOff size={17} />Esci</button>
  </div>
}
