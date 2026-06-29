import type { Note } from '../types'

const LEGACY_NOTE_KEY = 'bluepad-notes'
const DB_NAME = 'bluepad-db'
const STORE_NAME = 'notes'

interface NoteRecord {
  id: string
  password_key: string
  content: string
  created_at: string
  updated_at: string
}

const toNote = (record: NoteRecord): Note => ({
  id: record.id,
  noteKey: record.password_key,
  passwordKey: record.password_key,
  content: record.content,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
})

const toRecord = (note: Note): NoteRecord => ({
  id: note.id ?? crypto.randomUUID(),
  password_key: note.passwordKey ?? note.noteKey,
  content: note.content,
  created_at: note.createdAt,
  updated_at: note.updatedAt,
})

export class NoteRepository {
  loadNotes(): Note[] {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(LEGACY_NOTE_KEY)
    return raw ? (JSON.parse(raw) as Note[]) : []
  }

  async loadNotesFromIndexedDb(): Promise<Note[]> {
    if (typeof window === 'undefined' || !window.indexedDB) return this.loadNotes()

    const notes = await this.getAllRecords()
    if (notes.length > 0) return notes.map(toNote)

    const legacyNotes = this.loadNotes()
    if (legacyNotes.length > 0) {
      await this.saveNotes(legacyNotes)
    }
    return legacyNotes
  }

  async openOrCreateByPassword(passwordKey: string): Promise<{ note: Note; created: boolean }> {
    const existing = await this.findByPassword(passwordKey)
    if (existing) return { note: toNote(existing), created: false }

    const now = new Date().toISOString()
    const record: NoteRecord = {
      id: crypto.randomUUID(),
      password_key: passwordKey,
      content: '',
      created_at: now,
      updated_at: now,
    }

    await this.putRecord(record)
    return { note: toNote(record), created: true }
  }

  async saveNote(note: Note): Promise<Note> {
    const record = toRecord({
      ...note,
      updatedAt: note.updatedAt || new Date().toISOString(),
    })
    await this.putRecord(record)
    return toNote(record)
  }

  async saveNotes(notes: Note[]) {
    await Promise.all(notes.map((note) => this.saveNote(note)))
  }

  async syncPendingChanges() {
    return Promise.resolve()
  }

  private async findByPassword(passwordKey: string): Promise<NoteRecord | undefined> {
    return new Promise((resolve) => {
      this.withStore('readonly', (store, db) => {
        const index = store.index('password_key')
        const request = index.get(passwordKey)
        request.onsuccess = () => {
          db.close()
          resolve(request.result as NoteRecord | undefined)
        }
        request.onerror = () => {
          db.close()
          resolve(undefined)
        }
      }, () => resolve(undefined))
    })
  }

  private async getAllRecords(): Promise<NoteRecord[]> {
    return new Promise((resolve) => {
      this.withStore('readonly', (store, db) => {
        const request = store.getAll()
        request.onsuccess = () => {
          db.close()
          resolve(request.result as NoteRecord[])
        }
        request.onerror = () => {
          db.close()
          resolve([])
        }
      }, () => resolve([]))
    })
  }

  private putRecord(record: NoteRecord): Promise<void> {
    return new Promise((resolve) => {
      this.withStore('readwrite', (store, db, transaction) => {
        store.put(record)
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () => {
          db.close()
          resolve()
        }
      }, resolve)
    })
  }

  private withStore(
    mode: IDBTransactionMode,
    onStore: (store: IDBObjectStore, db: IDBDatabase, transaction: IDBTransaction) => void,
    onUnavailable: () => void,
  ) {
    if (typeof window === 'undefined' || !window.indexedDB) {
      onUnavailable()
      return
    }

    const request = window.indexedDB.open(DB_NAME, 2)

    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME)
      }
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      store.createIndex('password_key', 'password_key', { unique: true })
      store.createIndex('updated_at', 'updated_at')
    }

    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(STORE_NAME, mode)
      onStore(transaction.objectStore(STORE_NAME), db, transaction)
    }

    request.onerror = () => onUnavailable()
  }
}
