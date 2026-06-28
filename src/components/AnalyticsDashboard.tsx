import type { AnalyticsSummary } from '../types'

interface AnalyticsDashboardProps {
  summary: AnalyticsSummary | null
  onClose: () => void
}

const metricCards = [
  { label: 'Total users', key: 'totalUsers' },
  { label: 'Notes created', key: 'totalNotesCreated' },
  { label: 'Daily active users', key: 'dailyActiveUsers' },
  { label: 'Bluetooth devices', key: 'connectedBluetoothDevices' },
] as const

export function AnalyticsDashboard({ summary, onClose }: AnalyticsDashboardProps) {
  if (!summary) {
    return null
  }

  const linePoints = summary.notesCreatedPerDay
    .map((item, index) => {
      const x = 12 + index * 42
      const y = 90 - item.count * 10
      return `${x},${Math.max(20, y)}`
    })
    .join(' ')

  const bars = summary.weeklyUsageStatistics.map((item) => {
    const height = Math.max(12, item.value * 16)
    return (
      <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
        <div className="flex h-28 items-end rounded-full bg-slate-900/80 p-1">
          <div className="w-full rounded-full bg-cyan-400" style={{ height: `${height}px` }} />
        </div>
        <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400">{item.label}</span>
      </div>
    )
  })

  return (
    <div className="relative flex min-h-screen flex-col bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex items-start justify-between rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/50">
          <div>
            <p className="text-xs uppercase tracking-[0.5em] text-cyan-400">Owner analytics</p>
            <h1 className="mt-2 text-3xl font-semibold">BlueNote performance overview</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Private telemetry for note usage, device health, and owner insights.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300"
          >
            Close
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
              <p className="text-sm text-slate-400">{card.label}</p>
              <p className="mt-2 text-3xl font-semibold text-white">{summary[card.key]}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Daily creation trend</p>
                <h2 className="text-xl font-semibold">Notes created over time</h2>
              </div>
            </div>
            <svg viewBox="0 0 240 100" className="mt-6 h-48 w-full rounded-2xl bg-slate-950/80 p-4">
              <line x1="10" y1="90" x2="230" y2="90" stroke="#334155" strokeWidth="1" />
              <polyline fill="none" stroke="#22d3ee" strokeWidth="2.5" points={linePoints} />
              {summary.notesCreatedPerDay.map((item, index) => (
                <circle key={item.date} cx={12 + index * 42} cy={Math.max(20, 90 - item.count * 10)} r="3" fill="#f8fafc" />
              ))}
            </svg>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <p className="text-sm text-slate-400">Device mix</p>
            <h2 className="text-xl font-semibold">Platforms</h2>
            <div className="mt-5 space-y-4">
              {summary.deviceTypeDistribution.map((entry) => (
                <div key={entry.label}>
                  <div className="mb-1 flex items-center justify-between text-sm text-slate-300">
                    <span>{entry.label}</span>
                    <span>{entry.value}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-800">
                    <div className="h-2 rounded-full bg-cyan-400" style={{ width: `${Math.max(10, entry.value * 20)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <p className="text-sm text-slate-400">Last week</p>
            <h2 className="text-xl font-semibold">Weekly usage</h2>
            <div className="mt-6 flex items-end gap-3">{bars}</div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <p className="text-sm text-slate-400">Most accessed notes</p>
            <h2 className="text-xl font-semibold">Top notes</h2>
            <div className="mt-4 space-y-3">
              {summary.mostAccessedNotes.map((entry) => (
                <div key={entry.noteKey} className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>{entry.noteKey}</span>
                    <span className="text-cyan-300">{entry.accessCount} hits</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
