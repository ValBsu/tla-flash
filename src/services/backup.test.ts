import { describe, expect, it } from 'vitest'
import { createEmptyBoard } from '../types'
import { isBackupData } from './backup'

describe('format de sauvegarde', () => {
  it('accepte un fichier versionné contenant des TLA et dossiers valides', () => {
    expect(isBackupData({
      format: 'tla-studio-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      boards: [createEmptyBoard()],
      folders: [{ id: 'arts', name: 'Arts' }],
    })).toBe(true)
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
  })
})