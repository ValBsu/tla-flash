import { openDB, type DBSchema } from 'idb'
import type { Board, Folder } from '../types'

interface TlaDatabase extends DBSchema {
  boards: { key: string; value: Board }
  folders: { key: string; value: Folder }
}

const database = openDB<TlaDatabase>('tla-flash', 1, {
  upgrade(db) {
    db.createObjectStore('boards', { keyPath: 'id' })
    db.createObjectStore('folders', { keyPath: 'id' })
  },
})

export const boardRepository = {
  async list() { return (await database).getAll('boards') },
  async save(board: Board) { await (await database).put('boards', board) },
  async remove(id: string) { await (await database).delete('boards', id) },
}

export const folderRepository = {
  async list() { return (await database).getAll('folders') },
  async save(folder: Folder) { await (await database).put('folders', folder) },
}
