import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { Board, Cell, FitzgeraldCategory, Folder } from '../types'
import { normalizePictogramCell } from './pictograms'

export interface BackupData {
  format: 'tla-studio-backup'
  version: 1
  exportedAt: string
  boards: Board[]
  folders: Folder[]
}

type BackupInput = Omit<BackupData, 'folders'> & { folders?: Folder[] }

export const backupLimits = {
  compressedBytes: 128 * 1024 * 1024,
  jsonBytes: 256 * 1024 * 1024,
  imageBytes: 24 * 1024 * 1024,
  boards: 1000,
  folders: 1000,
  totalCells: 200_000,
  overflowCellsPerBoard: 1500,
  wordsPerBoard: 5000,
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown, maximum = 4096): value is string => typeof value === 'string' && value.length <= maximum
const isId = (value: unknown): value is string => isText(value, 200) && value.trim().length > 0
const isIntegerBetween = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
const isDate = (value: unknown): value is string => isText(value, 64) && Number.isFinite(Date.parse(value))
const color = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
const categories: FitzgeraldCategory[] = ['people', 'verbs', 'descriptive', 'nouns', 'social', 'other']
const imageMime = /^image\/(?:png|jpe?g|webp|gif|bmp|svg\+xml|avif|heic|heif|x-icon)$/i

const isAllowedImage = (value: unknown, source: unknown, pictogramId: unknown): boolean => {
  if (value === undefined) return true
  if (typeof value !== 'string' || value.length > Math.ceil(backupLimits.imageBytes * 4 / 3) + 100) return false
  if (value.startsWith('data:')) {
    const separator = value.indexOf(';base64,')
    return separator > 5 && imageMime.test(value.slice(5, separator))
      && value.length > separator + 8 && /^[A-Za-z0-9+/]*={0,2}$/.test(value.slice(separator + 8))
  }
  if (!isIntegerBetween(pictogramId, 1, 1_000_000_000)) return false
  if (source === 'arasaac') {
    return value === `https://static.arasaac.org/pictograms/${pictogramId}/${pictogramId}_500.png`
  }
  if (source === 'sclera' || source === 'makaton') {
    try {
      const url = new URL(value, 'https://tla.invalid')
      return (url.protocol === 'https:' || url.protocol === 'http:') && !url.search && !url.hash
        && url.pathname.endsWith(`/pictograms/${source}/${pictogramId}.png`)
    } catch { return false }
  }
  return false
}

const isCell = (value: unknown): value is Cell => {
  if (!isRecord(value)) return false
  return isId(value.id)
    && isIntegerBetween(value.row, 0, 9)
    && isIntegerBetween(value.column, 0, 14)
    && (value.source === null || value.source === 'arasaac' || value.source === 'sclera' || value.source === 'makaton' || value.source === 'upload' || value.source === 'camera')
    && isText(value.label)
    && categories.includes(value.category as FitzgeraldCategory)
    && typeof value.essential === 'boolean'
    && typeof value.favorite === 'boolean'
    && isAllowedImage(value.imageData, value.source, value.pictogramId)
    && (value.imageMime === undefined || (typeof value.imageMime === 'string' && imageMime.test(value.imageMime)))
    && (value.pictogramId === undefined || isIntegerBetween(value.pictogramId, 1, 1_000_000_000))
    && (value.searchTerm === undefined || isText(value.searchTerm))
    && (value.colorOverride === undefined || color(value.colorOverride))
    && (value.blackAndWhite === undefined || typeof value.blackAndWhite === 'boolean')
    && (value.textSize === undefined || value.textSize === 'small' || value.textSize === 'normal' || value.textSize === 'large')
    && (value.textCase === undefined || value.textCase === 'uppercase' || value.textCase === 'lowercase')
    && (value.bold === undefined || typeof value.bold === 'boolean')
    && (value.textColor === undefined || color(value.textColor))
}

const isBoard = (value: unknown): value is Board => {
  if (!isRecord(value)) return false
  if (!(isId(value.id)
    && isText(value.title)
    && (value.pictogramBank === undefined || value.pictogramBank === 'arasaac' || value.pictogramBank === 'sclera' || value.pictogramBank === 'makaton')
    && (value.folderId === undefined || isId(value.folderId))
    && (value.status === 'draft' || value.status === 'complete')
    && (value.pageSize === 'A4' || value.pageSize === 'A3')
    && value.orientation === 'landscape'
    && isIntegerBetween(value.rows, 1, 10)
    && isIntegerBetween(value.columns, 1, 15)
    && Array.isArray(value.cells)
    && value.cells.length === value.rows * value.columns
    && value.cells.every(isCell)
    && (value.overflowCells === undefined || (Array.isArray(value.overflowCells) && value.overflowCells.length <= backupLimits.overflowCellsPerBoard && value.overflowCells.every(isCell)))
    && Array.isArray(value.overflowWords)
    && value.overflowWords.length <= backupLimits.wordsPerBoard
    && value.overflowWords.every((word) => isText(word))
    && (value.revision === undefined || isIntegerBetween(value.revision, 0, Number.MAX_SAFE_INTEGER - 1))
    && isDate(value.createdAt) && isDate(value.updatedAt))) return false
  const cells = value.cells as Cell[]
  const overflowCells = (value.overflowCells ?? []) as Cell[]
  return cells.every((cell) => cell.row < (value.rows as number) && cell.column < (value.columns as number))
    && new Set(cells.map((cell) => `${cell.row}:${cell.column}`)).size === cells.length
    && new Set([...cells, ...overflowCells].map((cell) => cell.id)).size === cells.length + overflowCells.length
}

const isFolder = (value: unknown): value is Folder =>
  isRecord(value) && isId(value.id) && isText(value.name, 256) && value.name.trim().length > 0

export const isBackupData = (value: unknown): value is BackupInput => {
  if (!isRecord(value)) return false
  if (!(value.format === 'tla-studio-backup' && value.version === 1 && isDate(value.exportedAt)
    && Array.isArray(value.boards) && value.boards.length <= backupLimits.boards && value.boards.every(isBoard)
    && (value.folders === undefined || (Array.isArray(value.folders) && value.folders.length <= backupLimits.folders && value.folders.every(isFolder))))) return false
  const boards = value.boards as Board[]
  const folders = (value.folders ?? []) as Folder[]
  const folderIds = new Set(folders.map((folder) => folder.id))
  return new Set(boards.map((board) => board.id)).size === boards.length
    && folderIds.size === folders.length
    && (value.folders === undefined || boards.every((board) => !board.folderId || folderIds.has(board.folderId)))
    && boards.reduce((total, board) => total + board.cells.length + (board.overflowCells?.length ?? 0), 0) <= backupLimits.totalCells
}

export const createBackupFilename = (title: string): string => {
  const safeTitle = title.trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .split('')
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .replace(/[. ]+$/g, '')
    .slice(0, 100)
    .trim()
  return `${safeTitle || 'Mon TLA'}.zip`
}

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(new Error('Impossible de lire une image de la sauvegarde.'))
  reader.readAsDataURL(blob)
})

const createMediaLoader = () => {
  const loaded = new Map<string, Promise<string>>()
  let failure: Error | undefined
  const controllers = new Set<AbortController>()
  let active = 0
  const waiting: (() => void)[] = []
  return (url: string): Promise<string> => {
    if (loaded.has(url)) return loaded.get(url)!
    const task = (async () => {
      if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve))
      active += 1
      const controller = new AbortController()
      controllers.add(controller)
      const timeout = setTimeout(() => controller.abort(), 15_000)
      try {
        if (failure) throw failure
        const response = await fetch(url, { signal: controller.signal, mode: 'cors' })
        if (!response.ok) throw new Error('Image inaccessible')
        if (Number(response.headers?.get('content-length')) > backupLimits.imageBytes) throw new Error('Image trop volumineuse')
        const blob = await response.blob()
        if (blob.size > backupLimits.imageBytes || !imageMime.test(blob.type)) throw new Error('Image trop volumineuse ou format non reconnu')
        return await blobToDataUrl(blob)
      } catch {
        failure ??= new Error('Sauvegarde annulée : une image est inaccessible. Reconnectez-vous ou remplacez cette image, puis réessayez. Aucune archive incomplète n’a été téléchargée.')
        controllers.forEach((request) => request.abort())
        throw failure
      } finally {
        clearTimeout(timeout)
        controllers.delete(controller)
        active -= 1
        waiting.shift()?.()
      }
    })()
    loaded.set(url, task)
    return task
  }
}

/** Les médias sont intégrés au JSON pour garder le format v1 lisible par les anciennes versions. */
export async function createBackupBlob(boards: Board[], folders: Folder[]): Promise<Blob> {
  const backup: BackupData = { format: 'tla-studio-backup', version: 1, exportedAt: new Date().toISOString(), boards, folders }
  if (!isBackupData(backup)) throw new Error('La bibliothèque contient un TLA incomplet ou dépasse les limites de sauvegarde.')
  const loadMedia = createMediaLoader()
  const embedCell = async (cell: Cell): Promise<Cell> => {
    const normalized = normalizePictogramCell(cell)
    if (!normalized.imageData || normalized.imageData.startsWith('data:')) return normalized
    return { ...normalized, imageData: await loadMedia(normalized.imageData) }
  }
  backup.boards = await Promise.all(boards.map(async (board) => ({
    ...board,
    cells: await Promise.all(board.cells.map(embedCell)),
    ...(board.overflowCells ? { overflowCells: await Promise.all(board.overflowCells.map(embedCell)) } : {}),
  })))
  const json = JSON.stringify(backup)
  if (new Blob([json]).size > backupLimits.jsonBytes) throw new Error('La sauvegarde dépasse 256 Mo. Réduisez la taille des photos avant de réessayer.')
  const zip = new JSZip()
  zip.file('backup.json', json)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  if (blob.size > backupLimits.compressedBytes) throw new Error('La sauvegarde dépasse 128 Mo. Réduisez la taille des photos avant de réessayer.')
  return blob
}

export async function exportBackupFile(boards: Board[], title: string, folders: Folder[]): Promise<void> {
  saveAs(await createBackupBlob(boards, folders), createBackupFilename(title))
}

interface ZipByteStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): ZipByteStream
  on(event: 'error' | 'end', listener: (error?: unknown) => void): ZipByteStream
  pause(): ZipByteStream
  resume(): ZipByteStream
}

const readBoundedJson = (file: JSZip.JSZipObject): Promise<string> => new Promise((resolve, reject) => {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const parts: string[] = []
  let bytes = 0
  let failed = false
  // JSZip's async() uses this stream internally; its declarations omit the method.
  // Keep the adapter narrow and refuse an unsupported version rather than inflate without a limit.
  const streamable = file as JSZip.JSZipObject & { internalStream?: (type: 'uint8array') => ZipByteStream }
  if (!streamable.internalStream) { reject(new Error('Cette version ZIP ne permet pas une lecture avec limite de taille.')); return }
  const stream = streamable.internalStream('uint8array')
  stream.on('data', (chunk: Uint8Array) => {
    if (failed) return
    bytes += chunk.length
    if (bytes > backupLimits.jsonBytes) {
      failed = true
      stream.pause()
      reject(new Error('La sauvegarde décompressée dépasse la limite de 256 Mo.'))
      return
    }
    try { parts.push(decoder.decode(chunk, { stream: true })) } catch (error) { failed = true; stream.pause(); reject(error) }
  }).on('error', reject).on('end', () => {
    if (failed) return
    try { parts.push(decoder.decode()); resolve(parts.join('')) } catch (error) { reject(error) }
  }).resume()
})

export async function readBackupFile(file: File): Promise<BackupData> {
  if (file.size > backupLimits.compressedBytes) throw new Error('Cette sauvegarde dépasse la limite de 128 Mo.')
  let zip: JSZip
  try { zip = await JSZip.loadAsync(file) } catch { throw new Error('Ce fichier n’est pas une sauvegarde ZIP valide.') }
  if (Object.keys(zip.files).length > 10_000) throw new Error('Cette archive contient trop de fichiers.')
  const backupFile = zip.file('backup.json')
  if (!backupFile) throw new Error('La sauvegarde ne contient pas de fichier TLA reconnu.')
  const json = await readBoundedJson(backupFile)
  let content: unknown
  try { content = JSON.parse(json) } catch { throw new Error('Le contenu de la sauvegarde est illisible.') }
  if (!isBackupData(content)) throw new Error('Le format de cette sauvegarde est incomplet ou dépasse les limites autorisées.')
  return {
    ...content,
    boards: content.boards.map((board) => ({
      ...board,
      cells: board.cells.map(normalizePictogramCell),
      ...(board.overflowCells ? { overflowCells: board.overflowCells.map(normalizePictogramCell) } : {}),
    })),
    folders: content.folders ?? [],
  }
}
