import { CheckCircle2, WifiOff, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { installPwa, pwaStatus, refreshApp } from '../pwa'

interface PwaStatusBarProps {
  compact?: boolean
}

export function PwaStatusBar({ compact = false }: PwaStatusBarProps) {
  const [status, setStatus] = useState(pwaStatus)
  const [showInstall, setShowInstall] = useState(false)
  const [showUpdate, setShowUpdate] = useState(false)

  useEffect(() => {
    const syncStatus = () => setStatus({ ...pwaStatus })

    const onInstallAvailable = () => {
      setShowInstall(true)
      syncStatus()
    }
    const onInstalled = () => {
      setShowInstall(false)
      syncStatus()
    }
    const onUpdateReady = () => {
      setShowUpdate(true)
      syncStatus()
    }
    const onOfflineReady = () => {
      syncStatus()
    }
    const onOnline = () => syncStatus()
    const onOffline = () => syncStatus()

    window.addEventListener('pwa:install-available', onInstallAvailable)
    window.addEventListener('pwa:installed', onInstalled)
    window.addEventListener('pwa:update-ready', onUpdateReady)
    window.addEventListener('pwa:offline-ready', onOfflineReady)
    window.addEventListener('pwa:online', onOnline)
    window.addEventListener('pwa:offline', onOffline)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    syncStatus()

    return () => {
      window.removeEventListener('pwa:install-available', onInstallAvailable)
      window.removeEventListener('pwa:installed', onInstalled)
      window.removeEventListener('pwa:update-ready', onUpdateReady)
      window.removeEventListener('pwa:offline-ready', onOfflineReady)
      window.removeEventListener('pwa:online', onOnline)
      window.removeEventListener('pwa:offline', onOffline)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  if (compact) {
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-300">
        <span className="flex items-center gap-2">
          {status.isOnline ? <Wifi className="h-4 w-4 text-emerald-400" /> : <WifiOff className="h-4 w-4 text-rose-400" />}
          {status.isOnline ? '🟢 Online' : '🔴 Offline'}
        </span>
        {status.isInstalled ? <span className="text-cyan-400">Installed</span> : null}
      </div>
    )
  }

  return (
    <div className="mb-4 space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm text-slate-300">
        <span className="flex items-center gap-2">
          {status.isOnline ? <Wifi className="h-4 w-4 text-emerald-400" /> : <WifiOff className="h-4 w-4 text-rose-400" />}
          {status.isOnline ? '🟢 Online' : '🔴 Offline'}
        </span>
        {status.isInstalled ? <span className="flex items-center gap-2 text-cyan-400"><CheckCircle2 className="h-4 w-4" />Installed</span> : null}
      </div>

      {showInstall && status.canInstall ? (
        <div className="rounded-2xl border border-cyan-800/60 bg-cyan-950/60 p-3 text-sm text-cyan-100">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>Install BluePad for Offline Use</span>
            <div className="flex gap-2">
              <button onClick={() => void installPwa()} className="rounded-xl bg-cyan-500 px-3 py-2 font-semibold text-slate-950">Install</button>
              <button onClick={() => setShowInstall(false)} className="rounded-xl border border-cyan-700 px-3 py-2">Later</button>
            </div>
          </div>
        </div>
      ) : null}

      {showUpdate ? (
        <div className="rounded-2xl border border-amber-800/60 bg-amber-950/60 p-3 text-sm text-amber-100">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>A new version is available</span>
            <div className="flex gap-2">
              <button onClick={() => void refreshApp()} className="rounded-xl bg-amber-400 px-3 py-2 font-semibold text-slate-950">Update Now</button>
              <button onClick={() => setShowUpdate(false)} className="rounded-xl border border-amber-700 px-3 py-2">Later</button>
            </div>
          </div>
        </div>
      ) : null}

      {!status.isOnline ? (
        <div className="rounded-2xl border border-rose-800/60 bg-rose-950/60 p-3 text-sm text-rose-100">Offline Mode</div>
      ) : null}
    </div>
  )
}
