// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { createEmptyBoard, type Folder } from '../types'
import { backupLimits, createBackupBlob, createBackupFilename, isBackupData, readBackupFile } from './backup'

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const originalJsonLimit = backupLimits.jsonBytes
afterEach(() => { vi.unstubAllGlobals(); Object.defineProperty(backupLimits, 'jsonBytes', { value: originalJsonLimit }) })
const wrap = (boards: ReturnType<typeof createEmptyBoard>[], folders: Folder[] = []) => ({
  format: 'tla-studio-backup', version: 1, exportedAt: new Date().toISOString(), boards, folders,
})
const zipFile = async (content: unknown) => {
  const zip = new JSZip()
  zip.file('backup.json', JSON.stringify(content))
  return new File([await zip.generateAsync({ type: 'blob' })], 'test.zip', { type: 'application/zip' })
}

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

  it('accepte les options de style ajoutées aux cellules des archives', () => {
    const board = createEmptyBoard()
    board.cells[0] = { ...board.cells[0], textSize: 'large', textCase: 'lowercase', bold: false, textColor: '#ab34cd' }
    const backup = { format: 'tla-studio-backup', version: 1, exportedAt: new Date().toISOString(), boards: [board] }
    expect(isBackupData(backup)).toBe(true)
    expect(isBackupData({ ...backup, boards: [{ ...board, cells: [{ ...board.cells[0], textColor: 'red' }, ...board.cells.slice(1)] }] })).toBe(false)
  })

  it('refuse les dimensions, coordonnées, identifiants et dates incohérents', () => {
    const board = createEmptyBoard(1, 2)
    for (const invalid of [
      { ...board, rows: -1 }, { ...board, columns: 16 }, { ...board, cells: [] },
      { ...board, cells: [board.cells[0], board.cells[0]] },
      { ...board, cells: [{ ...board.cells[0], row: 3 }, board.cells[1]] },
      { ...board, updatedAt: 'invalide' },
    ]) expect(isBackupData(wrap([invalid]))).toBe(false)
    expect(isBackupData(wrap([board, board]))).toBe(false)
    expect(isBackupData(wrap([{ ...board, folderId: 'absent' }]))).toBe(false)
  })

  it('refuse les URL d’images arbitraires tout en acceptant les photos intégrées', () => {
    const board = createEmptyBoard(1, 1)
    board.cells[0] = { ...board.cells[0], label: 'Photo', source: 'upload', imageData: 'https://example.invalid/tracking.png' }
    expect(isBackupData(wrap([board]))).toBe(false)
    board.cells[0].imageData = image
    expect(isBackupData(wrap([board]))).toBe(true)
    board.cells[0].imageData = 'javascript:alert(1)'
    expect(isBackupData(wrap([board]))).toBe(false)
  })

  it('préserve les cases mises de côté et leurs images dans l’archive', async () => {
    const board = createEmptyBoard(1, 1)
    const retained = { ...board.cells[0], id: crypto.randomUUID(), row: 1, label: 'Photo', source: 'upload' as const, imageData: image, bold: false }
    board.overflowCells = [retained]
    const restored = await readBackupFile(new File([await createBackupBlob([board], [])], 'sauvegarde.zip'))
    expect(restored.boards[0].overflowCells).toEqual([retained])
  })

  it('reconstruit les URL des anciennes sauvegardes avec le préfixe de cet hébergement', async () => {
    const board = createEmptyBoard(1, 1)
    board.cells[0] = { ...board.cells[0], label: 'Maison', source: 'sclera', pictogramId: 1, imageData: '/ancien-site/pictograms/sclera/1.png' }
    const restored = await readBackupFile(await zipFile(wrap([board])))
    expect(restored.boards[0].cells[0].imageData).toBe(`${import.meta.env.BASE_URL}pictograms/sclera/1.png`)
  })

  it('intègre une image distante une seule fois et restaure sans requête réseau', async () => {
    const board = createEmptyBoard(1, 2)
    board.cells = board.cells.map((cell) => ({ ...cell, label: 'Maison', source: 'arasaac', pictogramId: 1, imageData: 'https://static.arasaac.org/pictograms/1/1_500.png' }))
    const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) })
    vi.stubGlobal('fetch', fetcher)
    const blob = await createBackupBlob([board], [])
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockRejectedValue(new Error('Hors connexion'))
    const restored = await readBackupFile(new File([blob], 'autonome.zip'))
    expect(restored.boards[0].cells.every((cell) => cell.imageData?.startsWith('data:image/png;base64,'))).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refuse une sauvegarde incomplète si une image ne peut pas être embarquée', async () => {
    const board = createEmptyBoard(1, 1)
    board.cells[0] = { ...board.cells[0], label: 'Maison', source: 'arasaac', pictogramId: 1, imageData: 'https://static.arasaac.org/pictograms/1/1_500.png' }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Hors connexion')))
    await expect(createBackupBlob([board], [])).rejects.toThrow('Aucune archive incomplète')
  })

  it('limite à quatre les téléchargements simultanés des médias', async () => {
    const board = createEmptyBoard(1, 6)
    board.cells = board.cells.map((cell, index) => ({
      ...cell, label: `Image ${index}`, source: 'arasaac', pictogramId: index + 1,
      imageData: `https://static.arasaac.org/pictograms/${index + 1}/${index + 1}_500.png`,
    }))
    let active = 0
    let maximum = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return { ok: true, blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }) }
    }))
    await createBackupBlob([board], [])
    expect(maximum).toBe(4)
  })

  it('arrête la décompression quand le JSON dépasse la limite', async () => {
    const file = await zipFile(wrap([createEmptyBoard()]))
    Object.defineProperty(backupLimits, 'jsonBytes', { value: 64 })
    await expect(readBackupFile(file)).rejects.toThrow('décompressée')
  })

  it('refuse une archive trop volumineuse avant de la charger', async () => {
    const file = new File([], 'trop-gros.zip')
    Object.defineProperty(file, 'size', { value: backupLimits.compressedBytes + 1 })
    await expect(readBackupFile(file)).rejects.toThrow('128 Mo')
  })
})
