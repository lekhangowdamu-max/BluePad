import { compare, hash } from 'bcryptjs'
import type { AnalyticsAccessLog, AnalyticsSummary, DeviceAnalyticsEntry, Note, NoteAccessStat } from '../types'

const MASTER_HASH_KEY = 'bluepad-analytics-master-hash'
const CODE_HASH_KEY = 'bluepad-analytics-code-hash'
const LOCKOUT_KEY = 'bluepad-analytics-lockout'
const ATTEMPT_KEY = 'bluepad-analytics-attempts'
const LOGS_KEY = 'bluepad-analytics-logs'
const DEVICES_KEY = 'bluepad-device-analytics'
const NOTE_ACCESS_KEY = 'bluepad-note-access-stats'
const DEVICE_ID_KEY = 'bluepad-device-id'
const DEFAULT_MASTER_PASSWORD = 'kingkiller@1234'
const DEFAULT_VERIFICATION_CODE = '21'
const LOCK_DURATION_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

export interface AnalyticsVerificationResult {
  success: boolean
  locked: boolean
  message: string
  attemptsLeft: number
}

export class AnalyticsService {
  private step1Verified = false
  private readonly deviceId: string

  constructor() {
    this.deviceId = this.getOrCreateDeviceId()
  }

  async initialize() {
    if (typeof window === 'undefined') return
    const masterHash = window.localStorage.getItem(MASTER_HASH_KEY)
    const codeHash = window.localStorage.getItem(CODE_HASH_KEY)
    if (!masterHash || !codeHash) {
      const masterHashValue = await hash(DEFAULT_MASTER_PASSWORD, 10)
      const codeHashValue = await hash(DEFAULT_VERIFICATION_CODE, 10)
      window.localStorage.setItem(MASTER_HASH_KEY, masterHashValue)
      window.localStorage.setItem(CODE_HASH_KEY, codeHashValue)
    }
  }

  async verifyStep1(input: string): Promise<AnalyticsVerificationResult> {
    await this.initialize()
    const lockout = this.getLockoutState()
    if (lockout.locked) {
      this.logAttempt('Step 1', 'locked')
      return { success: false, locked: true, message: 'Analytics access is temporarily locked for 10 minutes.', attemptsLeft: 0 }
    }

    const storedHash = this.getStorageValue(MASTER_HASH_KEY)
    const isValid = await compare(input, storedHash)
    if (!isValid) {
      const attemptsLeft = this.recordFailure('Step 1')
      return { success: false, locked: false, message: 'Invalid Password', attemptsLeft }
    }

    this.step1Verified = true
    this.resetAttempts()
    this.logAttempt('Step 1', 'success')
    return { success: true, locked: false, message: 'Step 1 verified', attemptsLeft: MAX_ATTEMPTS }
  }

  async verifyStep2(input: string): Promise<AnalyticsVerificationResult> {
    await this.initialize()
    if (!this.step1Verified) {
      return { success: false, locked: false, message: 'Complete Step 1 first.', attemptsLeft: this.getAttemptsLeft() }
    }

    const lockout = this.getLockoutState()
    if (lockout.locked) {
      this.logAttempt('Step 2', 'locked')
      return { success: false, locked: true, message: 'Analytics access is temporarily locked for 10 minutes.', attemptsLeft: 0 }
    }

    const storedCodeHash = this.getStorageValue(CODE_HASH_KEY)
    const isValid = await compare(input, storedCodeHash)
    if (!isValid) {
      const attemptsLeft = this.recordFailure('Step 2')
      return { success: false, locked: false, message: 'Invalid Verification Code', attemptsLeft }
    }

    this.step1Verified = false
    this.resetAttempts()
    this.logAttempt('Step 2', 'success')
    return { success: true, locked: false, message: 'Access granted', attemptsLeft: MAX_ATTEMPTS }
  }

  trackDeviceUsage(noteCreated = false, noteKey?: string) {
    if (typeof window === 'undefined') return
    const now = new Date().toISOString()
    const currentDevice = this.getStoredDevices().find((entry) => entry.deviceId === this.deviceId)
    const nextDevices: DeviceAnalyticsEntry[] = currentDevice
      ? this.getStoredDevices().map((entry) =>
          entry.deviceId === this.deviceId
            ? {
                ...entry,
                lastActive: now,
                notesCreated: entry.notesCreated + (noteCreated ? 1 : 0),
                platform: this.getPlatform(),
                deviceName: this.getDeviceName(),
              }
            : entry,
        )
      : [
          ...this.getStoredDevices(),
          {
            deviceId: this.deviceId,
            deviceName: this.getDeviceName(),
            platform: this.getPlatform(),
            firstSeen: now,
            lastActive: now,
            notesCreated: noteCreated ? 1 : 0,
          },
        ]

    window.localStorage.setItem(DEVICES_KEY, JSON.stringify(nextDevices))

    if (noteKey) {
      this.trackNoteAccess(noteKey)
    }
  }

  trackNoteAccess(noteKey: string) {
    if (typeof window === 'undefined') return
    const stats = this.getStoredNoteStats()
    const entry = stats.find((item) => item.noteKey === noteKey)
    const nextStats = entry
      ? stats.map((item) => (item.noteKey === noteKey ? { ...item, accessCount: item.accessCount + 1 } : item))
      : [...stats, { noteKey, accessCount: 1 }]
    window.localStorage.setItem(NOTE_ACCESS_KEY, JSON.stringify(nextStats))
  }

  getDashboardSummary(notes: Note[], connectedBluetoothDevices: number): AnalyticsSummary {
    const devices = this.getStoredDevices()
    const now = Date.now()
    const dayAgo = now - 24 * 60 * 60 * 1000
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000

    const notesCreatedPerDay = this.groupCountsByDay(notes, 'createdAt')
    const weeklyStats = this.groupCountsByDay(notes, 'createdAt').slice(-7)

    return {
      totalUsers: devices.length,
      totalNotesCreated: notes.length,
      totalActiveDevices: devices.length,
      dailyActiveUsers: devices.filter((device) => Date.parse(device.lastActive) >= dayAgo).length,
      weeklyActiveUsers: devices.filter((device) => Date.parse(device.lastActive) >= weekAgo).length,
      monthlyActiveUsers: devices.filter((device) => Date.parse(device.lastActive) >= monthAgo).length,
      notesCreatedPerDay: notesCreatedPerDay,
      connectedBluetoothDevices,
      mostAccessedNotes: this.getMostAccessedNotes(),
      lastActiveDevices: [...devices].sort((a, b) => Date.parse(b.lastActive) - Date.parse(a.lastActive)).slice(0, 5),
      deviceTypeDistribution: this.getDeviceTypeDistribution(devices),
      weeklyUsageStatistics: weeklyStats.map((item) => ({ label: item.date, value: item.count })),
    }
  }

  getAccessLogs(): AnalyticsAccessLog[] {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(LOGS_KEY)
    return raw ? (JSON.parse(raw) as AnalyticsAccessLog[]) : []
  }

  getDeviceAnalytics(): DeviceAnalyticsEntry[] {
    return this.getStoredDevices()
  }

  getMostAccessedNotes(limit = 5): NoteAccessStat[] {
    return this.getStoredNoteStats().sort((a, b) => b.accessCount - a.accessCount).slice(0, limit)
  }

  private getStorageValue(key: string) {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(key) ?? ''
  }

  private getStoredDevices(): DeviceAnalyticsEntry[] {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(DEVICES_KEY)
    return raw ? (JSON.parse(raw) as DeviceAnalyticsEntry[]) : []
  }

  private getStoredNoteStats(): NoteAccessStat[] {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(NOTE_ACCESS_KEY)
    return raw ? (JSON.parse(raw) as NoteAccessStat[]) : []
  }

  private getDeviceName() {
    if (typeof navigator === 'undefined') return 'Unknown Device'
    const userAgentData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
    return userAgentData?.mobile ? 'Mobile Device' : navigator.platform || 'Desktop Device'
  }

  private getPlatform() {
    if (typeof navigator === 'undefined') return 'Unknown'
    const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    return userAgentData?.platform || navigator.platform || 'Unknown'
  }

  private getOrCreateDeviceId() {
    if (typeof window === 'undefined') return 'browser-device'
    const existing = window.localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
    const generated = window.crypto?.randomUUID?.() ?? `device-${Date.now()}`
    window.localStorage.setItem(DEVICE_ID_KEY, generated)
    return generated
  }

  private getLockoutState() {
    if (typeof window === 'undefined') return { locked: false }
    const raw = window.localStorage.getItem(LOCKOUT_KEY)
    if (!raw) return { locked: false }
    const until = Number(raw)
    if (Date.now() < until) return { locked: true }
    window.localStorage.removeItem(LOCKOUT_KEY)
    return { locked: false }
  }

  private recordFailure(step: 'Step 1' | 'Step 2') {
    if (typeof window === 'undefined') return MAX_ATTEMPTS
    const current = Number(window.localStorage.getItem(ATTEMPT_KEY) ?? '0')
    const next = current + 1
    window.localStorage.setItem(ATTEMPT_KEY, String(next))
    this.logAttempt(step, 'failed')
    if (next >= MAX_ATTEMPTS) {
      window.localStorage.setItem(LOCKOUT_KEY, String(Date.now() + LOCK_DURATION_MS))
      return 0
    }
    return MAX_ATTEMPTS - next
  }

  private resetAttempts() {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(ATTEMPT_KEY)
    window.localStorage.removeItem(LOCKOUT_KEY)
  }

  private getAttemptsLeft() {
    if (typeof window === 'undefined') return MAX_ATTEMPTS
    const current = Number(window.localStorage.getItem(ATTEMPT_KEY) ?? '0')
    return Math.max(0, MAX_ATTEMPTS - current)
  }

  private logAttempt(step: 'Step 1' | 'Step 2', status: 'success' | 'failed' | 'locked') {
    if (typeof window === 'undefined') return
    const logs = this.getAccessLogs()
    logs.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      attemptTime: new Date().toISOString(),
      status,
      deviceName: this.getDeviceName(),
      verificationStep: step,
    })
    window.localStorage.setItem(LOGS_KEY, JSON.stringify(logs.slice(0, 100)))
  }

  private groupCountsByDay(items: Note[], field: 'createdAt') {
    const counts = new Map<string, number>()
    items.forEach((item) => {
      const key = new Date(item[field]).toISOString().slice(0, 10)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }))
  }

  private getDeviceTypeDistribution(devices: DeviceAnalyticsEntry[]) {
    const distribution = new Map<string, number>()
    devices.forEach((device) => {
      const platform = device.platform || 'Unknown'
      distribution.set(platform, (distribution.get(platform) ?? 0) + 1)
    })
    return Array.from(distribution.entries()).map(([label, value]) => ({ label, value }))
  }
}
