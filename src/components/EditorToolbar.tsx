import { Bold, CheckSquare, Italic, List, ListOrdered, Underline } from 'lucide-react'

interface EditorToolbarProps {
  onFormat: (prefix: string, suffix?: string) => void
}

export function EditorToolbar({ onFormat }: EditorToolbarProps) {
  return (
    <div className="mb-3 flex flex-wrap gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 p-2">
      <button type="button" className="rounded-lg border border-slate-700 px-3 py-2 text-sm" onClick={() => onFormat('**', '**')}>
        <Bold size={16} />
      </button>
      <button type="button" className="rounded-lg border border-slate-700 px-3 py-2 text-sm" onClick={() => onFormat('*', '*')}>
        <Italic size={16} />
      </button>
      <button type="button" className="rounded-lg border border-slate-700 px-3 py-2 text-sm" onClick={() => onFormat('<u>', '</u>')}>
        <Underline size={16} />
      </button>
      <button type="button" className="rounded-lg border border-slate-700 px-3 py-2 text-sm" onClick={() => onFormat('- ')}>
        <List size={16} />
      </button>
      <button type="button" className="rounded-lg border border-slate-700 px-3 py-2 text-sm" onClick={() => onFormat('1. ')}>
        <ListOrdered size={16} />
      </button>
      <button type="button" className="rounded-lg border border-slate-700 px-3 py-2 text-sm" onClick={() => onFormat('[ ] ')}>
        <CheckSquare size={16} />
      </button>
    </div>
  )
}
