import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyBoard } from '../types'

const opening = vi.hoisted(() => vi.fn())
vi.mock('idb', async (importOriginal) => ({ ...await importOriginal<typeof import('idb')>(), openDB: opening }))
const { openDB: actualOpenDB } = await vi.importActual<typeof import('idb')>('idb')

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('indexedDB', new IDBFactory())
  opening.mockReset().mockImplementation(actualOpenDB)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('stockage et conflits entre onglets', () => {
  it('réessaie une ouverture après un échec au lieu de conserver la promesse rejetée', async () => {
    opening.mockRejectedValueOnce(new Error('Stockage temporairement indisponible'))
    const { boardRepository } = await import('./storage')
    await expect(boardRepository.list()).rejects.toThrow('temporairement')
    await expect(boardRepository.list()).resolves.toEqual([])
    expect(opening).toHaveBeenCalledTimes(2)
  })

  it('incrémente les révisions et refuse une copie devenue obsolète', async () => {
    const { boardRepository, StorageConflictError } = await import('./storage')
    const first = await boardRepository.save(createEmptyBoard())
    expect(first.revision).toBe(1)
    const latest = await boardRepository.save({ ...first, title: 'Dernière version' })
    expect(latest.revision).toBe(2)
    await expect(boardRepository.save({ ...first, title: 'Ancien onglet' })).rejects.toBeInstanceOf(StorageConflictError)
    expect((await boardRepository.list())[0].title).toBe('Dernière version')
  })

  it('sérialise deux écritures concurrentes et refuse celle qui écraserait la première', async () => {
    const { boardRepository } = await import('./storage')
    const original = await boardRepository.save(createEmptyBoard())
    const outcomes = await Promise.allSettled([
      boardRepository.save({ ...original, title: 'Onglet A' }),
      boardRepository.save({ ...original, title: 'Onglet B' }),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect((await boardRepository.list())[0]).toMatchObject({ title: 'Onglet A', revision: 2 })
  })

  it('permet de modifier les tableaux historiques sans champ revision', async () => {
    const { boardRepository } = await import('./storage')
    await boardRepository.list()
    const db = await actualOpenDB('tla-flash', 4)
    const board = createEmptyBoard()
    await db.put('boards', board)
    db.close()
    expect((await boardRepository.save({ ...board, title: 'Compatible' })).revision).toBe(1)
  })

  it('préserve une copie issue d’un autre onglet quand son ancien dossier a été supprimé', async () => {
    const { boardRepository, folderRepository } = await import('./storage')
    await folderRepository.save({ id: 'ancien', name: 'Ancien dossier' })
    const previous = await boardRepository.save({ ...createEmptyBoard(), title: 'À conserver', folderId: 'ancien' })
    await folderRepository.remove('ancien')
    const copy = await boardRepository.save({ ...previous, id: crypto.randomUUID(), revision: undefined })
    expect(copy.folderId).toBeUndefined()
    expect(copy.cells).toEqual(previous.cells)
    expect(copy.title).toBe('À conserver')
    expect((await boardRepository.list()).every((board) => !board.folderId)).toBe(true)
  })

  it('restaure une suppression et empêche les autosaves de ressusciter le TLA', async () => {
    const { boardRepository } = await import('./storage')
    const board = await boardRepository.save(createEmptyBoard())
    await boardRepository.trash(board.id, board.revision)
    expect(await boardRepository.list()).toEqual([])
    expect((await boardRepository.listDeleted())[0].board).toEqual(board)
    await expect(boardRepository.save(board)).rejects.toMatchObject({ name: 'StorageConflictError' })
    const restored = await boardRepository.restoreDeleted(board.id)
    expect(restored.cells).toEqual(board.cells)
    expect(restored.revision).toBe(2)
    expect(await boardRepository.listDeleted()).toEqual([])
    await expect(boardRepository.save(board)).rejects.toMatchObject({ name: 'StorageConflictError' })
  })

  it('ne supprime pas une version modifiée depuis l’ouverture de la confirmation', async () => {
    const { boardRepository } = await import('./storage')
    const board = await boardRepository.save(createEmptyBoard())
    await boardRepository.save({ ...board, title: 'Nouvelle version' })
    await expect(boardRepository.trash(board.id, board.revision)).rejects.toMatchObject({ name: 'StorageConflictError' })
    expect(await boardRepository.listDeleted()).toEqual([])
    expect((await boardRepository.list())[0].title).toBe('Nouvelle version')
  })

  it('réattribue une révision lors d’un remplacement explicite par sauvegarde', async () => {
    const { boardRepository } = await import('./storage')
    const board = await boardRepository.save(createEmptyBoard())
    const restored = await boardRepository.restore([{ ...board, title: 'Import', revision: 99 }])
    expect(restored[0]).toMatchObject({ title: 'Import', revision: 2 })
    await expect(boardRepository.save(board)).rejects.toMatchObject({ name: 'StorageConflictError' })
  })

  it('préserve les tableaux existants après migration de la version 3', async () => {
    const db = await actualOpenDB('tla-flash', 3, { upgrade(connection) { connection.createObjectStore('boards', { keyPath: 'id' }); connection.createObjectStore('folders', { keyPath: 'id' }) } })
    const board = createEmptyBoard()
    await db.put('boards', board)
    db.close()
    const { boardRepository } = await import('./storage')
    expect((await boardRepository.list())[0]).toEqual(board)
    expect(await boardRepository.listDeleted()).toEqual([])
  })

  it('explique un blocage par un ancien onglet et réessaie après sa fermeture', async () => {
    const oldConnection = await actualOpenDB('tla-flash', 3, { upgrade(db) { db.createObjectStore('boards', { keyPath: 'id' }); db.createObjectStore('folders', { keyPath: 'id' }) } })
    const { boardRepository } = await import('./storage')
    await expect(boardRepository.list()).rejects.toThrow('ancien onglet')
    oldConnection.close()
    await expect(boardRepository.list()).resolves.toEqual([])
  })
})

describe('suppression atomique des dossiers', () => {
  it('désaffecte les tableaux et supprime leur dossier dans une seule transaction', async () => {
    const { boardRepository, folderRepository } = await import('./storage')
    await folderRepository.save({ id: 'repas', name: 'Repas' })
    const board = await boardRepository.save({ ...createEmptyBoard(), folderId: 'repas' })
    const modified = await folderRepository.remove('repas')
    expect(modified[0]).toMatchObject({ id: board.id, revision: 2, folderId: undefined })
    expect(await folderRepository.list()).toEqual([])
    expect((await boardRepository.list())[0].folderId).toBeUndefined()
  })

  it('conserve le dossier et tous les classements si une écriture échoue', async () => {
    const { boardRepository, folderRepository } = await import('./storage')
    await folderRepository.save({ id: 'repas', name: 'Repas' })
    const one = await boardRepository.save({ ...createEmptyBoard(), folderId: 'repas' })
    const two = await boardRepository.save({ ...createEmptyBoard(), folderId: 'repas' })
    const nativePut = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (typeof value === 'object' && value !== null && 'id' in value && value.id === two.id) throw new DOMException('Écriture refusée', 'DataCloneError')
      return key === undefined ? nativePut.call(this, value) : nativePut.call(this, value, key)
    })
    await expect(folderRepository.remove('repas')).rejects.toThrow('Écriture refusée')
    expect((await boardRepository.list()).filter((board) => board.folderId === 'repas').map((board) => board.id).sort()).toEqual([one.id, two.id].sort())
    expect(await folderRepository.list()).toEqual([{ id: 'repas', name: 'Repas' }])
  })
})
