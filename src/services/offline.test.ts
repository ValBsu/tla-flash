import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyBoard } from '../types'
import { checkBoardOffline, prepareBoardOffline } from './offline'
import { pictogramImageUrl } from './pictograms'

afterEach(() => vi.unstubAllGlobals())

function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>()
  vi.stubGlobal('caches', {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return { match: async (url: string) => store.get(url), put: async (url: string, response: Response) => { store.set(url, response) } }
    },
    async match(url: string, { cacheName }: { cacheName: string }) { return stores.get(cacheName)?.get(url) },
  })
  return stores
}

describe('préparation hors connexion par TLA', () => {
  it('inclut ARASAAC, déduplique les images et réutilise les caches PWA', async () => {
    const stores = memoryCaches()
    const request = vi.fn(async () => new Response('image', { headers: { 'Content-Type': 'image/png' } }))
    vi.stubGlobal('fetch', request)
    const board = createEmptyBoard(1, 4)
    board.cells[0] = { ...board.cells[0], source: 'arasaac', pictogramId: 1, imageData: pictogramImageUrl('arasaac', 1) }
    board.cells[1] = { ...board.cells[1], source: 'arasaac', pictogramId: 1, imageData: pictogramImageUrl('arasaac', 1) }
    board.cells[2] = { ...board.cells[2], source: 'sclera', pictogramId: 2, imageData: '/old/pictograms/sclera/2.png' }
    board.cells[3] = { ...board.cells[3], source: 'upload', imageData: 'data:image/png;base64,YWJj' }
    expect(await checkBoardOffline(board)).toEqual({ total: 3, cached: 1 })
    const progress = vi.fn()
    expect(await prepareBoardOffline(board, undefined, progress)).toEqual({ total: 3, cached: 3 })
    expect(progress).toHaveBeenLastCalledWith({ total: 3, cached: 3 })
    expect(request).toHaveBeenCalledTimes(2)
    expect(stores.has('arasaac-images-v2')).toBe(true)
    expect(stores.has('sclera-images-v2')).toBe(true)
    expect(await checkBoardOffline(board)).toEqual({ total: 3, cached: 3 })
    await prepareBoardOffline(board)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('refuse une image externe inattendue avant de transmettre une requête', async () => {
    memoryCaches()
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    const board = createEmptyBoard(1, 1)
    board.cells[0].imageData = 'https://unexpected.invalid/private-image.png'
    await expect(prepareBoardOffline(board)).rejects.toThrow('réimportée')
    expect(request).not.toHaveBeenCalled()
  })

  it('ne déclare pas disponible une image remplacée par une page HTML', async () => {
    memoryCaches()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Erreur</html>', { headers: { 'Content-Type': 'text/html' } })))
    const board = createEmptyBoard(1, 1)
    board.cells[0] = { ...board.cells[0], source: 'sclera', pictogramId: 1, imageData: '/pictograms/sclera/1.png' }
    await expect(prepareBoardOffline(board)).rejects.toThrow('image')
    expect(await checkBoardOffline(board)).toEqual({ total: 1, cached: 0 })
  })
})
