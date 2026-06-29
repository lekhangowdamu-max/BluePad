import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Note } from '../types'
import { NoteRepository } from '../repositories/noteRepository'

interface AppState {
  notes: Note[]
  activeNoteKey?: string
  hydrateNotes: () => Promise<void>
  openOrCreateNote: (noteKey: string, activate?: boolean) => Promise<{ note: Note; created: boolean }>
  upsertRemoteNote: (note: Note) => void
  updateNoteContent: (noteKey: string, content: string) => Promise<Note>
  setActiveNoteKey: (noteKey?: string) => void
  syncPendingChanges: () => Promise<void>
}

const repository = new NoteRepository()

const mergeNote = (notes: Note[], nextNote: Note) => {
  const noteKey = nextNote.passwordKey ?? nextNote.noteKey
  const exists = notes.some((note) => note.noteKey === noteKey)
  if (!exists) return [nextNote, ...notes]
  return notes.map((note) => (note.noteKey === noteKey ? nextNote : note))
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      notes: [],
      activeNoteKey: undefined,
      hydrateNotes: async () => {
        const notes = await repository.loadNotesFromIndexedDb()
        set({ notes })
      },
      openOrCreateNote: async (noteKey, activate = true) => {
        const result = await repository.openOrCreateByPassword(noteKey)
        set((state) => ({
          notes: mergeNote(state.notes, result.note),
          activeNoteKey: activate ? result.note.noteKey : state.activeNoteKey,
        }))
        return result
      },
      upsertRemoteNote: (note) => {
        set((state) => ({ notes: mergeNote(state.notes, note) }))
      },
      updateNoteContent: async (noteKey, content) => {
        const existing = get().notes.find((note) => note.noteKey === noteKey)
        const now = new Date().toISOString()
        const note: Note = existing
          ? { ...existing, content, updatedAt: now }
          : {
              id: crypto.randomUUID(),
              noteKey,
              passwordKey: noteKey,
              content,
              createdAt: now,
              updatedAt: now,
            }

        const saved = await repository.saveNote(note)
        set((state) => ({ notes: mergeNote(state.notes, saved) }))
        return saved
      },
      setActiveNoteKey: (noteKey) => set({ activeNoteKey: noteKey }),
      syncPendingChanges: async () => {
        await repository.syncPendingChanges()
      },
    }),
    {
      name: 'bluepad-store',
      partialize: (state) => ({ activeNoteKey: state.activeNoteKey }),
    },
  ),
)
