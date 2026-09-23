import type { Board, Folder } from '../types'

export interface TlaBackup {
  version: 1
  exportedAt: string
  boards: Board[]
  folders: Folder[]
}

export const createBackup = (boards: Board[], folders: Folder[]): Blob => {
  const backup: TlaBackup = { version: 1, exportedAt: new Date().toISOString(), boards, folders }
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
}

export const parseBackup = async (file: File): Promise<TlaBackup> => {
  const parsed: unknown = JSON.parse(await file.text())
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Format de sauvegarde invalide.')
  const value = parsed as Partial<TlaBackup>
  if (value.version !== 1 || !Array.isArray(value.boards) || !Array.isArray(value.folders)) throw new Error('Cette sauvegarde TLA n’est pas reconnue.')
  return { version: 1, exportedAt: String(value.exportedAt ?? ''), boards: value.boards as Board[], folders: value.folders as Folder[] }
}
