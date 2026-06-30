import { invoke } from '@tauri-apps/api/core'
import type { BluetoothDevice, ConnectedDevice, ConnectionStatus, Note } from '../types'
export type { ConnectionStatus } from '../types'

const DEVICE_NAME_KEY = 'bluepad-device-name'
const DEVICE_ID_KEY = 'bluepad-device-id'
const RECONNECT_INTERVAL_MS = 5000
const POLL_INTERVAL_MS = 750

interface ConnectionCallbacks {
  onStatusChange: (status: ConnectionStatus) => void
  onHostsChanged?: (hosts: BluetoothDevice[]) => void
  onConnectedDevicesChanged?: (devices: ConnectedDevice[]) => void
  onNoteSynced?: (note: Note) => void
  onOpenNoteRequested?: (passwordKey: string) => Promise<Note>
  onClientNoteChanged?: (note: Note) => Promise<Note>
  onHostMessage?: (message: string) => void
}

interface NativeHostInfo {
  id: string
  device_name: string
  address: string
  port: number
  status: string
}

interface NativeTransportMessage {
  from: string
  from_name: string
  payload: {
    type: string
    requestId?: string
    clientId?: string
    passwordKey?: string
    note?: Note
    deviceId?: string
    deviceName?: string
    hostId?: string
    status?: string
    payload?: Record<string, unknown>
  }
}

const makeDefaultName = () => `BluePad User ${Math.floor(1000 + Math.random() * 9000)}`

export class ConnectionManager {
  private callbacks: ConnectionCallbacks | null = null
  private reconnectTimer?: number
  private pollTimer?: number
  private hosts = new Map<string, BluetoothDevice>()
  private connectedDevices = new Map<string, ConnectedDevice>()
  private pendingOpenRequests = new Map<string, (note: Note) => void>()
  private isHost = false
  private connectedHostId?: string
  private preferredHostId?: string
  private readonly deviceId: string
  private tauriAvailable = false

  constructor() {
    this.deviceId = this.getOrCreateDeviceId()
  }

  initialize(callbacks: ConnectionCallbacks) {
    this.callbacks = callbacks
    this.tauriAvailable = this.isTauriRuntime()
    this.setStatus('Disconnected')
    this.reconnectTimer = window.setInterval(() => {
      if (!this.preferredHostId || this.isHost) return

      const host = this.hosts.get(this.preferredHostId)
      if (host && this.connectedHostId !== host.id) {
        host.status = 'Reconnecting'
        this.setStatus('Reconnecting')
        this.emitHosts()
        void this.connectToHost(host.id)
      }
    }, RECONNECT_INTERVAL_MS)

    this.pollTimer = window.setInterval(() => {
      void this.pollMessages()
    }, POLL_INTERVAL_MS)
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
    void this.setNativeDeviceName(cleanName)
  }

  getBrowserWarning() {
    return this.tauriAvailable ? '' : 'BluePad now runs through the native desktop transport. Open it as the Tauri app for reliable discovery.'
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
    this.connectedDevices.clear()
    this.setStatus('Host Running')
    this.callbacks?.onHostMessage?.('BluePad Host Running')

    if (!this.tauriAvailable) {
      this.emitHosts()
      return
    }

    try {
      await this.invokeNative<{ status: string; port: number }>('start_host')
      this.callbacks?.onHostMessage?.('Native host discovery is active')
      this.emitHosts()
    } catch (error) {
      this.setStatus('Disconnected')
      this.callbacks?.onHostMessage?.(error instanceof Error ? error.message : 'Unable to start host.')
    }
  }

  async scanForHosts() {
    this.setStatus('Searching')
    this.callbacks?.onHostMessage?.('Scanning for nearby BluePad hosts')

    if (!this.tauriAvailable) {
      this.emitHosts()
      return []
    }

    try {
      const hosts = await this.invokeNative<NativeHostInfo[]>('scan_for_hosts')
      this.hosts = new Map(hosts.map((host) => [host.id, {
        id: host.id,
        deviceName: host.device_name,
        isTrusted: true,
        status: host.status as BluetoothDevice['status'],
        lastSeen: Date.now(),
      }]))
      this.emitHosts()
      return this.getAvailableHosts()
    } catch (error) {
      this.setStatus('Disconnected')
      this.callbacks?.onHostMessage?.(error instanceof Error ? error.message : 'No BluePad hosts found.')
      return []
    }
  }

  async connectToHost(hostId: string) {
    if (!this.tauriAvailable) {
      this.setStatus('Disconnected')
      return false
    }

    const host = this.hosts.get(hostId)
    if (!host) {
      this.setStatus('Disconnected')
      return false
    }

    this.preferredHostId = host.id
    this.setStatus('Connecting')
    host.status = 'Connecting'
    this.emitHosts()

    try {
      const result = await this.invokeNative<{ connected: boolean; host?: NativeHostInfo; error?: string }>('connect_to_host', { host_id: hostId })
      if (!result.connected) {
        host.status = 'Disconnected'
        this.setStatus('Disconnected')
        this.emitHosts()
        return false
      }

      this.connectedHostId = host.id
      host.status = 'Connected'
      this.callbacks?.onHostMessage?.(`Connected to ${host.deviceName}`)
      this.setStatus('Connected')
      this.emitHosts()
      void this.sendTransportMessage({ type: 'client-join', clientId: this.deviceId, deviceName: this.getDeviceName() })
      return true
    } catch (error) {
      host.status = 'Disconnected'
      this.setStatus('Disconnected')
      this.emitHosts()
      this.callbacks?.onHostMessage?.(error instanceof Error ? error.message : 'Connection failed.')
      return false
    }
  }

  openNoteOnHost(passwordKey: string) {
    if (this.isHost) {
      return this.callbacks?.onOpenNoteRequested?.(passwordKey) ?? Promise.reject(new Error('Host note handler is unavailable.'))
    }

    const requestId = crypto.randomUUID()
    return new Promise<Note>((resolve, reject) => {
      if (!this.connectedHostId || !this.tauriAvailable) {
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

      void this.sendTransportMessage({
        type: 'open-note-request',
        requestId,
        clientId: this.deviceId,
        passwordKey,
      }).catch(() => {
        this.pendingOpenRequests.delete(requestId)
        reject(new Error('Unable to reach the host.'))
      })
    })
  }

  async sendNoteUpdateToHost(note: Note) {
    if (this.isHost) {
      const saved = await this.callbacks?.onClientNoteChanged?.(note)
      if (saved) this.broadcastNote(saved)
      return saved ?? note
    }

    if (!this.connectedHostId || !this.tauriAvailable) {
      throw new Error('Connect to a BluePad Host first.')
    }

    await this.sendTransportMessage({
      type: 'client-note-change',
      clientId: this.deviceId,
      note,
    })
    return note
  }

  subscribeToNote(_passwordKey: string) {
    // The native transport handles note fan-out through the host connection.
  }

  broadcastNote(note: Note) {
    const payload = {
      type: 'note-sync',
      note,
    }

    void this.sendTransportMessage(payload)
    this.callbacks?.onNoteSynced?.(note)
  }

  shutdown() {
    if (this.reconnectTimer) window.clearInterval(this.reconnectTimer)
    if (this.pollTimer) window.clearInterval(this.pollTimer)
    void this.invokeNativeSafe('shutdown')
  }

  private getOrCreateDeviceId() {
    const stored = window.localStorage.getItem(DEVICE_ID_KEY)
    if (stored) return stored
    const next = crypto.randomUUID()
    window.localStorage.setItem(DEVICE_ID_KEY, next)
    return next
  }

  private async setNativeDeviceName(deviceName: string) {
    if (!this.tauriAvailable) return
    try {
      await this.invokeNative<{ deviceName: string }>('set_device_name', { name: deviceName })
    } catch {
      // Ignore name sync errors; the app still uses local storage.
    }
  }

  private async pollMessages() {
    if (!this.tauriAvailable) return

    try {
      const messages = await this.invokeNative<NativeTransportMessage[]>('poll_messages')
      for (const message of messages) {
        this.handleIncomingMessage(message)
      }
    } catch {
      // Ignore transient polling failures until the next cycle.
    }
  }

  private handleIncomingMessage(message: NativeTransportMessage) {
    const payload = message.payload as Record<string, unknown>
    const payloadType = typeof payload.type === 'string' ? payload.type : ''
    const eventPayload = payloadType === 'transport-message' && payload.payload && typeof payload.payload === 'object'
      ? (payload.payload as Record<string, unknown>)
      : payload
    const eventType = typeof eventPayload.type === 'string' ? eventPayload.type : ''

    if (eventType === 'host-status') {
      const status = typeof eventPayload.status === 'string' ? eventPayload.status : 'Host active'
      this.callbacks?.onHostMessage?.(status)
      return
    }

    if (eventType === 'client-join' && this.isHost) {
      const clientId = typeof eventPayload.clientId === 'string' ? eventPayload.clientId : message.from
      if (clientId) {
        this.connectedDevices.set(clientId, {
          id: clientId,
          deviceName: typeof eventPayload.deviceName === 'string' ? eventPayload.deviceName : message.from_name,
          status: 'Connected',
        })
        this.emitConnectedDevices()
      }
      return
    }

    if (eventType === 'open-note-request' && this.isHost) {
      const passwordKey = typeof eventPayload.passwordKey === 'string' ? eventPayload.passwordKey : ''
      void this.callbacks?.onOpenNoteRequested?.(passwordKey).then((note) => {
        void this.sendTransportMessage({
          type: 'open-note-response',
          requestId: typeof eventPayload.requestId === 'string' ? eventPayload.requestId : undefined,
          note,
        })
      })
      return
    }

    if (eventType === 'open-note-response') {
      const requestId = typeof eventPayload.requestId === 'string' ? eventPayload.requestId : ''
      const resolver = this.pendingOpenRequests.get(requestId)
      if (resolver) {
        this.pendingOpenRequests.delete(requestId)
        resolver(eventPayload.note as Note)
      }
      return
    }

    if (eventType === 'client-note-change' && this.isHost) {
      void this.callbacks?.onClientNoteChanged?.(eventPayload.note as Note).then((saved) => {
        if (saved) this.broadcastNote(saved)
      })
      return
    }

    if (eventType === 'note-sync') {
      this.callbacks?.onNoteSynced?.(eventPayload.note as Note)
    }
  }

  private async sendTransportMessage(payload: Record<string, unknown>) {
    if (!this.tauriAvailable) {
      throw new Error('Native transport is unavailable.')
    }

    const message = JSON.stringify({
      type: 'transport-message',
      deviceId: this.deviceId,
      deviceName: this.getDeviceName(),
      payload,
    })
    await this.invokeNative<{ sent: boolean; error?: string }>('send_message', { payload: message })
  }

  private async invokeNative<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    this.tauriAvailable = this.isTauriRuntime()
    if (!this.tauriAvailable) {
      throw new Error('Native transport is unavailable.')
    }

    return invoke<T>(command, args)
  }

  private async invokeNativeSafe(command: string, args: Record<string, unknown> = {}) {
    try {
      await this.invokeNative(command, args)
    } catch {
      // Ignore shutdown errors.
    }
  }

  private isTauriRuntime() {
    if (typeof window === 'undefined') return false
    return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
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
