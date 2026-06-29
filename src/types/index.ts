export interface Note {
  id?: string
  noteKey: string
  passwordKey?: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface BluetoothDevice {
  id: string
  deviceName: string
  deviceAddress?: string
  isTrusted: boolean
  status?: 'Available' | 'Connected' | 'Disconnected' | 'Reconnecting'
}

export interface ConnectedDevice {
  id: string
  deviceName: string
  status: 'Connected' | 'Disconnected' | 'Reconnecting'
}

export interface AnalyticsAccessLog {
  id: string
  attemptTime: string
  status: 'success' | 'failed' | 'locked'
  deviceName: string
  verificationStep: 'Step 1' | 'Step 2'
}

export interface DeviceAnalyticsEntry {
  deviceId: string
  deviceName: string
  platform: string
  firstSeen: string
  lastActive: string
  notesCreated: number
}

export interface NoteAccessStat {
  noteKey: string
  accessCount: number
}

export interface AnalyticsSummary {
  totalUsers: number
  totalNotesCreated: number
  totalActiveDevices: number
  dailyActiveUsers: number
  weeklyActiveUsers: number
  monthlyActiveUsers: number
  notesCreatedPerDay: Array<{ date: string; count: number }>
  connectedBluetoothDevices: number
  mostAccessedNotes: NoteAccessStat[]
  lastActiveDevices: DeviceAnalyticsEntry[]
  deviceTypeDistribution: Array<{ label: string; value: number }>
  weeklyUsageStatistics: Array<{ label: string; value: number }>
}

export type ConnectionStatus = 'Connected' | 'Disconnected' | 'Reconnecting' | 'Host Running' | 'Bluetooth Unsupported'
