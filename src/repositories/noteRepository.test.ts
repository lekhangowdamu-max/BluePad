// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteRepository } from './noteRepository'

describe('NoteRepository', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('persists notes to storage and indexeddb', async () => {
    const requests: Array<{ type: string; value?: unknown }> = []
    const store = new Map<string, unknown>()

    const openRequest = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      result: null as IDBDatabase | null,
    }

    const transaction = {
      objectStore: () => ({
        put: (value: unknown, key: string) => {
          requests.push({ type: 'put', value })
          store.set(key, value)
          window.setTimeout(() => transaction.oncomplete?.(), 0)
          return { onsuccess: null, onerror: null }
        },
      }),
      oncomplete: null as (() => void) | null,
      onerror: null as ((event: Event) => void) | null,
    }

    const db = {
      transaction: () => transaction,
      close: () => undefined,
    }

    const indexedDBMock = {
      open: vi.fn(() => {
        const request = openRequest as unknown as IDBOpenDBRequest
        Object.defineProperty(request, 'result', { value: db, configurable: true })
        window.setTimeout(() => request.onsuccess?.(new Event('success')), 0)
        return request
      }),
    }

    Object.defineProperty(window, 'indexedDB', { value: indexedDBMock, configurable: true })

    const repository = new NoteRepository()
    const notes = [{ noteKey: 'alpha', content: 'hello', createdAt: 'now', updatedAt: 'now' }]

    await repository.saveNotes(notes)

    expect(window.localStorage.getItem('bluepad-notes')).toContain('alpha')
    expect(store.get('notes')).toEqual(notes)
  })
})
