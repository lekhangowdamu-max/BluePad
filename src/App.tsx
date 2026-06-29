import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bluetooth, Pencil, RadioTower, Save, Settings, WifiOff } from 'lucide-react'
import { Layout } from './components/Layout'
import { PwaStatusBar } from './components/PwaStatusBar'
import { ConnectionManager, type ConnectionStatus } from './services/bluetoothService'
import { useAppStore } from './stores/appStore'
import type { BluetoothDevice as BluePadHost, ConnectedDevice, Note } from './types'

type AppMode = 'home' | 'settings' | 'editor'
type ConnectionRole = 'none' | 'host' | 'client'

function App() {
  const notes = useAppStore((state) => state.notes)
  const activeNoteKey = useAppStore((state) => state.activeNoteKey)
  const hydrateNotes = useAppStore((state) => state.hydrateNotes)
  const openOrCreateNote = useAppStore((state) => state.openOrCreateNote)
  const upsertRemoteNote = useAppStore((state) => state.upsertRemoteNote)
  const updateNoteContent = useAppStore((state) => state.updateNoteContent)
  const setActiveNoteKey = useAppStore((state) => state.setActiveNoteKey)

  const connectionManager = useMemo(() => new ConnectionManager(), [])

  const [mode, setMode] = useState<AppMode>('home')
  const [role, setRole] = useState<ConnectionRole>('none')
  const [deviceName, setDeviceName] = useState(() => connectionManager.getDeviceName())
  const [settingsName, setSettingsName] = useState(deviceName)
  const [passwordInput, setPasswordInput] = useState('')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<ConnectionStatus>('Disconnected')
  const [statusMessage, setStatusMessage] = useState('Disconnected')
  const [availableHosts, setAvailableHosts] = useState<BluePadHost[]>([])
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([])
  const [browserWarning, setBrowserWarning] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [saveState, setSaveState] = useState('Saved')
  const [errorMessage, setErrorMessage] = useState('')
  const lastSavedContentRef = useRef('')
  const activeNoteKeyRef = useRef<string | undefined>(activeNoteKey)

  const activeNote = useMemo(() => notes.find((note) => note.noteKey === activeNoteKey), [activeNoteKey, notes])

  const persistHostNote = useCallback(
    async (note: Note) => {
      const saved = await updateNoteContent(note.noteKey, note.content)
      return saved
    },
    [updateNoteContent],
  )

  useEffect(() => {
    void hydrateNotes()
  }, [hydrateNotes])

  useEffect(() => {
    activeNoteKeyRef.current = activeNoteKey
  }, [activeNoteKey])

  useEffect(() => {
    connectionManager.initialize({
      onStatusChange: (nextStatus) => {
        setStatus(nextStatus)
        setStatusMessage(nextStatus === 'Host Running' ? 'BluePad Host Running' : nextStatus)
      },
      onHostsChanged: setAvailableHosts,
      onConnectedDevicesChanged: setConnectedDevices,
      onNoteSynced: (note) => {
        upsertRemoteNote(note)
        if (note.noteKey === activeNoteKeyRef.current) {
          lastSavedContentRef.current = note.content
          setContent(note.content)
          setSaveState('Synced')
        }
      },
      onOpenNoteRequested: async (passwordKey) => {
        const { note } = await openOrCreateNote(passwordKey, false)
        connectionManager.subscribeToNote(note.noteKey)
        return note
      },
      onClientNoteChanged: persistHostNote,
      onHostMessage: setStatusMessage,
    })
    setBrowserWarning(connectionManager.getBrowserWarning())

    return () => connectionManager.shutdown()
  }, [connectionManager, openOrCreateNote, persistHostNote, upsertRemoteNote])

  useEffect(() => {
    if (!activeNote) return
    setContent(activeNote.content)
    lastSavedContentRef.current = activeNote.content
    connectionManager.subscribeToNote(activeNote.noteKey)
  }, [activeNote, connectionManager])

  const commitDeviceName = (nextName: string) => {
    connectionManager.setDeviceName(nextName)
    const savedName = connectionManager.getDeviceName()
    setDeviceName(savedName)
    setSettingsName(savedName)
  }

  const handleChangeDeviceName = () => {
    commitDeviceName(settingsName)
    setMode('home')
  }

  const handleStartHost = async () => {
    setErrorMessage('')
    await connectionManager.startHost()
    setRole('host')
    setConnectedDevices(connectionManager.getConnectedDevices())
  }

  const handleScan = async () => {
    setErrorMessage('')
    setIsScanning(true)
    setStatusMessage('Scanning for BluePad Hosts')
    const hosts = await connectionManager.scanForHosts()
    setAvailableHosts(hosts)
    setIsScanning(false)
    setStatusMessage(hosts.length > 0 ? 'Select a BluePad Host' : 'No BluePad Hosts found')
  }

  const handleConnect = (hostId: string) => {
    setErrorMessage('')
    if (connectionManager.connectToHost(hostId)) {
      setRole('client')
      setStatusMessage('Connected to BluePad Host')
    }
  }

  const handleOpenNote = async () => {
    const passwordKey = passwordInput.trim()
    if (!passwordKey) return
    setErrorMessage('')

    try {
      const result = role === 'client'
        ? { note: await connectionManager.openNoteOnHost(passwordKey), created: false }
        : await openOrCreateNote(passwordKey)

      upsertRemoteNote(result.note)
      setActiveNoteKey(result.note.noteKey)
      setContent(result.note.content)
      lastSavedContentRef.current = result.note.content
      connectionManager.subscribeToNote(result.note.noteKey)
      setMode('editor')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to open note.')
    }
  }

  const saveCurrentNote = useCallback(async () => {
    if (!activeNoteKey || content === lastSavedContentRef.current) return
    const baseNote = activeNote ?? {
      id: crypto.randomUUID(),
      noteKey: activeNoteKey,
      passwordKey: activeNoteKey,
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const nextNote = { ...baseNote, content, updatedAt: new Date().toISOString() }

    setSaveState('Saving')
    try {
      const saved = role === 'client'
        ? await connectionManager.sendNoteUpdateToHost(nextNote)
        : await updateNoteContent(activeNoteKey, content)

      upsertRemoteNote(saved)
      if (role === 'host') {
        connectionManager.broadcastNote(saved)
      }
      lastSavedContentRef.current = saved.content
      setSaveState('Saved')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save note.')
      setSaveState('Disconnected')
    }
  }, [activeNote, activeNoteKey, connectionManager, content, role, updateNoteContent, upsertRemoteNote])

  useEffect(() => {
    if (mode !== 'editor' || !activeNoteKey) return
    const stopTypingTimer = window.setTimeout(() => void saveCurrentNote(), 700)
    const intervalTimer = window.setInterval(() => void saveCurrentNote(), 2000)
    return () => {
      window.clearTimeout(stopTypingTimer)
      window.clearInterval(intervalTimer)
    }
  }, [activeNoteKey, content, mode, saveCurrentNote])

  const handleBack = async () => {
    await saveCurrentNote()
    setActiveNoteKey(undefined)
    setMode('home')
  }

  const connectionLabel = role === 'none'
    ? 'Personal Mode'
    : status === 'Connected'
      ? 'Connected'
      : status === 'Reconnecting'
        ? 'Reconnecting'
        : status === 'Host Running'
          ? 'Host Running'
          : 'Disconnected'

  return (
    <Layout>
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-5xl flex-col px-2 py-4 text-slate-100">
        <PwaStatusBar compact />

        <header className="mb-5 flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-400">BluePad Logo</p>
            <h1 className="mt-2 text-3xl font-semibold">BluePad</h1>
          </div>
          <button onClick={() => setMode('settings')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm transition hover:border-cyan-400">
            <Settings className="h-4 w-4" />
            Settings
          </button>
        </header>

        {browserWarning ? (
          <div className="mb-4 rounded-2xl border border-amber-700 bg-amber-950/60 p-4 text-sm text-amber-100">
            {browserWarning}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mb-4 rounded-2xl border border-rose-700 bg-rose-950/60 p-4 text-sm text-rose-100">
            {errorMessage}
          </div>
        ) : null}

        {mode === 'settings' ? (
          <section className="max-w-xl rounded-2xl border border-slate-800 bg-slate-950/90 p-6">
            <button onClick={() => setMode('home')} className="mb-5 inline-flex items-center gap-2 text-sm text-slate-300 hover:text-cyan-300">
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <h2 className="text-2xl font-semibold">Settings</h2>
            <label className="mt-6 block text-sm text-slate-400">BluePad Device Name</label>
            <input
              value={settingsName}
              onChange={(event) => setSettingsName(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none transition focus:border-cyan-400"
            />
            <button onClick={handleChangeDeviceName} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300">
              <Pencil className="h-4 w-4" />
              Change Device Name
            </button>
          </section>
        ) : null}

        {mode === 'home' ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
            <section className="rounded-2xl border border-slate-800 bg-slate-950/90 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">Main Screen</h2>
                  <p className="mt-1 text-sm text-slate-400">Device Name: {deviceName}</p>
                </div>
                <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">{connectionLabel}</span>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button onClick={() => void handleStartHost()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-5 py-4 font-semibold text-slate-950 hover:bg-cyan-300">
                  <RadioTower className="h-5 w-5" />
                  Start Host
                </button>
                <button onClick={() => void handleScan()} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-700 px-5 py-4 font-semibold text-cyan-100 hover:border-cyan-300">
                  <Bluetooth className="h-5 w-5" />
                  Connect to Host
                </button>
              </div>

              <label className="mt-7 block text-sm text-slate-400">Enter Password</label>
              <input
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleOpenNote()
                }}
                type="password"
                placeholder="friendsgroup"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-4 text-lg outline-none transition focus:border-cyan-400"
              />
              <button onClick={() => void handleOpenNote()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 px-5 py-4 font-semibold text-slate-950 hover:bg-white">
                <Save className="h-5 w-5" />
                Open Note
              </button>
            </section>

            <aside className="space-y-5">
              <section className="rounded-2xl border border-slate-800 bg-slate-950/90 p-6">
                <h2 className="text-xl font-semibold">{role === 'host' ? 'BluePad Host Running' : role === 'client' ? statusMessage : 'Personal Mode'}</h2>
                <dl className="mt-5 grid gap-3 text-sm">
                  <div className="flex justify-between gap-4 border-b border-slate-800 pb-3">
                    <dt className="text-slate-400">Device Name</dt>
                    <dd>{deviceName}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-slate-800 pb-3">
                    <dt className="text-slate-400">Connected Devices</dt>
                    <dd>{connectedDevices.length}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">Host Status</dt>
                    <dd>{role === 'host' ? 'Running' : role === 'client' ? status : 'Local Notes'}</dd>
                  </div>
                </dl>
                {role === 'host' ? (
                  <div className="mt-5">
                    <p className="text-sm font-semibold text-slate-200">Connected Users:</p>
                    {connectedDevices.length > 0 ? (
                      <ul className="mt-3 space-y-2 text-sm text-slate-300">
                        {connectedDevices.map((device) => <li key={device.id}>{device.deviceName}</li>)}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">No connected users yet.</p>
                    )}
                  </div>
                ) : null}
              </section>

              <section className="rounded-2xl border border-slate-800 bg-slate-950/90 p-6">
                <h2 className="text-xl font-semibold">Available BluePad Hosts</h2>
                <div className="mt-4 space-y-3">
                  {isScanning ? <p className="text-sm text-cyan-300">Scanning...</p> : null}
                  {availableHosts.map((host) => (
                    <div key={host.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                      <div>
                        <p className="font-medium">{host.deviceName}</p>
                        <p className="text-xs text-slate-500">{host.status ?? 'Available'}</p>
                      </div>
                      <button onClick={() => handleConnect(host.id)} className="rounded-xl border border-cyan-700 px-4 py-2 text-sm text-cyan-100 hover:border-cyan-300">
                        Connect
                      </button>
                    </div>
                  ))}
                  {!isScanning && availableHosts.length === 0 ? <p className="text-sm text-slate-500">No hosts discovered.</p> : null}
                </div>
              </section>
            </aside>
          </div>
        ) : null}

        {mode === 'editor' ? (
          <section className="flex min-h-[calc(100vh-9rem)] flex-col rounded-2xl border border-slate-800 bg-slate-950/90 p-5">
            <div className="mb-4 flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <button onClick={() => void handleBack()} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm hover:border-cyan-400">
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div className="text-sm text-slate-300">
                <span className="text-slate-500">Password note:</span> {activeNoteKey}
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-sm">
                {status === 'Disconnected' ? <WifiOff className="h-4 w-4 text-rose-300" /> : <Bluetooth className="h-4 w-4 text-cyan-300" />}
                {connectionLabel} · {saveState}
              </div>
            </div>

            <textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value)
                setSaveState('Unsaved')
              }}
              className="min-h-[calc(100vh-17rem)] w-full flex-1 resize-none rounded-2xl border border-slate-800 bg-slate-950 p-5 leading-7 outline-none transition focus:border-cyan-500"
              placeholder="Start typing..."
            />
            <div className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">Auto save every 2 seconds and after typing stops</div>
          </section>
        ) : null}
      </div>
    </Layout>
  )
}

export default App
