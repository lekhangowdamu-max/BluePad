import type { BluetoothDevice, ConnectedDevice, ConnectionStatus, Note } from '../types'
export type { ConnectionStatus } from '../types'

const DEVICE_NAME_KEY = 'bluepad-device-name'
const DEVICE_ID_KEY = 'bluepad-device-id'
const HOST_CHANNEL = 'bluepad-host-channel'
const NOTE_CHANNEL_PREFIX = 'bluepad-note-'

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
  private reconnectTimer?: number
  private hosts = new Map<string, BluetoothDevice>()
  private connectedDevices = new Map<string, ConnectedDevice>()
  private pendingOpenRequests = new Map<string, (note: Note) => void>()
  private isHost = false
  private connectedHostId?: string
  private readonly deviceId: string

  constructor() {
    this.deviceId = this.getOrCreateDeviceId()
  }

  initialize(callbacks: ConnectionCallbacks) {
    this.callbacks = callbacks
    this.setStatus(this.getBrowserWarning() ? 'Bluetooth Unsupported' : 'Disconnected')
    this.openHostDiscoveryChannel()
    this.reconnectTimer = window.setInterval(() => {
      if (this.connectedHostId) {
        this.setStatus('Reconnecting')
        window.setTimeout(() => this.setStatus('Connected'), 600)
      }
    }, 15000)
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
      return 'Bluetooth features require Chrome or Edge.'
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
    this.announceTimer = window.setInterval(() => this.announceHost(), 2500)
    this.setStatus('Host Running')
    this.callbacks?.onHostMessage?.('BluePad Host Running')
  }

  async scanForHosts() {
    this.openHostDiscoveryChannel()
    this.announceHostProbe()

    if ('bluetooth' in navigator && typeof navigator.bluetooth?.requestDevice === 'function') {
      try {
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ namePrefix: 'BluePad' }],
          optionalServices: ['0000feed-0000-1000-8000-00805f9b34fb'],
        })
        const host: BluetoothDevice = {
          id: device.id,
          deviceName: device.name || 'BluePad Host',
          isTrusted: true,
          status: 'Available',
        }
        this.hosts.set(host.id, host)
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

    this.connectedHostId = host.id
    host.status = 'Connected'
    this.hostChannel?.postMessage({
      type: 'client-join',
      id: this.deviceId,
      deviceName: this.getDeviceName(),
    } satisfies ClientJoin)
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
        this.hosts.set(event.data.id, {
          id: event.data.id,
          deviceName: event.data.deviceName,
          isTrusted: true,
          status: this.connectedHostId === event.data.id ? 'Connected' : 'Available',
        })
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
    } satisfies HostAnnouncement)
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
