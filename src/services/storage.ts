import { openDB, type DBSchema } from 'idb'
import type { Board, Folder } from '../types'

interface TlaDatabase extends DBSchema {
  boards: { key: string; value: Board }
  folders: { key: string; value: Folder }
}

const database = openDB<TlaDatabase>('tla-flash', 3, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'id' })
    if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' })
  },
})

export const boardRepository = {
  async list() { return (await database).getAll('boards') },
  async save(board: Board) { await (await database).put('boards', board) },
  async remove(id: string) { await (await database).delete('boards', id) },
  async restore(boards: Board[], folders: Folder[] = []) {
    const db = await database
    const transaction = db.transaction(['boards', 'folders'], 'readwrite')
    await Promise.all([
      ...boards.map((board) => transaction.objectStore('boards').put(board)),
      ...folders.map((folder) => transaction.objectStore('folders').put(folder)),
    ])
    await transaction.done
  },
}

export const folderRepository = {
  async list() { return (await database).getAll('folders') },
  async save(folder: Folder) { await (await database).put('folders', folder) },
  async remove(id: string) { await (await database).delete('folders', id) },
}
