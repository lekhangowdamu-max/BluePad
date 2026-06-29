import type { Note } from '../types'

const NOTE_KEY = 'bluepad-notes'
const PENDING_SYNC_KEY = 'bluepad-pending-sync'
const DB_NAME = 'bluepad-db'
const STORE_NAME = 'notes'
const NOTES_RECORD_KEY = 'notes'
const PENDING_RECORD_KEY = 'pendingSync'

export class NoteRepository {
  loadNotes(): Note[] {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(NOTE_KEY)
    return raw ? (JSON.parse(raw) as Note[]) : []
  }

  async loadNotesFromIndexedDb(): Promise<Note[]> {
    if (typeof window === 'undefined' || !window.indexedDB) return this.loadNotes()

    const notes = await this.readFromIndexedDb<Note[]>(NOTES_RECORD_KEY)
    if (notes) return notes

    const localNotes = this.loadNotes()
    if (localNotes.length > 0) {
      await this.persistToIndexedDb(localNotes, this.hasPendingChanges())
    }
    return localNotes
  }

  async saveNotes(notes: Note[]) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(NOTE_KEY, JSON.stringify(notes))
    window.localStorage.setItem(PENDING_SYNC_KEY, 'true')

    await this.persistToIndexedDb(notes, true)
  }

  async syncPendingChanges() {
    if (typeof window === 'undefined') return
    if (!navigator.onLine || !this.hasPendingChanges()) return

    const notes = await this.loadNotesFromIndexedDb()
    window.localStorage.setItem(NOTE_KEY, JSON.stringify(notes))
    window.localStorage.removeItem(PENDING_SYNC_KEY)
    await this.persistToIndexedDb(notes, false)
  }

  private hasPendingChanges() {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(PENDING_SYNC_KEY) === 'true'
  }

  private readFromIndexedDb<T>(key: string) {
    return new Promise<T | undefined>((resolve) => {
      this.withStore('readonly', (store, db) => {
        const getRequest = store.get(key)
        getRequest.onsuccess = () => {
          db.close()
          resolve(getRequest.result as T | undefined)
        }
        getRequest.onerror = () => {
          db.close()
          resolve(undefined)
        }
      }, () => resolve(undefined))
    })
  }

  private persistToIndexedDb(notes: Note[], pendingSync: boolean) {
    return new Promise<void>((resolve) => {
      this.withStore('readwrite', (store, db, transaction) => {
        store.put(notes, NOTES_RECORD_KEY)
        store.put(pendingSync, PENDING_RECORD_KEY)

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

    const request = window.indexedDB.open(DB_NAME, 1)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(STORE_NAME, mode)
      onStore(transaction.objectStore(STORE_NAME), db, transaction)
    }

    request.onerror = () => onUnavailable()
  }
}
