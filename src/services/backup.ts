import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { Board, Cell, FitzgeraldCategory, Folder } from '../types'

export interface BackupData {
  format: 'tla-studio-backup'
  version: 1
  exportedAt: string
  boards: Board[]
  folders: Folder[]
}

type BackupInput = Omit<BackupData, 'folders'> & { folders?: Folder[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const categories: FitzgeraldCategory[] = ['people', 'verbs', 'descriptive', 'nouns', 'social', 'other']

const isCell = (value: unknown): value is Cell => {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && Number.isInteger(value.row)
    && Number.isInteger(value.column)
    && (value.source === null || value.source === 'arasaac' || value.source === 'upload' || value.source === 'camera')
    && typeof value.label === 'string'
    && categories.includes(value.category as FitzgeraldCategory)
    && typeof value.essential === 'boolean'
    && typeof value.favorite === 'boolean'
    && (value.imageData === undefined || typeof value.imageData === 'string')
    && (value.imageMime === undefined || typeof value.imageMime === 'string')
    && (value.pictogramId === undefined || Number.isInteger(value.pictogramId))
    && (value.searchTerm === undefined || typeof value.searchTerm === 'string')
    && (value.colorOverride === undefined || typeof value.colorOverride === 'string')
}

const isBoard = (value: unknown): value is Board => {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && (value.folderId === undefined || typeof value.folderId === 'string')
    && (value.status === 'draft' || value.status === 'complete')
    && (value.pageSize === 'A4' || value.pageSize === 'A3')
    && value.orientation === 'landscape'
    && Number.isInteger(value.rows)
    && Number.isInteger(value.columns)
    && Array.isArray(value.cells)
    && value.cells.every(isCell)
    && Array.isArray(value.overflowWords)
    && value.overflowWords.every((word) => typeof word === 'string')
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

const isFolder = (value: unknown): value is Folder =>
  isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'

export const isBackupData = (value: unknown): value is BackupInput => {
  if (!isRecord(value)) return false
  return value.format === 'tla-studio-backup'
    && value.version === 1
    && typeof value.exportedAt === 'string'
    && Array.isArray(value.boards)
    && value.boards.every(isBoard)
    && (value.folders === undefined || (Array.isArray(value.folders) && value.folders.every(isFolder)))
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

export async function exportBackupFile(boards: Board[], title: string, folders: Folder[]): Promise<void> {
  const backup: BackupData = {
    format: 'tla-studio-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    boards,
    folders,
  }
  const zip = new JSZip()
  zip.file('backup.json', JSON.stringify(backup))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  saveAs(blob, createBackupFilename(title))
}

export async function readBackupFile(file: File): Promise<BackupData> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error('Ce fichier n’est pas une sauvegarde ZIP valide.')
  }

  const backupFile = zip.file('backup.json')
  if (!backupFile) throw new Error('La sauvegarde ne contient pas de fichier TLA reconnu.')

  let content: unknown
  try {
    content = JSON.parse(await backupFile.async('string'))
  } catch {
    throw new Error('Le contenu de la sauvegarde est illisible.')
  }
  if (!isBackupData(content)) throw new Error('Le format de cette sauvegarde n’est pas reconnu ou est incomplet.')
  return {
    ...content,
    folders: content.folders ?? [],
  }
}