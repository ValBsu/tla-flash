import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Board, Folder } from '../types'
import { normalizePictogramCell } from './pictograms'

export interface DeletedBoard {
  id: string
  board: Board
  deletedAt: string
}

interface TlaDatabase extends DBSchema {
  boards: { key: string; value: Board }
  folders: { key: string; value: Folder }
  deletedBoards: { key: string; value: DeletedBoard }
}

export class StorageConflictError extends Error {
  constructor() {
    super('Ce TLA a changé dans un autre onglet. Rechargez sa dernière version avant de continuer.')
    this.name = 'StorageConflictError'
  }
}

let database: Promise<IDBPDatabase<TlaDatabase>> | undefined

// An unsuccessful opening must not permanently poison the repository for the session.
const getDatabase = () => {
  if (!database) {
    let connection: IDBPDatabase<TlaDatabase> | undefined
    let abandoned = false
    let rejectBlocked: (error: Error) => void = () => undefined
    const blocked = new Promise<IDBPDatabase<TlaDatabase>>((_resolve, reject) => { rejectBlocked = reject })
    const opening = openDB<TlaDatabase>('tla-flash', 4, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('deletedBoards')) db.createObjectStore('deletedBoards', { keyPath: 'id' })
      },
      blocked() {
        abandoned = true
        rejectBlocked(new Error('Un ancien onglet TLA Flash bloque la mise à jour du stockage. Fermez cet onglet puis réessayez.'))
      },
      blocking() { connection?.close(); database = undefined },
      terminated() { database = undefined },
    }).then((db) => {
      if (abandoned) { db.close(); throw new Error('Ouverture du stockage annulée.') }
      return db
    })
    database = Promise.race([opening, blocked]).then((db) => { connection = db; return db }).catch((error: unknown) => {
      database = undefined
      throw error
    })
  }
  return database
}

// Synchronous failures such as DataCloneError must abort too; otherwise earlier writes may commit.
const commit = async <T>(transaction: { abort(): void; done: Promise<void> }, work: () => Promise<T>): Promise<T> => {
  try {
    const result = await work()
    await transaction.done
    return result
  } catch (error) {
    try { transaction.abort() } catch { /* The browser may already have aborted this transaction. */ }
    await transaction.done.catch(() => undefined)
    throw error
  }
}

const normalizeMedia = (board: Board): Board => ({
  ...board,
  cells: board.cells.map(normalizePictogramCell),
  ...(board.overflowCells ? { overflowCells: board.overflowCells.map(normalizePictogramCell) } : {}),
})

const revisionOf = (board?: Board) => board?.revision ?? 0
// Wrap each call before starting the batch so a synchronous failure cannot orphan an earlier request.
const writeRequests = (operations: (() => Promise<unknown>)[]) => Promise.all(operations.map(async (operation) => operation()))

export const boardRepository = {
  async list(): Promise<Board[]> { return (await (await getDatabase()).getAll('boards')).map(normalizeMedia) },

  async save(board: Board): Promise<Board> {
    const transaction = (await getDatabase()).transaction(['boards', 'deletedBoards', 'folders'], 'readwrite')
    return commit(transaction, async () => {
      const store = transaction.objectStore('boards')
      const [current, deleted, folder] = await Promise.all([
        store.get(board.id), transaction.objectStore('deletedBoards').get(board.id),
        board.folderId ? transaction.objectStore('folders').get(board.folderId) : Promise.resolve(undefined),
      ])
      if (deleted || revisionOf(board) !== revisionOf(current)) throw new StorageConflictError()
      const saved = normalizeMedia({ ...board, folderId: folder ? board.folderId : undefined, revision: revisionOf(current) + 1 })
      await store.put(saved)
      return saved
    })
  },

  async remove(id: string): Promise<void> {
    const transaction = (await getDatabase()).transaction(['boards', 'deletedBoards'], 'readwrite')
    return commit(transaction, async () => {
      await writeRequests([() => transaction.objectStore('boards').delete(id), () => transaction.objectStore('deletedBoards').delete(id)])
    })
  },

  async trash(id: string, expectedRevision?: number): Promise<DeletedBoard> {
    const transaction = (await getDatabase()).transaction(['boards', 'deletedBoards'], 'readwrite')
    return commit(transaction, async () => {
      const boards = transaction.objectStore('boards')
      const board = await boards.get(id)
      if (!board || (expectedRevision !== undefined && revisionOf(board) !== expectedRevision)) throw new StorageConflictError()
      const deleted = { id, board, deletedAt: new Date().toISOString() }
      await writeRequests([() => transaction.objectStore('deletedBoards').put(deleted), () => boards.delete(id)])
      return { ...deleted, board: normalizeMedia(board) }
    })
  },

  async listDeleted(): Promise<DeletedBoard[]> {
    return (await (await getDatabase()).getAll('deletedBoards'))
      .map((item) => ({ ...item, board: normalizeMedia(item.board) }))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  },

  async restoreDeleted(id: string): Promise<Board> {
    const transaction = (await getDatabase()).transaction(['boards', 'deletedBoards', 'folders'], 'readwrite')
    return commit(transaction, async () => {
      const store = transaction.objectStore('boards')
      const deletedStore = transaction.objectStore('deletedBoards')
      const [deleted, current] = await Promise.all([deletedStore.get(id), store.get(id)])
      if (!deleted || current) throw new StorageConflictError()
      const folderExists = !deleted.board.folderId || await transaction.objectStore('folders').get(deleted.board.folderId)
      const restored = normalizeMedia({
        ...deleted.board,
        folderId: folderExists ? deleted.board.folderId : undefined,
        revision: revisionOf(deleted.board) + 1,
        updatedAt: new Date().toISOString(),
      })
      await writeRequests([() => store.put(restored), () => deletedStore.delete(id)])
      return restored
    })
  },

  async restore(boards: Board[], folders: Folder[] = []): Promise<Board[]> {
    const transaction = (await getDatabase()).transaction(['boards', 'folders', 'deletedBoards'], 'readwrite')
    return commit(transaction, async () => {
      const store = transaction.objectStore('boards')
      const deletedStore = transaction.objectStore('deletedBoards')
      const restored = await Promise.all(boards.map(async (board) => {
        const [current, deleted] = await Promise.all([store.get(board.id), deletedStore.get(board.id)])
        const saved = normalizeMedia({ ...board, revision: Math.max(revisionOf(current), revisionOf(deleted?.board)) + 1 })
        await writeRequests([() => store.put(saved), () => deletedStore.delete(board.id)])
        return saved
      }))
      await writeRequests(folders.map((folder) => () => transaction.objectStore('folders').put(folder)))
      return restored
    })
  },
}

export const folderRepository = {
  async list(): Promise<Folder[]> { return (await getDatabase()).getAll('folders') },
  async save(folder: Folder): Promise<void> { await (await getDatabase()).put('folders', folder) },
  async remove(id: string): Promise<Board[]> {
    const transaction = (await getDatabase()).transaction(['boards', 'folders'], 'readwrite')
    return commit(transaction, async () => {
      const store = transaction.objectStore('boards')
      const boards = (await store.getAll()).filter((board) => board.folderId === id)
        .map((board) => normalizeMedia({ ...board, folderId: undefined, revision: revisionOf(board) + 1 }))
      await writeRequests([...boards.map((board) => () => store.put(board)), () => transaction.objectStore('folders').delete(id)])
      return boards
    })
  },
}
