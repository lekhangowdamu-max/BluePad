import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { BookOpen } from 'lucide-react'
import { Layout } from './components/Layout'
import { AnalyticsDashboard } from './components/AnalyticsDashboard'
import { PwaStatusBar } from './components/PwaStatusBar'
import { AnalyticsService } from './services/analyticsService'
import { ConnectionManager, type ConnectionStatus } from './services/bluetoothService'
import { useAppStore } from './stores/appStore'
import type { AnalyticsSummary } from './types'

function App() {
  const notes = useAppStore((state) => state.notes)
  const activeNoteKey = useAppStore((state) => state.activeNoteKey)
  const openOrCreateNote = useAppStore((state) => state.openOrCreateNote)
  const updateNoteContent = useAppStore((state) => state.updateNoteContent)
  const setActiveNoteKey = useAppStore((state) => state.setActiveNoteKey)
  const hydrateNotes = useAppStore((state) => state.hydrateNotes)
  const syncPendingChanges = useAppStore((state) => state.syncPendingChanges)

  const [noteKeyInput, setNoteKeyInput] = useState('')
  const [content, setContent] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Offline Mode')
  const [isConnected, setIsConnected] = useState(false)
  const [analyticsView, setAnalyticsView] = useState<'notes' | 'verify' | 'dashboard'>('notes')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [ownerCode, setOwnerCode] = useState('')
  const [verificationMessage, setVerificationMessage] = useState('')
  const [verificationStep, setVerificationStep] = useState(1)
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | null>(null)
  const [analyticsReady, setAnalyticsReady] = useState(false)
  const [attemptsLeft, setAttemptsLeft] = useState(5)
  const [bluetoothDeviceCount, setBluetoothDeviceCount] = useState(0)
  const connectionManager = useMemo(() => new ConnectionManager(), [])
  const analyticsService = useMemo(() => new AnalyticsService(), [])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const logoClickCountRef = useRef(0)
  const logoClickTimerRef = useRef<number | null>(null)

  const activeNote = useMemo(() => notes.find((note) => note.noteKey === activeNoteKey), [notes, activeNoteKey])

  useEffect(() => {
    void hydrateNotes()
  }, [hydrateNotes])

  useEffect(() => {
    const syncOnReconnect = () => {
      void syncPendingChanges()
    }

    if (navigator.onLine) {
      void syncPendingChanges()
    }

    window.addEventListener('online', syncOnReconnect)
    return () => window.removeEventListener('online', syncOnReconnect)
  }, [syncPendingChanges])

  useEffect(() => {
    connectionManager.initialize({
      onStatusChange: (status) => {
        setConnectionStatus(status)
        setIsConnected(status !== 'Offline Mode' && status !== 'Reconnecting' && status !== 'Synchronizing')
        setBluetoothDeviceCount(connectionManager.getNearbyDeviceCount())
      },
    })
    setBluetoothDeviceCount(connectionManager.getNearbyDeviceCount())

    return () => {
      connectionManager.shutdown()
    }
  }, [connectionManager])

  useEffect(() => {
    analyticsService.initialize().then(() => {
      analyticsService.trackDeviceUsage(false)
      setAnalyticsReady(true)
    })
  }, [analyticsService])

  useEffect(() => {
    if (activeNote) {
      setContent(activeNote.content)
    }
  }, [activeNote])

  useEffect(() => {
    if (!analyticsReady) return
    setAnalyticsSummary(analyticsService.getDashboardSummary(notes, bluetoothDeviceCount))
  }, [analyticsReady, analyticsService, bluetoothDeviceCount, notes])

  useEffect(() => {
    if (!activeNoteKey || !activeNote) return
    const timer = window.setInterval(() => {
      if (activeNote.content !== content) {
        updateNoteContent(activeNoteKey, content)
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [activeNoteKey, activeNote, content, updateNoteContent])

  const openAnalytics = useCallback(async () => {
    await analyticsService.initialize()
    setVerificationMessage('')
    setVerificationStep(1)
    setOwnerPassword('')
    setOwnerCode('')
    setAttemptsLeft(5)
    setAnalyticsView('verify')
  }, [analyticsService])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        void openAnalytics()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openAnalytics])

  const handleOpen = () => {
    const noteKey = noteKeyInput.trim()
    if (!noteKey) return

    const { note, created } = openOrCreateNote(noteKey)
    analyticsService.trackDeviceUsage(created, note.noteKey)
    setActiveNoteKey(note.noteKey)
    setContent(note.content)
    setNoteKeyInput(note.noteKey)
  }

  const handleBack = () => {
    if (activeNoteKey) {
      updateNoteContent(activeNoteKey, content)
    }
    setActiveNoteKey(undefined)
  }

  const handleContentKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
    }
  }

  const handleLogoClick = async () => {
    const now = Date.now()
    if (logoClickTimerRef.current && now - logoClickTimerRef.current < 500) {
      logoClickCountRef.current += 1
    } else {
      logoClickCountRef.current = 1
    }
    logoClickTimerRef.current = now

    if (logoClickCountRef.current >= 3) {
      await openAnalytics()
    }
  }

  const handleVerifyStepOne = async () => {
    const result = await analyticsService.verifyStep1(ownerPassword)
    setAttemptsLeft(result.attemptsLeft)
    setVerificationMessage(result.message)
    if (result.success) {
      setVerificationStep(2)
    }
    if (result.locked) {
      setVerificationStep(1)
    }
  }

  const handleVerifyStepTwo = async () => {
    const result = await analyticsService.verifyStep2(ownerCode)
    setAttemptsLeft(result.attemptsLeft)
    setVerificationMessage(result.message)
    if (result.success) {
      setAnalyticsSummary(analyticsService.getDashboardSummary(notes, bluetoothDeviceCount))
      setAnalyticsView('dashboard')
      setOwnerCode('')
      setOwnerPassword('')
    }
  }

  if (analyticsView === 'dashboard') {
    return <AnalyticsDashboard summary={analyticsSummary} onClose={() => setAnalyticsView('notes')} />
  }

  return (
    <Layout>
      <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] max-w-4xl flex-col justify-center px-5 py-10 text-slate-100">
        <PwaStatusBar />
        {!analyticsView || analyticsView === 'notes' ? (
          <button
            type="button"
            onClick={() => void openAnalytics()}
            title="Analytics Dashboard"
            aria-label="Open Analytics Dashboard"
            className="absolute right-3 top-3 z-10 inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-cyan-400 shadow-lg shadow-cyan-950/20 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400 hover:bg-slate-800 hover:text-cyan-300 sm:right-6 sm:top-6"
          >
            <BookOpen className="h-5 w-5" />
          </button>
        ) : null}

        {analyticsView === 'verify' && (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/85 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-cyan-950/30">
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">Owner access</p>
              <h2 className="mt-3 text-2xl font-semibold">Two-step verification</h2>
              <p className="mt-2 text-sm text-slate-400">This is a private path for the owner only.</p>

              {verificationStep === 1 ? (
                <>
                  <label className="mt-5 block text-sm text-slate-400">Owner password</label>
                  <input
                    value={ownerPassword}
                    onChange={(event) => setOwnerPassword(event.target.value)}
                    type="password"
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm outline-none transition focus:border-cyan-500"
                  />
                  <button onClick={() => void handleVerifyStepOne()} className="mt-5 w-full rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400">
                    Continue
                  </button>
                </>
              ) : (
                <>
                  <label className="mt-5 block text-sm text-slate-400">Verification code</label>
                  <input
                    value={ownerCode}
                    onChange={(event) => setOwnerCode(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm outline-none transition focus:border-cyan-500"
                  />
                  <button onClick={() => void handleVerifyStepTwo()} className="mt-5 w-full rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400">
                    Unlock analytics
                  </button>
                </>
              )}

              {verificationMessage ? <p className="mt-4 text-sm text-cyan-300">{verificationMessage}</p> : null}
              <p className="mt-4 text-sm text-slate-500">Attempts left: {attemptsLeft}</p>
              <button onClick={() => setAnalyticsView('notes')} className="mt-4 text-sm text-slate-400 transition hover:text-slate-200">
                Cancel
              </button>
            </div>
          </div>
        )}

        {!activeNoteKey ? (
          <section className="rounded-[2rem] border border-slate-800 bg-slate-950/90 p-10 text-center shadow-2xl shadow-cyan-950/20">
            <div className="mb-8">
              <button onClick={handleLogoClick} className="text-sm uppercase tracking-[0.35em] text-cyan-400">
                BluePad
              </button>
              <h1 className="mt-4 text-4xl font-semibold">Enter Note Key</h1>
            </div>
            <label className="block text-left text-sm text-slate-400">Note Key</label>
            <input
              value={noteKeyInput}
              onChange={(event) => setNoteKeyInput(event.target.value)}
              placeholder="college_notes"
              className="mt-2 w-full rounded-3xl border border-slate-700 bg-slate-900/90 px-4 py-4 text-lg outline-none transition focus:border-cyan-500"
            />
            <button onClick={handleOpen} className="mt-8 inline-flex w-full justify-center rounded-3xl bg-cyan-500 px-6 py-4 text-lg font-semibold text-slate-950 transition hover:bg-cyan-400">
              OPEN
            </button>
          </section>
        ) : (
          <section className="flex min-h-[calc(100vh-6rem)] flex-col rounded-[2rem] border border-slate-800 bg-slate-950/90 p-5 shadow-2xl shadow-cyan-950/20">
            <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-between gap-4">
                <button onClick={handleBack} className="rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-2 text-sm text-slate-100 transition hover:bg-slate-800">
                  Back
                </button>
                <div>
                  <p className="text-slate-400">Note Key</p>
                  <p className="font-semibold text-slate-100">{activeNote?.noteKey}</p>
                </div>
              </div>
              <div className="rounded-3xl bg-slate-900/80 px-4 py-3 text-sm text-slate-200">
                {connectionStatus}
              </div>
            </div>

            <textarea
              ref={textareaRef}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={handleContentKeyDown}
              className="min-h-[calc(100vh-16rem)] w-full flex-1 rounded-[2rem] border border-slate-800 bg-slate-950/90 p-6 text-base leading-7 outline-none placeholder:text-slate-500"
              placeholder="Start typing..."
            />

            <div className="mt-4 flex items-center justify-between text-xs uppercase tracking-[0.25em] text-slate-500">
              <span>Auto-save every second</span>
              <span>{isConnected ? 'Sync enabled' : 'Offline mode'}</span>
            </div>
          </section>
        )}
      </div>
    </Layout>
  )
}

export default App
