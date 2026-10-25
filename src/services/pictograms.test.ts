import { readFileSync, existsSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyBoard } from '../types'
import { changeBoardBank, searchBank, pictogramCredit } from './pictograms'
import { isBackupData } from './backup'

const catalog = JSON.parse(readFileSync('public/pictograms/sclera/index.json', 'utf8'))
afterEach(() => vi.unstubAllGlobals())

describe('banque française Sclera', () => {
  it('recherche dans le vrai catalogue sans accents et privilégie le mot exact', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => catalog }))
    const results = await searchBank('ÉCOLE', 'sclera')
    expect(results[0].label).toBe('école')
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) expect(existsSync(`public/pictograms/sclera/${result.id}.png`)).toBe(true)
    expect(await searchBank('motinexistantxyz', 'sclera')).toEqual([])
  })
  it('change les images, conserve la mise en page et laisse seulement le mot sans correspondance', async () => {
    const board = createEmptyBoard(1, 3)
    board.cells[0] = { ...board.cells[0], label: 'ÉCOLE', source: 'arasaac', imageData: 'old', textColor: '#112233', blackAndWhite: true }
    board.cells[1] = { ...board.cells[1], label: 'motinexistantxyz', source: 'arasaac', imageData: 'old' }
    board.cells[2] = { ...board.cells[2], label: 'Photo', source: 'upload', imageData: 'data:image/png;base64,abc' }
    const next = await changeBoardBank(board, 'sclera')
    expect(next.pictogramBank).toBe('sclera')
    expect(next.cells[0]).toMatchObject({ source: 'sclera', label: 'ÉCOLE', textColor: '#112233', blackAndWhite: true, row: 0, column: 0 })
    expect(next.cells[1]).toMatchObject({ label: 'motinexistantxyz', source: null, imageData: undefined })
    expect(next.cells[2]).toEqual(board.cells[2])
    expect(board.cells[0].imageData).toBe('old')
    expect(pictogramCredit(next)).toContain('www.sclera.be')
    expect(isBackupData({ format: 'tla-studio-backup', version: 1, exportedAt: '', boards: [next], folders: [] })).toBe(true)
  })
})

describe('banque Makaton Niveau 1', () => {
  const catalog = JSON.parse(readFileSync('public/pictograms/makaton/index.json', 'utf8')) as { id: number; label: string; keywords: string[] }[]

  it('recherche les fichiers fournis sans tenir compte des accents et des variantes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => catalog }))
    const results = await searchBank('boire', 'makaton')
    expect(results[0].label).toBe('Boire')
    expect(results[0].imageUrl).toBe(`${import.meta.env.BASE_URL}pictograms/makaton/${results[0].id}.png`)
    expect(existsSync(`public/pictograms/makaton/${results[0].id}.png`)).toBe(true)
    expect((await searchBank('bus', 'makaton')).some((result) => result.label === 'Bus')).toBe(true)
    expect(await searchBank('motinexistantxyz', 'makaton')).toEqual([])
    expect(catalog).toHaveLength(69)
    for (const entry of catalog) expect(existsSync(`public/pictograms/makaton/${entry.id}.png`)).toBe(true)
  })

  it('conserve la banque dans les TLA restaurés et crédite les pictogrammes Makaton', () => {
    const board = createEmptyBoard(1, 1)
    board.pictogramBank = 'makaton'
    board.cells[0] = { ...board.cells[0], label: 'BOIRE', source: 'makaton', pictogramId: 4, imageData: '/pictograms/makaton/4.png' }
    expect(isBackupData({ format: 'tla-studio-backup', version: 1, exportedAt: '', boards: [board], folders: [] })).toBe(true)
    expect(pictogramCredit(board)).toContain('Makaton — Niveau 1')
  })
})
