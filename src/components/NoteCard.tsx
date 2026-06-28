import { Clock3 } from 'lucide-react'
import type { Note } from '../types'

interface NoteCardProps {
  note: Note
  onOpen: () => void
}

export function NoteCard({ note, onOpen }: NoteCardProps) {
  return (
    <button onClick={onOpen} className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-left transition hover:border-cyan-500/40">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold">{note.noteKey}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <Clock3 size={12} />
        <span>{new Date(note.updatedAt).toLocaleString()}</span>
      </div>
    </button>
  )
}
