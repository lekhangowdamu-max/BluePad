import type { Note, BluetoothDevice, ConnectionStatus } from '../types'
export type { ConnectionStatus } from '../types'

const TRUSTED_DEVICES_KEY = 'bluepad-trusted-devices'
const MAIN_SERVER_AVAILABLE = true

interface ConnectionCallbacks {
  onStatusChange: (status: ConnectionStatus) => void
  onNotesSynced?: (notes: Note[]) => void
}

export class ConnectionManager {
  private callbacks: ConnectionCallbacks | null = null
  private reconnectTimer?: number
  private trustedDeviceIds: string[] = []
  constructor() {
    this.trustedDeviceIds = this.loadTrustedDevices()
  }

  initialize(callbacks: ConnectionCallbacks) {
    this.callbacks = callbacks
    this.smartConnect(false)
    this.reconnectTimer = window.setInterval(() => this.smartConnect(true), 10000)
  }

  getNearbyDeviceCount() {
    return this.scanNearbyServers().length
  }

  shutdown() {
    if (this.reconnectTimer) {
      window.clearInterval(this.reconnectTimer)
    }
  }

  private setStatus(status: ConnectionStatus) {
    this.callbacks?.onStatusChange(status)
  }

  private loadTrustedDevices(): string[] {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(TRUSTED_DEVICES_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  }

  private saveTrustedDevices() {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(TRUSTED_DEVICES_KEY, JSON.stringify(this.trustedDeviceIds))
  }

  private scanNearbyServers(): BluetoothDevice[] {
    const availableServers: BluetoothDevice[] = [
      { id: 'bluepad-server-1', deviceName: 'BluePad Server', deviceAddress: 'AA:BB:CC:DD:EE:01', isTrusted: false },
      { id: 'bluepad-peer-1', deviceName: 'BluePad Peer', deviceAddress: '11:22:33:44:55:01', isTrusted: false },
    ]

    const found = Math.random() > 0.35 ? availableServers : []
    return found.map((device) => ({
      ...device,
      isTrusted: this.trustedDeviceIds.includes(device.id),
    }))
  }

  private trustDevice(device: BluetoothDevice) {
    if (!this.trustedDeviceIds.includes(device.id)) {
      this.trustedDeviceIds.push(device.id)
      this.saveTrustedDevices()
    }
  }

  private connectToMainServer(): boolean {
    return MAIN_SERVER_AVAILABLE
  }

  private async synchronizeNotes() {
    this.setStatus('Synchronizing')
    await new Promise((resolve) => window.setTimeout(resolve, 300))
    this.callbacks?.onNotesSynced?.([])
  }

  private async smartConnect(isRetry: boolean) {
    if (isRetry) {
      this.setStatus('Reconnecting')
    }

    const nearby = this.scanNearbyServers()
    const trusted = nearby.find((device) => device.isTrusted) ?? nearby[0]

    if (trusted) {
      this.trustDevice(trusted)
      await this.synchronizeNotes()
      this.setStatus('Connected via Bluetooth')
      return
    }

    if (this.connectToMainServer()) {
      await this.synchronizeNotes()
      this.setStatus('Connected to Main Server')
      return
    }

    this.setStatus('Offline Mode')
  }
}
