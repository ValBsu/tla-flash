import type { Board, PictogramBank } from '../types'
import { fetchWithTimeout, mapConcurrent } from './network'
import { normalizePictogramCell } from './pictograms'

// Keep these names aligned with runtimeCaching in vite.config.ts.
const IMAGE_CACHES: Record<PictogramBank, string> = {
  sclera: 'sclera-images-v2',
  makaton: 'makaton-images-v2',
  arasaac: 'arasaac-images-v2',
}

export type OfflineProgress = { total: number; cached: number }
type ImageReference = { url: string; bank: PictogramBank }

function boardImages(board: Board) {
  const embedded = new Set<string>()
  const external = new Map<string, ImageReference>()
  const baseUrl = new URL(import.meta.env.BASE_URL, globalThis.location?.href ?? 'http://localhost/')
  for (const original of [...board.cells, ...(board.overflowCells ?? [])]) {
    const cell = normalizePictogramCell(original)
    if (!cell.imageData) continue
    if (cell.imageData.startsWith('data:')) {
      embedded.add(cell.imageData)
      continue
    }
    const url = new URL(cell.imageData, baseUrl)
    const bank = cell.source
    const local = (bank === 'sclera' || bank === 'makaton') && url.origin === baseUrl.origin && url.pathname.startsWith(`${baseUrl.pathname}pictograms/${bank}/`) && /\/\d+\.png$/.test(url.pathname)
    const arasaac = bank === 'arasaac' && /^https:\/\/static\.arasaac\.org\/pictograms\/\d+\/\d+_500\.png$/.test(url.origin + url.pathname)
    if (!local && !arasaac) throw new Error('Une image de ce TLA doit être réimportée pour être disponible hors connexion.')
    external.set(url.href, { url: url.href, bank: bank as PictogramBank })
  }
  return { embedded: embedded.size, external: [...external.values()], total: embedded.size + external.size }
}

/** Counts unique embedded images and images present in the same caches used by the PWA. */
export async function checkBoardOffline(board: Board): Promise<OfflineProgress> {
  const images = boardImages(board)
  if (!('caches' in globalThis)) return { total: images.total, cached: images.embedded }
  const available = await Promise.all(images.external.map(async ({ url, bank }) => Boolean(await caches.match(url, { cacheName: IMAGE_CACHES[bank] }))))
  return { total: images.total, cached: images.embedded + available.filter(Boolean).length }
}

/** Saves only this board's images, including ARASAAC; partial progress survives interruption. */
export async function prepareBoardOffline(board: Board, signal?: AbortSignal, onProgress?: (progress: OfflineProgress) => void): Promise<OfflineProgress> {
  signal?.throwIfAborted()
  const images = boardImages(board)
  if (images.external.length && !('caches' in globalThis)) throw new Error('Le stockage hors connexion nécessite un navigateur compatible et une adresse HTTPS ou locale.')
  let cached = images.embedded
  onProgress?.({ total: images.total, cached })
  await mapConcurrent(images.external, async ({ url, bank }, _index, requestSignal) => {
    const cache = await caches.open(IMAGE_CACHES[bank])
    if (!await cache.match(url)) {
      const response = await fetchWithTimeout(url, requestSignal)
      requestSignal.throwIfAborted()
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/')) throw new Error('Une image n’a pas pu être téléchargée. Vérifie la connexion puis réessaie.')
      await cache.put(url, response)
    }
    requestSignal.throwIfAborted()
    cached += 1
    onProgress?.({ total: images.total, cached })
  }, signal)
  return { total: images.total, cached }
}
