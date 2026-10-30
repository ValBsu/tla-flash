import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import personalBaseUrl from '../assets/td-snap-personal-base.spb?url'
import { categoryColors, type Board, type Cell } from '../types'
import { normalizePictogramCell } from './pictograms'
import { fetchWithTimeout, mapConcurrent } from './network'

const IMAGE_LIMIT = 20 * 1024 * 1024
const EXPORT_LIMIT = 128 * 1024 * 1024
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
type PreparedImage = { bytes: Uint8Array<ArrayBuffer>; identifier: string }
export type TdSnapPage = { id: number; uniqueId: string; title: string }
let runtimePromise: Promise<SqlJsStatic> | undefined
let personalBasePromise: Promise<{ bytes: Uint8Array<ArrayBuffer>; page: TdSnapPage }> | undefined

export const createTdSnapFilename = (title: string): string => {
  const name = [...title.normalize('NFC')].filter((character) => character.charCodeAt(0) >= 32).join('')
    .replace(/[<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 120)
  return `${name || 'mon-tla'}.spb`
}

/** The personal base supplied by the user, whose import was confirmed on their iPad. */
const loadPersonalBase = () => {
  personalBasePromise ??= fetchWithTimeout(personalBaseUrl).then(async (response) => {
    const bytes = new Uint8Array(await response.arrayBuffer())
    const pages = await inspectTdSnapTemplate(bytes)
    if (pages.length !== 1) throw new Error('Le modèle TD Snap doit contenir une seule page personnelle de destination.')
    return { bytes, page: pages[0] }
  }).catch((cause: unknown) => {
    personalBasePromise = undefined
    throw new Error('Impossible de charger le modèle TD Snap. Actualisez l’application, puis réessayez.', { cause })
  })
  return personalBasePromise
}

/** One-click export: reuses the same native personal page, never invents a new signed identity. */
export async function createTdSnapExport(board: Board): Promise<{ blob: Blob; filename: string; pageTitle: string }> {
  const { bytes, page } = await loadPersonalBase()
  const blob = await createTdSnapBlob(board, bytes, page.id)
  return { blob, filename: createTdSnapFilename(board.title), pageTitle: page.title }
}

const loadRuntime = () => {
  runtimePromise ??= fetchWithTimeout(wasmUrl).then((response) => response.arrayBuffer())
    .then((wasmBinary) => initSqlJs({ wasmBinary }))
    .catch(() => {
      runtimePromise = undefined
      throw new Error('Impossible de préparer l’export TD Snap. Rechargez l’application, puis réessayez.')
    })
  return runtimePromise
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

const fromDataUrl = (source: string): { bytes: Uint8Array<ArrayBuffer>; mime: string } => {
  const comma = source.indexOf(',')
  if (comma < 0 || source.length > IMAGE_LIMIT * 1.5) throw new Error('Image trop volumineuse ou illisible.')
  const header = source.slice(0, comma)
  const binary = header.endsWith(';base64') ? atob(source.slice(comma + 1)) : decodeURIComponent(source.slice(comma + 1))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return { bytes, mime: header.slice(5).split(';')[0] || 'image/png' }
}

const validPng = (bytes: Uint8Array): boolean => bytes.length >= 24
  && PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16) > 0
  && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20) > 0

const convertToPng = async (source: string, grayscale: boolean): Promise<Uint8Array<ArrayBuffer>> => {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    const timer = setTimeout(() => finish(new Error('Délai de préparation de l’image dépassé.')), 4_000)
    const finish = (error?: Error) => {
      clearTimeout(timer)
      element.onload = null
      element.onerror = null
      if (error) { element.src = ''; reject(error) }
      else resolve(element)
    }
    element.onload = () => finish()
    element.onerror = () => finish(new Error('Image illisible.'))
    element.src = source
  })
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Image vide.')
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('La conversion des images est indisponible.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  if (grayscale) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = Math.round(pixels.data[index] * 0.2126 + pixels.data[index + 1] * 0.7152 + pixels.data[index + 2] * 0.0722)
      pixels.data[index] = gray
      pixels.data[index + 1] = gray
      pixels.data[index + 2] = gray
    }
    context.putImageData(pixels, 0, 0)
  }
  return fromDataUrl(canvas.toDataURL('image/png')).bytes
}

const prepareImages = async (cells: Cell[]): Promise<Map<string, PreparedImage>> => {
  const cache = new Map<string, Promise<PreparedImage>>()
  const uniqueMedia = new Set<string>()
  const prepared = new Map<string, PreparedImage>()
  let totalBytes = 0
  await mapConcurrent(cells.filter((cell) => cell.imageData), async (cell, _index, signal) => {
    const source = cell.imageData!
    const key = `${cell.blackAndWhite ? 'gray:' : 'color:'}${source}`
    let pending = cache.get(key)
    if (!pending) {
      pending = (async () => {
        const input = source.startsWith('data:') ? fromDataUrl(source) : await (async () => {
          const response = await fetchWithTimeout(source, signal, 8_000)
          if (Number(response.headers.get('content-length')) > IMAGE_LIMIT) throw new Error('Image trop volumineuse.')
          return { bytes: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get('content-type') || 'image/png' }
        })()
        if (input.bytes.length > IMAGE_LIMIT) throw new Error('Image trop volumineuse.')
        const bytes = !cell.blackAndWhite && validPng(input.bytes) ? input.bytes
          : await convertToPng(`data:${input.mime};base64,${toBase64(input.bytes)}`, Boolean(cell.blackAndWhite))
        if (!validPng(bytes) || bytes.length > IMAGE_LIMIT) throw new Error('Image PNG illisible ou trop volumineuse.')
        signal.throwIfAborted()
        const identifier = `IMG:${toBase64(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes)))}`
        if (!uniqueMedia.has(identifier)) {
          uniqueMedia.add(identifier)
          totalBytes += bytes.length
          if (totalBytes > EXPORT_LIMIT) throw new Error('Le fichier dépasse 128 Mo. Réduisez les photos avant de réessayer.')
        }
        return { bytes, identifier }
      })()
      cache.set(key, pending)
    }
    try { prepared.set(cell.id, await pending) } catch {
      const label = cell.label.trim().slice(0, 80) || `case ${cell.row + 1}, ${cell.column + 1}`
      throw new Error(`Le fichier TD Snap n’a pas été créé : impossible de préparer l’image de « ${label} ». Vérifiez la connexion ou remplacez cette image, puis réessayez.`)
    }
  })
  return prepared
}

const colorValue = (value: string | undefined, fallback: string): number => {
  const color = /^#[0-9a-f]{6}$/i.test(value ?? '') ? value! : fallback
  return (Number.parseInt(color.slice(1), 16) | 0xff000000)
}

const run = (database: Database, sql: string, values: SqlValue[] = []) => database.run(sql, values)
const rows = (database: Database, sql: string, values: SqlValue[] = []): SqlValue[][] => database.exec(sql, values)[0]?.values ?? []
const quoteName = (name: string) => `"${name.replaceAll('"', '""')}"`

const REQUIRED_COLUMNS: Record<string, string[]> = {
  Page: ['Id', 'UniqueId', 'Title', 'PageType', 'GridDimension', 'Timestamp', 'SyncHash', 'SerializedMetadata', 'PageSetImageId'],
  PageSetProperties: ['Id', 'SchemaVersion', 'ContentIdentifier', 'DefaultKeyboardPageUniqueId', 'ToolBarUniqueId', 'DashboardUniqueId', 'MessageBarUniqueId', 'IconImageId'],
  PageLayout: ['Id', 'PageId', 'PageLayoutSetting'],
  ElementReference: ['Id', 'PageId', 'ElementType', 'ForegroundColor', 'BackgroundColor', 'AudioCue', 'AudioCueRecordingId', 'UseAudioCueRecording', 'SerializedAudioCueSoundMetadata', 'SerializedAccessSettingOverrides'],
  Button: ['Id', 'ElementReferenceId', 'UniqueId', 'Label', 'Message', 'LabelOwnership', 'ImageOwnership', 'LibrarySymbolId', 'PageSetImageId', 'SymbolColorDataId', 'MessageRecordingId', 'UseMessageRecording', 'SerializedMessageSoundMetadata', 'FontFamily', 'FontSize', 'FontStyle', 'SmartSymLayout', 'BorderColor', 'BorderThickness', 'CommandFlags', 'ContentType', 'ActiveContentType', 'ContentTag', 'LinkIndicatorStyle', 'SerializedContentTypeHandler'],
  CommandSequence: ['Id', 'ButtonId', 'SerializedCommands'],
  ElementPlacement: ['Id', 'ElementReferenceId', 'PageLayoutId', 'GridPosition', 'GridSpan', 'Visible'],
  ScanGroup: ['Id', 'PageLayoutId', 'AudioCueRecordingId'],
  ButtonPageLink: ['Id', 'ButtonId'],
  PageSetData: ['Id', 'Identifier', 'Data', 'RefCount'],
}
const MEDIA_REFERENCES = [
  ['Button', 'PageSetImageId'], ['Button', 'MessageRecordingId'],
  ['ElementReference', 'AudioCueRecordingId'], ['ScanGroup', 'AudioCueRecordingId'],
  ['Page', 'PageSetImageId'], ['PageSetProperties', 'IconImageId'],
  ['Whiteboard', 'ThumbnailImageId'], ['WhiteboardImage', 'PageSetImageId'],
] as const
const NO_PERSONAL_PAGE = 'Ce fichier ne contient aucune page personnelle compatible. Dans TD Snap, créez une page personnelle avec au moins un bouton qui énonce un mot, puis exportez cette page au format .spb.'

type NativeButton = { buttonId: number; elementId: number; command: string }

const schemaColumns = (database: Database, table: string): string[] => rows(database, `PRAGMA table_info(${quoteName(table)})`).map((row) => String(row[1]))

const validateFile = (bytes: Uint8Array) => {
  if (bytes.length > EXPORT_LIMIT) throw new Error('Le fichier TD Snap dépasse 128 Mo. Exportez seulement la page personnelle à utiliser.')
  const signature = 'SQLite format 3\0'
  if (bytes.length < 100 || [...signature].some((character, index) => bytes[index] !== character.charCodeAt(0))) {
    throw new Error('Choisissez un fichier .spb exporté depuis TD Snap.')
  }
}

const openTemplate = async (bytes: Uint8Array): Promise<Database> => {
  validateFile(bytes)
  const SQL = await loadRuntime()
  let database: Database | undefined
  try {
    database = new SQL.Database(new Uint8Array(bytes))
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      const columns = new Set(schemaColumns(database, table))
      if (required.some((name) => !columns.has(name))) throw new Error('schema')
    }
    const schema = rows(database, 'SELECT SchemaVersion FROM PageSetProperties')
    if (schema.length !== 1 || !['4.13', '4.20'].includes(String(schema[0][0]))) throw new Error('schema')
    if (rows(database, "SELECT name FROM sqlite_master WHERE type='trigger'").length
      || rows(database, 'PRAGMA integrity_check')[0]?.[0] !== 'ok'
      || database.exec('PRAGMA foreign_key_check').length) throw new Error('integrity')
    return database
  } catch {
    database?.close()
    throw new Error('Ce fichier TD Snap est illisible ou utilise un format non pris en charge. Exportez une page personnelle au format .spb depuis TD Snap.')
  }
}

const ordinarySpeakCommand = (value: SqlValue): value is string => {
  if (typeof value !== 'string') return false
  try {
    const command = JSON.parse(value)
    const action = command?.$values?.[0]
    return command?.$type === '1' && Object.keys(command).length === 2
      && Array.isArray(command.$values) && command.$values.length === 1
      && action?.$type === '3' && action.MessageAction === 0 && Object.keys(action).length === 2
  } catch { return false }
}

const nativeButton = (database: Database, pageId: number): NativeButton | undefined => {
  const candidates = rows(database, `SELECT b.Id,e.Id,c.SerializedCommands FROM Button b
    JOIN ElementReference e ON e.Id=b.ElementReferenceId
    JOIN CommandSequence c ON c.ButtonId=b.Id
    WHERE e.PageId=? AND e.ElementType=0 AND b.ContentType=6 AND b.ActiveContentType=0 AND b.CommandFlags=8
      AND b.SerializedContentTypeHandler IS NULL
      AND (SELECT count(*) FROM CommandSequence WHERE ButtonId=b.Id)=1 ORDER BY b.Id`, [pageId])
  for (const [buttonId, elementId, command] of candidates) {
    if (ordinarySpeakCommand(command)) return { buttonId: Number(buttonId), elementId: Number(elementId), command }
  }
}

const personalMetadata = (value: SqlValue): boolean => {
  if (typeof value !== 'string') return false
  // Native exports append an opaque signature to this JSON object. Keep both unchanged.
  const end = value.lastIndexOf('}')
  if (end < 0 || end === value.length - 1) return false
  try { return JSON.parse(value.slice(0, end + 1)).ContentIdentifier === '' } catch { return false }
}

const compatiblePages = (database: Database): TdSnapPage[] => {
  const globals = new Set(rows(database, `SELECT DefaultKeyboardPageUniqueId,ToolBarUniqueId,DashboardUniqueId,MessageBarUniqueId FROM PageSetProperties`)[0]
    .filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase()))
  return rows(database, 'SELECT Id,UniqueId,Title,SerializedMetadata FROM Page WHERE PageType=1 ORDER BY Id').flatMap(([id, uniqueId, title, metadata]) => {
    const pageId = Number(id)
    if (!Number.isSafeInteger(pageId) || typeof uniqueId !== 'string' || !uniqueId
      || globals.has(uniqueId.toLowerCase()) || !personalMetadata(metadata)) return []
    const layouts = rows(database, 'SELECT Id,PageLayoutSetting FROM PageLayout WHERE PageId=?', [pageId])
    if (!layouts.length || layouts.some(([, settings]) => typeof settings !== 'string' || !/^\d+,\d+,(?:True|False),\d+$/.test(settings))) return []
    if (rows(database, 'SELECT Id FROM ElementReference WHERE PageId=? AND (ElementType IS NULL OR ElementType<>0) LIMIT 1', [pageId]).length
      || !nativeButton(database, pageId)) return []
    return [{ id: pageId, uniqueId, title: typeof title === 'string' && title.trim() ? title : 'Page sans titre' }]
  })
}

/** Lists existing personal pages that can receive a TLA without creating a new page identity. */
export async function inspectTdSnapTemplate(bytes: Uint8Array): Promise<TdSnapPage[]> {
  const database = await openTemplate(bytes)
  try {
    const pages = compatiblePages(database)
    if (!pages.length) throw new Error(NO_PERSONAL_PAGE)
    return pages
  } finally { database.close() }
}

/** Clone records inside SQLite: JS Numbers would round native 64-bit values. */
const cloneNativeRow = (database: Database, table: 'Button' | 'ElementReference'): number => {
  const columns = schemaColumns(database, table).filter((name) => name !== 'Id').map(quoteName).join(',')
  database.run(`INSERT INTO ${quoteName(table)} (${columns}) SELECT ${columns} FROM ${quoteName(`TlaNative${table}`)}`)
  return Number(rows(database, 'SELECT last_insert_rowid()')[0][0])
}

const protectedSnapshot = (database: Database): string => {
  const properties = schemaColumns(database, 'PageSetProperties').map((name) => `quote(${quoteName(name)})`).join(',')
  return JSON.stringify([
    rows(database, 'SELECT quote(Id),quote(UniqueId),quote(Title),quote(SerializedMetadata),quote(SyncHash) FROM Page ORDER BY Id'),
    rows(database, `SELECT ${properties} FROM PageSetProperties ORDER BY Id`),
  ])
}

const validContentReferences = (database: Database): boolean => !rows(database, `SELECT 1 FROM Button b
  LEFT JOIN ElementReference e ON e.Id=b.ElementReferenceId WHERE e.Id IS NULL
  UNION ALL SELECT 1 FROM CommandSequence c LEFT JOIN Button b ON b.Id=c.ButtonId WHERE b.Id IS NULL
  UNION ALL SELECT 1 FROM ElementReference e LEFT JOIN Page p ON p.Id=e.PageId WHERE p.Id IS NULL
  UNION ALL SELECT 1 FROM PageLayout l LEFT JOIN Page p ON p.Id=l.PageId WHERE p.Id IS NULL
  UNION ALL SELECT 1 FROM ElementPlacement ep LEFT JOIN ElementReference e ON e.Id=ep.ElementReferenceId
    LEFT JOIN PageLayout l ON l.Id=ep.PageLayoutId WHERE e.Id IS NULL OR l.Id IS NULL OR e.PageId<>l.PageId
  LIMIT 1`).length

const refreshMediaReferences = (database: Database) => {
  const sources = MEDIA_REFERENCES.filter(([table, column]) => schemaColumns(database, table).includes(column))
    .map(([table, column]) => `SELECT ${quoteName(column)} AS mediaId FROM ${quoteName(table)}`)
  database.run(`CREATE TEMP TABLE TlaMediaReferences AS SELECT mediaId,count(*) AS RefCount FROM (${sources.join(' UNION ALL ')}) WHERE mediaId>0 GROUP BY mediaId`)
  database.run(`UPDATE PageSetData SET RefCount=COALESCE((SELECT RefCount FROM TlaMediaReferences WHERE mediaId=PageSetData.Id),0)`)
  database.run('DELETE FROM PageSetData WHERE RefCount=0')
}

const sameBytes = (first: Uint8Array, second: Uint8Array) => first.length === second.length && first.every((value, index) => value === second[index])

/** Updates one existing personal page; its native identity, name and metadata stay intact. */
export async function createTdSnapBlob(board: Board, templateBytes: Uint8Array, pageId: number): Promise<Blob> {
  if (!Number.isInteger(board.rows) || board.rows < 1 || board.rows > 10
    || !Number.isInteger(board.columns) || board.columns < 1 || board.columns > 15) throw new Error('La grille du TLA est invalide.')
  const positions = new Set<string>()
  const ids = new Set<string>()
  for (const cell of board.cells) {
    const position = `${cell.column},${cell.row}`
    if (!Number.isInteger(cell.row) || !Number.isInteger(cell.column) || cell.row < 0 || cell.row >= board.rows
      || cell.column < 0 || cell.column >= board.columns || positions.has(position) || ids.has(cell.id)) throw new Error('Les positions des cases du TLA sont invalides.')
    positions.add(position)
    ids.add(cell.id)
  }
  const database = await openTemplate(templateBytes)
  try {
    if (!Number.isSafeInteger(pageId) || !compatiblePages(database).some((page) => page.id === pageId)) throw new Error(NO_PERSONAL_PAGE)
    const sample = nativeButton(database, pageId)!
    const cells = board.cells.map(normalizePictogramCell).filter((cell) => cell.label.trim() || cell.imageData)
    const images = await prepareImages(cells)
    const snapshot = protectedSnapshot(database)
    const dimension = `${board.columns},${board.rows}`
    const ticks = (621355968000000000n + BigInt(Date.now()) * 10000n).toString()
    const layouts = rows(database, 'SELECT Id,PageLayoutSetting FROM PageLayout WHERE PageId=? ORDER BY Id', [pageId])
    database.run('PRAGMA secure_delete=ON')
    run(database, 'CREATE TEMP TABLE TlaNativeButton AS SELECT * FROM Button WHERE Id=?', [sample.buttonId])
    run(database, 'CREATE TEMP TABLE TlaNativeElementReference AS SELECT * FROM ElementReference WHERE Id=?', [sample.elementId])
    database.run('BEGIN')
    const oldButtons = 'SELECT b.Id FROM Button b JOIN ElementReference e ON e.Id=b.ElementReferenceId WHERE e.PageId=?'
    run(database, `DELETE FROM CommandSequence WHERE ButtonId IN (${oldButtons})`, [pageId])
    run(database, `DELETE FROM ButtonPageLink WHERE ButtonId IN (${oldButtons})`, [pageId])
    run(database, 'DELETE FROM Button WHERE ElementReferenceId IN (SELECT Id FROM ElementReference WHERE PageId=?)', [pageId])
    run(database, 'DELETE FROM ElementPlacement WHERE PageLayoutId IN (SELECT Id FROM PageLayout WHERE PageId=?)', [pageId])
    run(database, 'DELETE FROM ScanGroup WHERE PageLayoutId IN (SELECT Id FROM PageLayout WHERE PageId=?)', [pageId])
    run(database, 'DELETE FROM ElementReference WHERE PageId=? AND ElementType=0', [pageId])
    run(database, 'UPDATE Page SET GridDimension=?,Timestamp=CAST(? AS INTEGER) WHERE Id=?', [dimension, ticks, pageId])
    for (const [layoutId, settings] of layouts) {
      run(database, 'UPDATE PageLayout SET PageLayoutSetting=? WHERE Id=?', [`${dimension},${String(settings).split(',').slice(2).join(',')}`, layoutId])
    }
    const mediaIds = new Map<string, number>()
    for (const cell of cells) {
      const image = images.get(cell.id)
      let imageId = image ? mediaIds.get(image.identifier) : undefined
      if (image && imageId === undefined) {
        const existing = rows(database, 'SELECT Id,Data FROM PageSetData WHERE Identifier=?', [image.identifier])
        if (existing.length) {
          if (existing.length !== 1 || !(existing[0][1] instanceof Uint8Array) || !sameBytes(existing[0][1], image.bytes)) {
            throw new Error('Une image du fichier TD Snap est incohérente. Réexportez votre page personnelle depuis TD Snap.')
          }
          imageId = Number(existing[0][0])
        } else {
          run(database, 'INSERT INTO PageSetData(Identifier,Data,RefCount) VALUES(?,?,0)', [image.identifier, image.bytes])
          imageId = Number(rows(database, 'SELECT last_insert_rowid()')[0][0])
        }
        mediaIds.set(image.identifier, imageId)
      }
      const elementId = cloneNativeRow(database, 'ElementReference')
      run(database, `UPDATE ElementReference SET PageId=?,ForegroundColor=?,BackgroundColor=?,AudioCue=NULL,
        AudioCueRecordingId=0,UseAudioCueRecording=NULL,SerializedAudioCueSoundMetadata=NULL,SerializedAccessSettingOverrides=NULL WHERE Id=?`,
      [pageId, colorValue(cell.textColor, '#263332'), colorValue(cell.colorOverride, categoryColors[cell.category] ?? categoryColors.other), elementId])
      const buttonId = cloneNativeRow(database, 'Button')
      const label = cell.textCase === 'lowercase' ? cell.label.toLocaleLowerCase('fr-FR') : cell.label.toLocaleUpperCase('fr-FR')
      run(database, `UPDATE Button SET UniqueId=?,Label=?,Message=?,ElementReferenceId=?,LabelOwnership=3,ImageOwnership=?,
        LibrarySymbolId=0,PageSetImageId=?,SymbolColorDataId=0,MessageRecordingId=0,UseMessageRecording=NULL,
        SerializedMessageSoundMetadata=NULL,FontFamily=NULL,SmartSymLayout=NULL,FontSize=?,FontStyle=?,BorderColor=?,BorderThickness=1,
        ContentTag=NULL,LinkIndicatorStyle=NULL WHERE Id=?`,
      [crypto.randomUUID(), label, cell.label.trim() || null, elementId, image ? 3 : 0, imageId ?? 0,
        cell.textSize === 'small' ? 1 : cell.textSize === 'large' ? 2 : 1.5, cell.bold === false ? 0 : 1,
        colorValue(undefined, '#263332'), buttonId])
      run(database, 'INSERT INTO CommandSequence(SerializedCommands,ButtonId) VALUES(?,?)', [sample.command, buttonId])
      for (const [layoutId] of layouts) {
        run(database, "INSERT INTO ElementPlacement(GridPosition,GridSpan,Visible,ElementReferenceId,PageLayoutId) VALUES(?,'1,1',1,?,?)",
          [`${cell.column},${cell.row}`, elementId, layoutId])
      }
    }
    refreshMediaReferences(database)
    database.run('COMMIT; VACUUM;')
    if (protectedSnapshot(database) !== snapshot || !validContentReferences(database) || rows(database, 'PRAGMA integrity_check')[0]?.[0] !== 'ok'
      || database.exec('PRAGMA foreign_key_check').length) throw new Error('Le fichier TD Snap n’a pas pu être vérifié.')
    const bytes = database.export()
    if (bytes.length > EXPORT_LIMIT) throw new Error('Le fichier TD Snap dépasse 128 Mo. Réduisez les photos avant de réessayer.')
    return new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' })
  } finally { database.close() }
}
