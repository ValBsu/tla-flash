import { readFileSync, existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    expect(isBackupData({ format: 'tla-studio-backup', version: 1, exportedAt: '2026-10-25T12:00:00.000Z', boards: [next], folders: [] })).toBe(true)
  })
})

describe('recherche bornée et références de pictogrammes', () => {
  beforeEach(() => vi.resetModules())

  it('partage le catalogue entre consommateurs sans propager leur annulation', async () => {
    let finish!: (response: Response) => void
    const request = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve }))
    vi.stubGlobal('fetch', request)
    const { searchBank: search } = await import('./pictograms')
    const controller = new AbortController()
    const cancelled = search('école', 'sclera', controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    const remaining = search('école', 'sclera')
    finish(new Response(JSON.stringify([{ id: 1, label: 'école' }])))
    expect((await remaining)[0].label).toBe('école')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('mémorise les résultats sans laisser un appelant modifier le cache', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 1, label: 'école' }, { id: 2, label: 'grande école' }])))
    vi.stubGlobal('fetch', request)
    const { searchBank: search } = await import('./pictograms')
    const first = await search('ÉCOLE', 'sclera')
    first[0].label = 'modifié'
    first[0].keywords.push('modifié')
    const second = await search('ecole', 'sclera')
    expect(second.map((result) => result.label)).toEqual(['école', 'grande école'])
    expect(second[0].keywords).toEqual(['école'])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('borne le nombre de recherches distantes mémorisées', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify([{ _id: 1, keywords: ['résultat'] }])))
    vi.stubGlobal('fetch', request)
    const { searchBank: search } = await import('./pictograms')
    for (let index = 0; index < 201; index += 1) await search(`terme${index}`, 'arasaac')
    await search('terme200', 'arasaac')
    expect(request).toHaveBeenCalledTimes(201)
    await search('terme0', 'arasaac')
    expect(request).toHaveBeenCalledTimes(202)
  })

  it('déduplique le changement de banque et limite à quatre requêtes simultanées', async () => {
    const waiting: (() => void)[] = []
    let active = 0
    let maximum = 0
    const request = vi.fn((input: RequestInfo | URL) => new Promise<Response>((resolve) => {
      active += 1
      maximum = Math.max(active, maximum)
      const word = decodeURIComponent(String(input).split('/').at(-1)!)
      waiting.push(() => {
        active -= 1
        resolve(new Response(JSON.stringify([{ _id: Number(word.slice(-1)) + 1, keywords: [word] }])))
      })
    }))
    vi.stubGlobal('fetch', request)
    const { changeBoardBank: change } = await import('./pictograms')
    const board = createEmptyBoard(1, 10)
    board.cells = board.cells.map((cell, index) => ({ ...cell, label: `mot${index % 8}`, source: 'sclera' }))
    const changed = change(board, 'arasaac')
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4))
    waiting.splice(0).forEach((finish) => finish())
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(8))
    waiting.splice(0).forEach((finish) => finish())
    const result = await changed
    expect(maximum).toBe(4)
    expect(result.cells.map((cell) => cell.pictogramId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 1, 2])
    expect(board.cells[0].source).toBe('sclera')
  })

  it('répare les chemins entre hébergements en préservant les médias embarqués', async () => {
    const { normalizePictogramCell: repair, pictogramImageUrl: url } = await import('./pictograms')
    const cell = { ...createEmptyBoard(1, 1).cells[0], source: 'sclera' as const, pictogramId: 12, imageData: '/ancien/pictograms/sclera/12.png' }
    expect(repair(cell).imageData).toBe(`${import.meta.env.BASE_URL}pictograms/sclera/12.png`)
    expect(repair({ ...cell, source: 'arasaac' }).imageData).toBe(url('arasaac', 12))
    const embedded = { ...cell, imageData: 'data:image/png;base64,YWJj' }
    expect(repair(embedded)).toBe(embedded)
    const photo = { ...cell, source: 'upload' as const }
    expect(repair(photo)).toBe(photo)
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
    expect(isBackupData({ format: 'tla-studio-backup', version: 1, exportedAt: '2026-10-25T12:00:00.000Z', boards: [board], folders: [] })).toBe(true)
    expect(pictogramCredit(board)).toContain('Makaton — Niveau 1')
  })
})
