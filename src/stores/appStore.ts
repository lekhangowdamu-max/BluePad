import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Note } from '../types'
import { NoteRepository } from '../repositories/noteRepository'

interface AppState {
  notes: Note[]
  activeNoteKey?: string
  openOrCreateNote: (noteKey: string) => { note: Note; created: boolean }
  updateNoteContent: (noteKey: string, content: string) => void
  setActiveNoteKey: (noteKey?: string) => void
}

const repository = new NoteRepository()

const persistState = (notes: Note[]) => {
  repository.saveNotes(notes)
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      notes: repository.loadNotes(),
      activeNoteKey: undefined,
      openOrCreateNote: (noteKey) => {
        const existing = get().notes.find((item) => item.noteKey === noteKey)
        if (existing) {
          set({ activeNoteKey: existing.noteKey })
          return { note: existing, created: false }
        }

        const created: Note = {
          noteKey,
          content: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }

        set((state) => {
          const nextNotes = [created, ...state.notes]
          persistState(nextNotes)
          return { notes: nextNotes, activeNoteKey: created.noteKey }
        })

        return { note: created, created: true }
      },
      updateNoteContent: (noteKey, content) => {
        set((state) => {
          const existing = state.notes.find((note) => note.noteKey === noteKey)
          const nextNotes = existing
            ? state.notes.map((note) =>
                note.noteKey === noteKey
                  ? { ...note, content, updatedAt: new Date().toISOString() }
                  : note,
              )
            : [
                {
                  noteKey,
                  content,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
                ...state.notes,
              ]

          persistState(nextNotes)
          return { notes: nextNotes }
        })
      },
      setActiveNoteKey: (noteKey) => set({ activeNoteKey: noteKey }),
    }),
    {
      name: 'bluepad-store',
      partialize: (state) => ({ notes: state.notes, activeNoteKey: state.activeNoteKey }),
    },
  ),
)
