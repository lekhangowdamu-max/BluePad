import type { BluetoothDevice, ConnectedDevice, ConnectionStatus, Note } from '../types'
export type { ConnectionStatus } from '../types'

const DEVICE_NAME_KEY = 'bluepad-device-name'
const DEVICE_ID_KEY = 'bluepad-device-id'
const HOST_CHANNEL = 'bluepad-host-channel'
const NOTE_CHANNEL_PREFIX = 'bluepad-note-'
const HOST_ANNOUNCE_INTERVAL_MS = 2000
const DISCOVERY_INTERVAL_MS = 2000
const RECONNECT_INTERVAL_MS = 5000
const HOST_STALE_MS = 7000

interface ConnectionCallbacks {
  onStatusChange: (status: ConnectionStatus) => void
  onHostsChanged?: (hosts: BluetoothDevice[]) => void
  onConnectedDevicesChanged?: (devices: ConnectedDevice[]) => void
  onNoteSynced?: (note: Note) => void
  onOpenNoteRequested?: (passwordKey: string) => Promise<Note>
  onClientNoteChanged?: (note: Note) => Promise<Note>
  onHostMessage?: (message: string) => void
}

interface HostAnnouncement {
  type: 'host-announcement'
  id: string
  deviceName: string
  sentAt: number
}

interface ClientJoin {
  type: 'client-join'
  id: string
  deviceName: string
}

interface NoteSync {
  type: 'note-sync'
  note: Note
}

interface OpenNoteRequest {
  type: 'open-note-request'
  requestId: string
  clientId: string
  passwordKey: string
}

interface OpenNoteResponse {
  type: 'open-note-response'
  requestId: string
  note: Note
}

interface ClientNoteChange {
  type: 'client-note-change'
  clientId: string
  note: Note
}

type HostChannelMessage = HostAnnouncement | ClientJoin | OpenNoteRequest | OpenNoteResponse | ClientNoteChange
type NoteChannelMessage = NoteSync

const isChromeOrEdge = () => {
  const userAgent = navigator.userAgent
  return (/Chrome\//.test(userAgent) || /Edg\//.test(userAgent)) && !/Firefox\//.test(userAgent) && !/OPR\//.test(userAgent)
}

const makeDefaultName = () => `BluePad User ${Math.floor(1000 + Math.random() * 9000)}`

export class ConnectionManager {
  private callbacks: ConnectionCallbacks | null = null
  private hostChannel?: BroadcastChannel
  private noteChannels = new Map<string, BroadcastChannel>()
  private announceTimer?: number
  private discoveryTimer?: number
  private reconnectTimer?: number
  private hosts = new Map<string, BluetoothDevice>()
  private connectedDevices = new Map<string, ConnectedDevice>()
  private pendingOpenRequests = new Map<string, (note: Note) => void>()
  private isHost = false
  private isScanning = false
  private connectedHostId?: string
  private preferredHostId?: string
  private readonly deviceId: string

  constructor() {
    this.deviceId = this.getOrCreateDeviceId()
  }

  initialize(callbacks: ConnectionCallbacks) {
    this.callbacks = callbacks
    this.setStatus(this.getBrowserWarning() ? 'Bluetooth Unsupported' : 'Disconnected')
    this.openHostDiscoveryChannel()
    this.reconnectTimer = window.setInterval(() => {
      if (!this.preferredHostId || this.isHost) return

      const host = this.hosts.get(this.preferredHostId)
      if (host && !this.isHostStale(host)) {
        this.connectedHostId = host.id
        host.status = 'Connected'
        this.postClientJoin()
        this.setStatus('Connected')
        this.emitHosts()
        return
      }

      if (this.connectedHostId) {
        this.connectedHostId = undefined
      }
      if (host) {
        host.status = 'Reconnecting'
      }
      this.setStatus('Reconnecting')
      this.emitHosts()
    }, RECONNECT_INTERVAL_MS)
  }

  getDeviceId() {
    return this.deviceId
  }

  getDeviceName() {
    const stored = window.localStorage.getItem(DEVICE_NAME_KEY)
    if (stored) return stored
    const generated = makeDefaultName()
    window.localStorage.setItem(DEVICE_NAME_KEY, generated)
    return generated
  }

  setDeviceName(deviceName: string) {
    const cleanName = deviceName.trim() || makeDefaultName()
    window.localStorage.setItem(DEVICE_NAME_KEY, cleanName)
    if (this.isHost) {
      this.announceHost()
    }
  }

  getBrowserWarning() {
    if (!isChromeOrEdge() || !('bluetooth' in navigator)) {
      return 'Bluetooth features work best in Chrome and Edge.'
    }
    return ''
  }

  getConnectedDevices() {
    return Array.from(this.connectedDevices.values())
  }

  getAvailableHosts() {
    return Array.from(this.hosts.values())
  }

  async startHost() {
    this.isHost = true
    this.connectedHostId = this.deviceId
    this.openHostDiscoveryChannel()
    this.announceHost()
    if (this.announceTimer) window.clearInterval(this.announceTimer)
    this.announceTimer = window.setInterval(() => this.announceHost(), HOST_ANNOUNCE_INTERVAL_MS)
    this.setStatus('Host Running')
    this.callbacks?.onHostMessage?.('BluePad Host Running')
  }

  async scanForHosts() {
    this.openHostDiscoveryChannel()
    this.isScanning = true
    this.setStatus('Searching')
    this.announceHostProbe()
    this.startContinuousDiscovery()

    if ('bluetooth' in navigator && typeof navigator.bluetooth?.requestDevice === 'function') {
      try {
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ namePrefix: 'BluePad' }],
          optionalServices: ['0000feed-0000-1000-8000-00805f9b34fb'],
        })
        if (device.name) {
          this.hosts.set(device.id, {
            id: device.id,
            deviceName: device.name,
            isTrusted: true,
            status: 'Online',
            lastSeen: Date.now(),
          })
        }
      } catch {
        // The user can cancel the browser chooser; keep locally discovered hosts.
      }
    }

    this.emitHosts()
    return this.getAvailableHosts()
  }

  connectToHost(hostId: string) {
    const host = this.hosts.get(hostId)
    if (!host) {
      this.setStatus('Disconnected')
      return false
    }

    this.preferredHostId = host.id
    this.setStatus('Connecting')
    host.status = 'Connecting'
    this.emitHosts()

    this.connectedHostId = host.id
    host.status = 'Connected'
    this.postClientJoin()
    this.setStatus('Connected')
    this.emitHosts()
    return true
  }

  openNoteOnHost(passwordKey: string) {
    if (this.isHost) {
      return this.callbacks?.onOpenNoteRequested?.(passwordKey) ?? Promise.reject(new Error('Host note handler is unavailable.'))
    }

    const requestId = crypto.randomUUID()
    return new Promise<Note>((resolve, reject) => {
      if (!this.connectedHostId || !this.hostChannel) {
        reject(new Error('Connect to a BluePad Host first.'))
        return
      }

      const timeout = window.setTimeout(() => {
        this.pendingOpenRequests.delete(requestId)
        reject(new Error('The host did not respond.'))
      }, 8000)

      this.pendingOpenRequests.set(requestId, (note) => {
        window.clearTimeout(timeout)
        resolve(note)
      })

      this.hostChannel.postMessage({
        type: 'open-note-request',
        requestId,
        clientId: this.deviceId,
        passwordKey,
      } satisfies OpenNoteRequest)
    })
  }

  async sendNoteUpdateToHost(note: Note) {
    if (this.isHost) {
      const saved = await this.callbacks?.onClientNoteChanged?.(note)
      if (saved) this.broadcastNote(saved)
      return saved ?? note
    }

    if (!this.connectedHostId || !this.hostChannel) {
      throw new Error('Connect to a BluePad Host first.')
    }

    this.hostChannel.postMessage({
      type: 'client-note-change',
      clientId: this.deviceId,
      note,
    } satisfies ClientNoteChange)
    return note
  }

  subscribeToNote(passwordKey: string) {
    const channelName = `${NOTE_CHANNEL_PREFIX}${passwordKey}`
    if (this.noteChannels.has(channelName)) return

    const channel = new BroadcastChannel(channelName)
    channel.onmessage = (event: MessageEvent<NoteChannelMessage>) => {
      if (event.data.type === 'note-sync') {
        this.callbacks?.onNoteSynced?.(event.data.note)
      }
    }
    this.noteChannels.set(channelName, channel)
  }

  broadcastNote(note: Note) {
    const passwordKey = note.passwordKey ?? note.noteKey
    const channelName = `${NOTE_CHANNEL_PREFIX}${passwordKey}`
    let channel = this.noteChannels.get(channelName)
    if (!channel) {
      channel = new BroadcastChannel(channelName)
      this.noteChannels.set(channelName, channel)
    }
    channel.postMessage({ type: 'note-sync', note } satisfies NoteSync)
  }

  shutdown() {
    if (this.announceTimer) window.clearInterval(this.announceTimer)
    if (this.discoveryTimer) window.clearInterval(this.discoveryTimer)
    if (this.reconnectTimer) window.clearInterval(this.reconnectTimer)
    this.hostChannel?.close()
    this.noteChannels.forEach((channel) => channel.close())
    this.noteChannels.clear()
  }

  private getOrCreateDeviceId() {
    const stored = window.localStorage.getItem(DEVICE_ID_KEY)
    if (stored) return stored
    const next = crypto.randomUUID()
    window.localStorage.setItem(DEVICE_ID_KEY, next)
    return next
  }

  private openHostDiscoveryChannel() {
    if (this.hostChannel) return
    this.hostChannel = new BroadcastChannel(HOST_CHANNEL)
    this.hostChannel.onmessage = (event: MessageEvent<HostChannelMessage>) => {
      if (event.data.type === 'host-announcement' && event.data.id !== this.deviceId) {
        const existing = this.hosts.get(event.data.id)
        this.hosts.set(event.data.id, {
          id: event.data.id,
          deviceName: event.data.deviceName,
          isTrusted: true,
          status: this.connectedHostId === event.data.id ? 'Connected' : 'Online',
          lastSeen: event.data.sentAt,
        })
        if (existing?.status === 'Reconnecting' && this.preferredHostId === event.data.id) {
          this.connectToHost(event.data.id)
        }
        this.emitHosts()
      }

      if (event.data.type === 'client-join' && this.isHost && event.data.id !== this.deviceId) {
        this.connectedDevices.set(event.data.id, {
          id: event.data.id,
          deviceName: event.data.deviceName,
          status: 'Connected',
        })
        this.emitConnectedDevices()
      }

      if (event.data.type === 'open-note-request' && this.isHost && event.data.clientId !== this.deviceId) {
        const { passwordKey, requestId } = event.data
        void this.callbacks?.onOpenNoteRequested?.(passwordKey).then((note) => {
          this.hostChannel?.postMessage({
            type: 'open-note-response',
            requestId,
            note,
          } satisfies OpenNoteResponse)
        })
      }

      if (event.data.type === 'open-note-response') {
        const resolver = this.pendingOpenRequests.get(event.data.requestId)
        if (resolver) {
          this.pendingOpenRequests.delete(event.data.requestId)
          resolver(event.data.note)
        }
      }

      if (event.data.type === 'client-note-change' && this.isHost && event.data.clientId !== this.deviceId) {
        void this.callbacks?.onClientNoteChanged?.(event.data.note).then((saved) => {
          if (saved) this.broadcastNote(saved)
        })
      }
    }
  }

  private announceHostProbe() {
    if (this.isHost) {
      this.announceHost()
    }
  }

  private announceHost() {
    this.hostChannel?.postMessage({
      type: 'host-announcement',
      id: this.deviceId,
      deviceName: this.getDeviceName(),
      sentAt: Date.now(),
    } satisfies HostAnnouncement)
  }

  private postClientJoin() {
    this.hostChannel?.postMessage({
      type: 'client-join',
      id: this.deviceId,
      deviceName: this.getDeviceName(),
    } satisfies ClientJoin)
  }

  private startContinuousDiscovery() {
    if (this.discoveryTimer) return
    this.discoveryTimer = window.setInterval(() => {
      if (!this.isScanning) return
      this.announceHostProbe()
      this.pruneStaleHosts()
      this.emitHosts()
    }, DISCOVERY_INTERVAL_MS)
  }

  private pruneStaleHosts() {
    const now = Date.now()
    this.hosts.forEach((host) => {
      if (this.isHostStale(host, now)) {
        host.status = this.preferredHostId === host.id ? 'Reconnecting' : 'Disconnected'
      } else if (host.status !== 'Connected' && host.status !== 'Connecting') {
        host.status = 'Online'
      }
    })
  }

  private isHostStale(host: BluetoothDevice, now = Date.now()) {
    return Boolean(host.lastSeen && now - host.lastSeen > HOST_STALE_MS)
  }

  private emitHosts() {
    this.callbacks?.onHostsChanged?.(this.getAvailableHosts())
  }

  private emitConnectedDevices() {
    this.callbacks?.onConnectedDevicesChanged?.(this.getConnectedDevices())
  }

  private setStatus(status: ConnectionStatus) {
    this.callbacks?.onStatusChange(status)
  }
}
