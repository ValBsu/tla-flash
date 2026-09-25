import { describe, expect, it } from 'vitest'
import { createEmptyBoard, type Folder } from '../types'
import { createBackupFilename, isBackupData } from './backup'

describe('format de sauvegarde', () => {
  it('utilise le titre du TLA comme nom de fichier ZIP et retire les caractères interdits', () => {
    expect(createBackupFilename('Repas / goûter')).toBe('Repas - goûter.zip')
    expect(createBackupFilename('  ')).toBe('Mon TLA.zip')
  })

  it('accepte un fichier versionné contenant des TLA et dossiers valides', () => {
    const folders: Folder[] = [{ id: 'activities', name: 'Activités' }]
    expect(isBackupData({
      format: 'tla-studio-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      boards: [{ ...createEmptyBoard(), folderId: folders[0].id }],
      folders,
    })).toBe(true)
    const legacyBackup = { format: 'tla-studio-backup', version: 1, exportedAt: new Date().toISOString(), boards: [createEmptyBoard()] }
    expect(isBackupData(legacyBackup)).toBe(true)
  })

  it('refuse les versions inconnues et les cellules incomplètes', () => {
    const board = createEmptyBoard()
    const backup = {
      format: 'tla-studio-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      boards: [board],
      folders: [],
    }
    expect(isBackupData({ ...backup, version: 2 })).toBe(false)
    expect(isBackupData({ ...backup, boards: [{ ...board, cells: [{ id: 'bad' }] }] })).toBe(false)
    expect(isBackupData({ ...backup, folders: [{ id: 'legacy', name: 'Ancien dossier' }] })).toBe(true)
  })
})