import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { FolderOpen, Mic, MicOff, Phone, PhoneOff, PlayCircle, Radio, UsersRound, Video, VideoOff, Volume2, VolumeX } from 'lucide-react'
import * as tus from 'tus-js-client'
import { supabase } from './lib/supabase'

type SharedFile = { name: string; metadata: { size?: number } | null }
type Playback = { object_path: string; position_seconds: number; playing: boolean; updated_at: string; server_now: string }
type LiveStream = { peerId: string; title: string }
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
  { id: 'files', label: 'File dello spazio', icon: FolderOpen },
  { id: 'playback', label: 'Riproduzione', icon: PlayCircle },
  { id: 'live', label: 'Diretta', icon: Radio },
  { id: 'call', label: 'Chiamata', icon: Phone },
] as const
type MediaTab = typeof mediaTabs[number]['id']

function displayName(name: string) {
  return name.replace(/^[0-9a-f-]{36}_/i, '')
}

function positionAt(playback: Playback, receivedAt: number) {
  return Math.max(0, playback.position_seconds + (playback.playing
    ? (Date.parse(playback.server_now) - Date.parse(playback.updated_at) + Date.now() - receivedAt) / 1000
    : 0))
}

export function SharedMedia({ calendarId, canEdit, memberName }: { calendarId: string; canEdit: boolean; memberName: string }) {
  const [activeTab, setActiveTab] = useState<MediaTab>('files')
  const tabsId = useId()
  const [files, setFiles] = useState<SharedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [playback, setPlayback] = useState<Playback | null>(null)
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
  const [seek, setSeek] = useState('0')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [channelReady, setChannelReady] = useState(false)
  const mediaRef = useRef<HTMLVideoElement>(null)
  const hostMediaRef = useRef<HTMLVideoElement>(null)
  const remoteMediaRef = useRef<HTMLVideoElement>(null)
  const localCallMediaRef = useRef<HTMLVideoElement>(null)
  const remoteCallMediaRefs = useRef(new Map<string, HTMLVideoElement>())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const roomRef = useRef<{ state: Playback; receivedAt: number } | null>(null)
  const signedRef = useRef<{ path: string; expiresAt: number } | null>(null)
  const requestRef = useRef(0)
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
    if (localCallMediaRef.current) localCallMediaRef.current.srcObject = localCallStream
  }, [localCallStream])

  useEffect(() => {
    for (const peer of callPeers) {
      const element = remoteCallMediaRefs.current.get(peer.peerId)
      if (!element || !peer.stream) continue
      element.srcObject = peer.stream
      void element.play().catch(() => setNotice('Tocca il video del partecipante per attivare l’audio della chiamata.'))
    }
  }, [callPeers])

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

  return <section className="feature-page">
    <header className="feature-hero"><span className="feature-kicker">IL VOSTRO SPAZIO</span><h2>File e riproduzione condivisa</h2><p>Un posto per i vostri file, musica e video.</p></header>
    {error && <p className="form-message form-error" role="alert">{error}</p>}
    {notice && <p className="form-message form-notice" role="status">{notice}</p>}
    <div className="media-tabs" role="tablist" aria-label="File e riproduzione" onKeyDown={navigateTabs}>
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
      ><Icon size={17} aria-hidden="true" />{label}{id === 'files' && <span className="count-pill">{files.length}</span>}{id === 'live' && streamHost && <span className="media-live-indicator">Live</span>}{id === 'call' && inCall && <span className="media-live-indicator">In chiamata</span>}</button>)}
    </div>
    <section id={`${tabsId}-panel-files`} role="tabpanel" aria-labelledby={`${tabsId}-tab-files`} tabIndex={0} hidden={activeTab !== 'files'}>
      <div className="feature-card">
        <h3>File dello spazio <span className="count-pill">{files.length}</span></h3>
        <p>I file sono visibili a tutti i membri dello spazio. Gli editor possono caricarli, eliminarli e selezionarli per la riproduzione. I caricamenti cloud restano soggetti al limite del progetto Supabase.</p>
        {files.length === 0 ? <p>Nessun file caricato.</p> : files.map((file) => <div className="feature-row" key={file.name}>
          <span>{displayName(file.name)}{typeof file.metadata?.size === 'number' ? ` · ${(file.metadata.size / 1048576).toFixed(1)} MB` : ''}</span>
          <button disabled={busy} onClick={() => void download(file.name)}>Scarica</button>
          {canEdit && <><button disabled={busy} onClick={() => void control(`${calendarId}/${file.name}`, 0, false)}>Seleziona per riprodurre</button><button disabled={busy} onClick={() => void remove(file.name)}>Elimina</button></>}
        </div>)}
      </div>
      {canEdit && <div className="feature-card"><h3>Carica un file</h3><form className="feature-form" onSubmit={(event) => void upload(event)}>
        <label>File<input ref={fileInputRef} type="file" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></label>
        {uploadProgress !== null && <p role="status">Caricamento riprendibile: {uploadProgress}%</p>}
        <button className="primary-button" disabled={busy || !selectedFile}>Carica</button>
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
      {streamMode && <><p>Stai trasmettendo: <strong>{hostTitleRef.current}</strong>{streamMode === 'file' ? '. Lascia aperta questa pagina e avvia la riproduzione nel lettore.' : '. Puoi passare a un’altra scheda o app; la condivisione resta attiva finché non la interrompi.'}</p>
        <video ref={hostMediaRef} src={streamMode === 'file' ? streamUrl : undefined} muted={streamMode === 'display'} autoPlay={streamMode === 'display'} controls={streamMode === 'file'} playsInline onLoadedMetadata={captureHostStream} />
        <button onClick={stopStreaming}>Interrompi streaming</button>
      </>}
      {!streamMode && streamHost && streamHost.peerId !== peerIdRef.current && <div className="feature-row">
        <span>In diretta: {streamHost.title}</span>
        {!watchingStream ? <button onClick={joinStream}>Guarda lo streaming</button> : <button onClick={leaveStream}>Esci dallo streaming</button>}
      </div>}
      {watchingStream && !remoteStream && <p role="status">Connessione all’host in corso…</p>}
      {remoteStream && <video ref={remoteMediaRef} controls playsInline />}
      <p>La connessione usa WebRTC diretto; alcune reti o browser possono impedirla. La riproduzione e il punto di avanzamento sono controllati dall’host.</p>
    </div>
    </section>
    <section id={`${tabsId}-panel-playback`} role="tabpanel" aria-labelledby={`${tabsId}-tab-playback`} tabIndex={0} hidden={activeTab !== 'playback'}>
    <div className="feature-card">
      <h3>Riproduzione sincronizzata</h3>
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
    </div>
    </section>
    <section id={`${tabsId}-panel-call`} role="tabpanel" aria-labelledby={`${tabsId}-tab-call`} tabIndex={0} hidden={activeTab !== 'call'}>
      <div className="feature-card media-call-card">
        <div className="media-call-heading">
          <div><h3>Chiamata del gruppo</h3><p>Parlate mentre guardate un video; la riproduzione resta attiva passando tra le schede.</p></div>
          <span className="count-pill"><UsersRound size={14} /> {inCall ? callPeers.length + 1 : 0}/{maxCallParticipants}</span>
        </div>
        {inCall ? <div className="media-call-grid">
          <article className="media-call-tile media-call-self">
            {localCallStream && <video ref={localCallMediaRef} className={!cameraEnabled ? 'media-call-video-hidden' : ''} autoPlay muted playsInline />}
            {!cameraEnabled && <div className="media-call-placeholder"><VideoOff size={28} /><span>Videocamera disattivata</span></div>}
            <div className="media-call-tile-label"><span>{memberName} (tu)</span>{micEnabled ? <Mic size={15} /> : <MicOff size={15} />}</div>
          </article>
          {callPeers.map((peer) => <article className="media-call-tile" key={peer.peerId}>
            {peer.stream && <video ref={(element) => {
                if (element) remoteCallMediaRefs.current.set(peer.peerId, element)
                else remoteCallMediaRefs.current.delete(peer.peerId)
            }} className={!peer.videoEnabled ? 'media-call-video-hidden' : ''} autoPlay playsInline controls muted={!speakerEnabled} />}
            {(!peer.videoEnabled || !peer.stream) && <div className="media-call-placeholder"><VideoOff size={28} /><span>{peer.stream ? 'Videocamera disattivata' : 'Connessione in corso…'}</span></div>}
            <div className="media-call-tile-label"><span>{peer.name}</span>{peer.audioEnabled ? <Mic size={15} /> : <MicOff size={15} />}</div>
          </article>)}
          {callPeers.length === 0 && <p className="media-call-waiting">Sei in chiamata. Invia agli altri membri il nome di questo spazio e chiedi loro di aprire la scheda Chiamata.</p>}
        </div> : <div className="media-call-empty">
          <div className="media-call-empty-icon"><Phone size={25} /></div>
          <strong>Una chiamata, senza uscire dal film</strong>
          <p>Avvia o raggiungi la chiamata condivisa con i membri di questo spazio.</p>
          <button className="primary-button" disabled={!channelReady} onClick={() => void startCall()}><Phone size={16} />{channelReady ? 'Entra nella chiamata' : 'Connessione al canale…'}</button>
        </div>}
        {inCall && <div className="media-call-controls">
          <button aria-pressed={!micEnabled} onClick={() => toggleCallTrack('audio')} disabled={!localCallStream?.getAudioTracks().length}>
            {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}{micEnabled ? 'Disattiva microfono' : 'Attiva microfono'}
          </button>
          <button aria-pressed={!cameraEnabled} onClick={() => toggleCallTrack('video')} disabled={!localCallStream?.getVideoTracks().length}>
            {cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}{cameraEnabled ? 'Spegni videocamera' : 'Accendi videocamera'}
          </button>
          <button aria-pressed={!speakerEnabled} onClick={() => setSpeakerEnabled((enabled) => !enabled)}>
            {speakerEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}{speakerEnabled ? 'Disattiva altoparlanti' : 'Attiva altoparlanti'}
          </button>
          <button className="media-call-hangup" onClick={stopCall}><PhoneOff size={18} /> Esci dalla chiamata</button>
        </div>}
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
