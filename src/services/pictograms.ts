import type { Board, Cell, PictogramBank, PictogramResult } from '../types'
import { arasaacImageUrl, searchPictograms } from './arasaac'
import { abortable, fetchJson, mapConcurrent } from './network'

export const bankName = (bank: PictogramBank) => bank === 'sclera' ? 'Sclera' : bank === 'makaton' ? 'Makaton' : 'ARASAAC'
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').replace(/[^a-z0-9]+/g, ' ').trim()
type IndexEntry = { id: number; label: string; keywords?: string[] }
type PreparedEntry = IndexEntry & { normalizedLabel: string; tokens: string[] }
const indexPromises: Partial<Record<PictogramBank, Promise<PreparedEntry[]>>> = {}
const resultCache = new Map<string, { results: PictogramResult[]; expiresAt: number }>()
const MAX_CACHED_SEARCHES = 200
const cloneResults = (results: PictogramResult[]) => results.map((result) => ({ ...result, keywords: [...result.keywords] }))
const searchKey = (term: string, bank: PictogramBank) => bank === 'arasaac' ? term.normalize('NFC').trim().toLocaleLowerCase('fr-FR') : normalize(term)

export const pictogramImageUrl = (bank: PictogramBank, id: number) => bank === 'arasaac' ? arasaacImageUrl(id) : `${import.meta.env.BASE_URL}pictograms/${bank}/${id}.png`

/** Embedded images travel with ZIP files; only external bank references need rebasing. */
export function normalizePictogramCell(cell: Cell): Cell {
  if (cell.imageData?.startsWith('data:')) return cell
  if ((cell.source === 'sclera' || cell.source === 'makaton' || cell.source === 'arasaac') && Number.isSafeInteger(cell.pictogramId) && cell.pictogramId! > 0) {
    const imageData = pictogramImageUrl(cell.source, cell.pictogramId!)
    if (imageData !== cell.imageData) return { ...cell, imageData, imageMime: undefined }
  }
  return cell
}

const loadIndex = (bank: Exclude<PictogramBank, 'arasaac'>) => {
  if (!indexPromises[bank]) indexPromises[bank] = fetchJson(`${import.meta.env.BASE_URL}pictograms/${bank}/index.json`).then((payload) => {
    if (!Array.isArray(payload)) throw new Error(`Catalogue ${bankName(bank)} illisible`)
    return payload.filter((entry): entry is IndexEntry => Boolean(entry) && Number.isSafeInteger(entry.id) && entry.id > 0 && typeof entry.label === 'string' && (entry.keywords === undefined || (Array.isArray(entry.keywords) && entry.keywords.every((word: unknown) => typeof word === 'string'))))
      .map((entry) => ({ ...entry, normalizedLabel: normalize(entry.label), tokens: normalize([entry.label, ...(entry.keywords ?? [])].join(' ')).split(' ') }))
  }).catch((error) => { delete indexPromises[bank]; throw error })
  return indexPromises[bank]!
}
export async function searchBank(term: string, bank: PictogramBank, signal?: AbortSignal): Promise<PictogramResult[]> {
  signal?.throwIfAborted()
  const query = searchKey(term, bank)
  if (!query) return []
  const key = `${bank}:${query}`
  const cached = resultCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    resultCache.delete(key)
    resultCache.set(key, cached)
    return cloneResults(cached.results)
  }
  let results: PictogramResult[]
  if (bank === 'arasaac') results = await searchPictograms(term, signal)
  else {
    const words = query.split(' ')
    const index = await abortable(loadIndex(bank), signal)
    signal?.throwIfAborted()
    results = index.filter((entry) => words.every((word) => entry.tokens.includes(word)))
      .sort((a, b) => Number(a.normalizedLabel !== query) - Number(b.normalizedLabel !== query) || a.label.length - b.label.length || a.id - b.id)
      .slice(0, 12).map(({ id, label, keywords }) => ({ id, label, keywords: keywords ? [...keywords] : [label], imageUrl: pictogramImageUrl(bank, id) }))
  }
  signal?.throwIfAborted()
  resultCache.delete(key)
  resultCache.set(key, { results: cloneResults(results), expiresAt: bank === 'arasaac' ? Date.now() + 5 * 60_000 : Number.POSITIVE_INFINITY })
  if (resultCache.size > MAX_CACHED_SEARCHES) resultCache.delete(resultCache.keys().next().value!)
  return results
}
export async function changeBoardBank(board: Board, bank: PictogramBank, signal?: AbortSignal): Promise<Board> {
  const eligible = (cell: Cell) => Boolean(cell.label.trim()) && cell.source !== 'upload' && cell.source !== 'camera'
  const termFor = (cell: Cell) => cell.searchTerm?.trim() || cell.label
  const terms = new Map(board.cells.filter(eligible).map((cell) => [searchKey(termFor(cell), bank), termFor(cell)]))
  const matches = await mapConcurrent([...terms], async ([key, term], _index, requestSignal) => [key, (await searchBank(term, bank, requestSignal))[0]] as const, signal)
  const byTerm = new Map(matches)
  const cells = board.cells.map((cell) => {
    if (!eligible(cell)) return cell
    const result = byTerm.get(searchKey(termFor(cell), bank))
    return { ...cell, source: result ? bank : null, pictogramId: result?.id, imageData: result?.imageUrl, imageMime: undefined }
  })
  return { ...board, pictogramBank: bank, cells }
}
export function pictogramCredit(board: Board): string {
  const credits: string[] = []
  if (board.cells.some((cell) => cell.source === 'arasaac')) credits.push('ARASAAC (CC BY-NC-SA)')
  if (board.cells.some((cell) => cell.source === 'sclera')) credits.push('www.sclera.be (CC BY-NC 2.0 BE)')
  if (board.cells.some((cell) => cell.source === 'makaton')) credits.push('Makaton — Niveau 1 (fichiers fournis par l’utilisateur)')
  return credits.length ? `Pictogrammes : ${credits.join(' · ')}` : ''
}
