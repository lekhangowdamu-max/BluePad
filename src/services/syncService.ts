import type { Note } from '../types'

export class SyncService {
  static syncNotes(localNotes: Note[], remoteNotes: Note[]) {
    const merged = [...localNotes]
    const remoteMap = new Map(remoteNotes.map((note) => [note.noteKey, note]))

    localNotes.forEach((note) => {
      const remote = remoteMap.get(note.noteKey)
      if (!remote) {
        return
      }

      const localUpdated = new Date(note.updatedAt).getTime()
      const remoteUpdated = new Date(remote.updatedAt).getTime()
      if (localUpdated >= remoteUpdated) {
        remoteMap.set(note.noteKey, note)
      }
    })

    remoteMap.forEach((note) => {
      if (!merged.some((item) => item.noteKey === note.noteKey)) {
        merged.push(note)
      }
    })

    return merged
  }
}
