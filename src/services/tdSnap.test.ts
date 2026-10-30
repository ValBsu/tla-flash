// @vitest-environment node
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { createEmptyBoard } from '../types'
import { createTdSnapBlob, createTdSnapExport, createTdSnapFilename, inspectTdSnapTemplate } from './tdSnap'
import { makeNativeTemplate, pageUuid, png, pngData, speak } from './__fixtures__/tdSnapNative'

const schema = readFileSync(fileURLToPath(new URL('./__fixtures__/tdSnapSchema.sql', import.meta.url)), 'utf8')
const wasm = new Uint8Array(readFileSync(fileURLToPath(new URL('../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url))))
const personalBase = new Uint8Array(readFileSync(fileURLToPath(new URL('../assets/td-snap-personal-base.spb', import.meta.url))))
let SQL: SqlJsStatic
let template: Uint8Array<ArrayBuffer>
let fetchMock: ReturnType<typeof vi.fn>
const rows = (db: Database, sql: string) => db.exec(sql)[0]?.values ?? []
const open = async (blob: Blob) => new SQL.Database(new Uint8Array(await blob.arrayBuffer()))

beforeAll(async () => {
  SQL = await initSqlJs({ wasmBinary: wasm.buffer })
  template = await makeNativeTemplate(SQL, schema)
})
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('sql-wasm')) return new Response(wasm)
    if (String(input).includes('td-snap-personal-base')) return new Response(personalBase)
    return new Response(png, { headers: { 'content-type': 'image/png' } })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('mise à jour d’une page TD Snap personnelle', () => {
  it('propose les pages utilisables et exclut les pages globales', async () => {
    expect(await inspectTdSnapTemplate(template)).toEqual([
      { id: 4, uniqueId: pageUuid, title: 'Ma page personnelle' },
      { id: 7, uniqueId: 'another-page', title: 'Autre page' },
    ])
  })

  it('préserve les identités et les autres pages avec grille trouée, médias et styles', async () => {
    const board = createEmptyBoard(2, 3)
    board.title = 'Été : l’eau et "oui"'
    board.cells[1] = { ...board.cells[1], label: 'Été', source: 'upload', imageData: pngData, textCase: 'lowercase',
      colorOverride: '#65b96d', textColor: '#ff0000', textSize: 'small', bold: false }
    board.cells[4] = { ...board.cells[4], label: 'oui', source: 'upload', imageData: pngData, category: 'social', textSize: 'large' }
    board.overflowCells = [{ ...board.cells[0], id: 'overflow', label: 'HORS GRILLE', imageData: 'https://images.example/ne-pas-exporter.png' }]
    const snapshot = structuredClone(board)
    const originalBytes = template.slice()
    const database = await open(await createTdSnapBlob(board, template, 4))
    const native = new SQL.Database(template)
    try {
      expect(rows(database, 'PRAGMA integrity_check')).toEqual([['ok']])
      expect(rows(database, 'PRAGMA foreign_key_check')).toEqual([])
      const identities = 'SELECT Id,UniqueId,Title,CAST(SyncHash AS TEXT),SerializedMetadata FROM Page ORDER BY Id'
      expect(rows(database, identities)).toEqual(rows(native, identities))
      expect(rows(database, 'SELECT CAST(SyncHash AS TEXT),CAST(Timestamp AS TEXT),* FROM PageSetProperties'))
        .toEqual(rows(native, 'SELECT CAST(SyncHash AS TEXT),CAST(Timestamp AS TEXT),* FROM PageSetProperties'))
      expect(rows(database, 'SELECT * FROM Synchronization')).toEqual(rows(native, 'SELECT * FROM Synchronization'))
      expect(rows(database, 'SELECT Title,GridDimension,Language FROM Page WHERE Id=4')).toEqual([['Ma page personnelle', '3,2', 'fr_FR']])
      expect(rows(database, 'SELECT PageLayoutSetting FROM PageLayout WHERE PageId=4 ORDER BY Id')).toEqual([['3,2,False,0'], ['3,2,True,0']])
      for (const query of ['SELECT * FROM Page WHERE Id<>4', 'SELECT * FROM PageLayout WHERE PageId<>4', 'SELECT * FROM ElementReference WHERE PageId<>4', 'SELECT * FROM ElementPlacement WHERE PageLayoutId NOT IN (9,10)', 'SELECT * FROM Button WHERE Id=51', 'SELECT * FROM MessageWindowElement', 'SELECT * FROM WhiteboardImage']) {
        expect(rows(database, query)).toEqual(rows(native, query))
      }
      expect(rows(database, 'SELECT Label,Message,FontSize,FontStyle FROM Button WHERE Id<>51 ORDER BY Id')).toEqual([
        ['été', 'Été', 1, 0], ['OUI', 'oui', 2, 1],
      ])
      expect(rows(database, 'SELECT GridPosition,GridSpan FROM ElementPlacement WHERE PageLayoutId=9 ORDER BY Id')).toEqual([['1,0', '1,1'], ['1,1', '1,1']])
      expect(rows(database, 'SELECT count(*) FROM ElementPlacement WHERE PageLayoutId IN (9,10)')).toEqual([[4]])
      expect(rows(database, 'SELECT ForegroundColor,BackgroundColor FROM ElementReference WHERE PageId=4 ORDER BY Id')).toEqual([[-65536, -10110611], [-14273742, -2585930]])
      expect(rows(database, 'SELECT Id,RefCount FROM PageSetData ORDER BY Id')).toEqual([[11, 3], [13, 1], [14, 1], [15, 1], [16, 1]])
      expect(Array.from(rows(database, 'SELECT Data FROM PageSetData WHERE Id=11')[0][0] as Uint8Array)).toEqual(Array.from(png))
      expect(rows(database, 'SELECT ButtonId,PageUniqueId FROM ButtonPageLink')).toEqual([[51, pageUuid]])
      for (const [command] of rows(database, 'SELECT SerializedCommands FROM CommandSequence')) expect(JSON.parse(String(command))).toEqual(JSON.parse(speak))
      expect(rows(database, 'SELECT count(*) FROM ScanGroup WHERE PageLayoutId IN (9,10)')).toEqual([[0]])
      expect(rows(database, 'SELECT LibrarySymbolId,MessageRecordingId FROM Button WHERE Id<>51')).toEqual([[0, 0], [0, 0]])
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('ne-pas-exporter'))).toBe(false)
      expect(board).toEqual(snapshot)
      expect(template).toEqual(originalBytes)
    } finally { database.close(); native.close() }
  })

  it('renouvelle les boutons en gardant la même page de destination à chaque export', async () => {
    const board = createEmptyBoard(1, 1)
    board.cells[0].label = 'Bonjour'
    const first = await open(await createTdSnapBlob(board, template, 4))
    const second = await open(await createTdSnapBlob(board, template, 4))
    try {
      expect(rows(first, 'SELECT UniqueId FROM Page WHERE Id=4')).toEqual([[pageUuid]])
      expect(rows(second, 'SELECT UniqueId FROM Page WHERE Id=4')).toEqual([[pageUuid]])
      const query = 'SELECT b.UniqueId FROM Button b JOIN ElementReference e ON e.Id=b.ElementReferenceId WHERE e.PageId=4'
      expect(rows(first, query)[0][0]).not.toEqual(rows(second, query)[0][0])
    } finally { first.close(); second.close() }
  })

  it('exporte mots seuls, images seules et dimensions maximales sans déplacer les cases vides', async () => {
    const board = createEmptyBoard(10, 15)
    board.cells[2].imageData = pngData
    board.cells[149].label = 'dernière case'
    const database = await open(await createTdSnapBlob(board, template, 4))
    try {
      expect(rows(database, 'SELECT GridDimension FROM Page WHERE Id=4')).toEqual([['15,10']])
      expect(rows(database, 'SELECT Label,Message,PageSetImageId FROM Button WHERE Id<>51 ORDER BY Id')).toEqual([['', null, 11], ['DERNIÈRE CASE', 'dernière case', 0]])
      expect(rows(database, 'SELECT GridPosition FROM ElementPlacement WHERE PageLayoutId=9 ORDER BY Id')).toEqual([['2,0'], ['14,9']])
    } finally { database.close() }
  })

  it('résout les trois banques et incorpore les images distantes', async () => {
    const board = createEmptyBoard(1, 3)
    board.cells = board.cells.map((cell, index) => ({ ...cell, label: `Mot ${index}`, source: (['arasaac', 'sclera', 'makaton'] as const)[index], pictogramId: index + 1 }))
    const database = await open(await createTdSnapBlob(board, template, 4))
    try {
      const urls = fetchMock.mock.calls.map(([url]) => String(url))
      expect(urls).toContain('https://static.arasaac.org/pictograms/1/1_500.png')
      expect(urls).toContain('/pictograms/sclera/2.png')
      expect(urls).toContain('/pictograms/makaton/3.png')
      expect(rows(database, 'SELECT RefCount FROM PageSetData WHERE Id=11')).toEqual([[4]])
    } finally { database.close() }
  })

  it('convertit une photo en PNG et applique le noir et blanc sans perdre la transparence', async () => {
    const board = createEmptyBoard(1, 1)
    board.cells[0] = { ...board.cells[0], label: 'Photo', source: 'upload', imageData: 'data:image/jpeg;base64,/9j/', blackAndWhite: true }
    vi.stubGlobal('Image', class {
      naturalWidth = 1; naturalHeight = 1
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()) }
    })
    const pixels = new Uint8ClampedArray([255, 0, 0, 100])
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: pixels })), putImageData: vi.fn() }
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ width: 0, height: 0, getContext: () => context, toDataURL: () => pngData })) })
    const database = await open(await createTdSnapBlob(board, template, 4))
    try {
      expect(Array.from(pixels)).toEqual([54, 54, 54, 100])
      expect(context.putImageData).toHaveBeenCalledOnce()
      expect(Array.from(rows(database, 'SELECT Data FROM PageSetData WHERE Id=11')[0][0] as Uint8Array)).toEqual(Array.from(png))
    } finally { database.close() }
  })

  it('interrompt l’export quand une image manque et borne une requête bloquée', async () => {
    const board = createEmptyBoard(1, 1)
    board.cells[0] = { ...board.cells[0], label: 'CHAT', imageData: 'https://images.example/manquant.png' }
    fetchMock.mockImplementation(async () => new Response('', { status: 404 }))
    await expect(createTdSnapBlob(board, template, 4)).rejects.toThrow(/TD Snap n’a pas été créé.*CHAT/)
    vi.useFakeTimers()
    fetchMock.mockClear()
    fetchMock.mockImplementation(() => new Promise(() => undefined))
    const rejection = expect(createTdSnapBlob(board, template, 4)).rejects.toThrow('CHAT')
    await vi.advanceTimersByTimeAsync(8_000)
    await rejection
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
  })

  it('refuse une grille ambiguë, un mauvais fichier et une page globale', async () => {
    const board = createEmptyBoard(1, 2)
    board.cells[1].column = 0
    await expect(createTdSnapBlob(board, template, 4)).rejects.toThrow('positions')
    await expect(inspectTdSnapTemplate(new TextEncoder().encode('not SQLite'))).rejects.toThrow()
    await expect(createTdSnapBlob(createEmptyBoard(1, 1), template, 2)).rejects.toThrow()
    expect(createTdSnapFilename('Été / eau : oui?')).toBe('Été - eau - oui-.spb')
  })

  it('refuse un modèle sans bouton ordinaire ou une page sous licence', async () => {
    const database = new SQL.Database(template)
    database.run('DELETE FROM CommandSequence;')
    await expect(inspectTdSnapTemplate(database.export())).rejects.toThrow(/bouton|page personnelle/i)
    database.close()
    const licensed = new SQL.Database(template)
    licensed.run('UPDATE Page SET SerializedMetadata=? WHERE PageType=1', ['{"ContentIdentifier":"licensed-content"}NATIVE-METADATA'])
    await expect(inspectTdSnapTemplate(licensed.export())).rejects.toThrow(/personnelle/i)
    licensed.close()
  })

  it('refuse un modèle automatique contenant plusieurs destinations possibles', async () => {
    fetchMock.mockResolvedValueOnce(new Response(template))
    await expect(createTdSnapExport(createEmptyBoard(1, 1))).rejects.toThrow('Impossible de charger le modèle TD Snap')
  })

  it('exporte directement avec la base validée, réessaie un chargement échoué et conserve la même page', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    const board = { ...createEmptyBoard(1, 2), title: 'Repas' }
    board.cells[1] = { ...board.cells[1], label: 'MANGER', source: 'upload', imageData: pngData }
    await expect(createTdSnapExport(board)).rejects.toThrow('Impossible de charger le modèle TD Snap')
    const first = await createTdSnapExport(board)
    const second = await createTdSnapExport({ ...board, title: 'École', cells: board.cells.map((cell) => ({ ...cell, label: cell.label ? 'ÉCOLE' : '' })) })
    expect(first.filename).toBe('Repas.spb')
    expect(second.filename).toBe('École.spb')
    expect(first.pageTitle).toBe('Arasaac')
    expect(second.pageTitle).toBe('Arasaac')
    const native = new SQL.Database(personalBase)
    const firstDb = await open(first.blob)
    const secondDb = await open(second.blob)
    try {
      const identities = 'SELECT Id,UniqueId,Title,CAST(SyncHash AS TEXT),SerializedMetadata FROM Page ORDER BY Id'
      expect(rows(firstDb, identities)).toEqual(rows(native, identities))
      expect(rows(secondDb, identities)).toEqual(rows(native, identities))
      expect(rows(firstDb, 'SELECT * FROM PageSetProperties')).toEqual(rows(native, 'SELECT * FROM PageSetProperties'))
      expect(rows(firstDb, 'SELECT Label FROM Button')).toEqual([['MANGER']])
      expect(rows(secondDb, 'SELECT Label FROM Button')).toEqual([['ÉCOLE']])
      expect(rows(firstDb, 'SELECT GridPosition FROM ElementPlacement WHERE PageLayoutId=4')).toEqual([['1,0']])
      expect(rows(firstDb, 'PRAGMA integrity_check')).toEqual([['ok']])
      expect(rows(firstDb, 'PRAGMA foreign_key_check')).toEqual([])
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('td-snap-personal-base'))).toHaveLength(2)
    } finally { native.close(); firstDb.close(); secondDb.close() }
  })
})
