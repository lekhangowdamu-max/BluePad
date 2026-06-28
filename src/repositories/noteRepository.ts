import type { Note } from '../types'

const NOTE_KEY = 'bluepad-notes'

export class NoteRepository {
  loadNotes(): Note[] {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(NOTE_KEY)
    return raw ? (JSON.parse(raw) as Note[]) : []
  }

  saveNotes(notes: Note[]) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(NOTE_KEY, JSON.stringify(notes))
  }
}
