import type { Board, PictogramBank, PictogramResult } from '../types'
import { searchPictograms } from './arasaac'

export const bankName = (bank: PictogramBank) => bank === 'sclera' ? 'Sclera' : bank === 'makaton' ? 'Makaton' : 'ARASAAC'
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').replace(/[^a-z0-9]+/g, ' ').trim()
type IndexEntry = { id: number; label: string; keywords?: string[] }
const indexPromises: Partial<Record<PictogramBank, Promise<IndexEntry[]>>> = {}
const loadIndex = (bank: Exclude<PictogramBank, 'arasaac'>) => {
  if (!indexPromises[bank]) indexPromises[bank] = fetch(`${import.meta.env.BASE_URL}pictograms/${bank}/index.json`).then(async (response) => {
    if (!response.ok) throw new Error(`Banque ${bankName(bank)} indisponible`)
    return await response.json() as IndexEntry[]
  }).catch((error) => { delete indexPromises[bank]; throw error })
  return indexPromises[bank]!
}
export async function searchBank(term: string, bank: PictogramBank, signal?: AbortSignal): Promise<PictogramResult[]> {
  if (bank === 'arasaac') return searchPictograms(term, signal)
  const query = normalize(term)
  if (!query) return []
  const words = query.split(' ')
  const index = await loadIndex(bank)
  signal?.throwIfAborted()
  return index.map((entry) => ({ ...entry, normalized: normalize([entry.label, ...(entry.keywords ?? [])].join(' ')) }))
    .filter((entry) => words.every((word) => entry.normalized.split(' ').includes(word)))
    .sort((a, b) => Number(normalize(a.label) !== query) - Number(normalize(b.label) !== query) || a.label.length - b.label.length || a.id - b.id)
    .slice(0, 12).map(({ id, label, keywords }) => ({ id, label, keywords: keywords ?? [label], imageUrl: `${import.meta.env.BASE_URL}pictograms/${bank}/${id}.png` }))
}
export async function changeBoardBank(board: Board, bank: PictogramBank): Promise<Board> {
  const cells = await Promise.all(board.cells.map(async (cell) => {
    if (!cell.label.trim() || cell.source === 'upload' || cell.source === 'camera') return cell
    const result = (await searchBank(cell.searchTerm || cell.label, bank))[0]
    return { ...cell, source: result ? bank : null, pictogramId: result?.id, imageData: result?.imageUrl, imageMime: undefined }
  }))
  return { ...board, pictogramBank: bank, cells }
}
export function pictogramCredit(board: Board): string {
  const credits: string[] = []
  if (board.cells.some((cell) => cell.source === 'arasaac')) credits.push('ARASAAC (CC BY-NC-SA)')
  if (board.cells.some((cell) => cell.source === 'sclera')) credits.push('www.sclera.be (CC BY-NC 2.0 BE)')
  if (board.cells.some((cell) => cell.source === 'makaton')) credits.push('Makaton — Niveau 1 (fichiers fournis par l’utilisateur)')
  return credits.length ? `Pictogrammes : ${credits.join(' · ')}` : ''
}
