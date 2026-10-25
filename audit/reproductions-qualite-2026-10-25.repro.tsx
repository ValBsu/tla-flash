// @vitest-environment jsdom
// Audit reproductions: asserts the observed defect, not the intended behavior.
// Run explicitly with audit/reproductions-2026-10-25.config.mts.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { writeFileSync } from 'node:fs'
import { jsPDF } from 'jspdf'
import { createEmptyBoard, type Board } from '../src/types'
import { exportBoardPdf } from '../src/services/pdf'

const repositories = vi.hoisted(() => ({
  boards: { list: vi.fn(), save: vi.fn().mockResolvedValue(undefined), remove: vi.fn(), restore: vi.fn() },
  folders: { list: vi.fn(), save: vi.fn(), remove: vi.fn() },
}))
vi.mock('../src/services/storage', () => ({ boardRepository: repositories.boards, folderRepository: repositories.folders }))
import App from '../src/App'

const evidence: Record<string, unknown> = {}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
afterAll(() => {
  writeFileSync('audit/reproductions-qualite-2026-10-25.json', JSON.stringify({
    date: '2026-10-25',
    purpose: 'Reproductions de défauts actuels ; un test réussi confirme le défaut décrit.',
    command: './node_modules/.bin/vitest run --config audit/reproductions-2026-10-25.config.mts',
    config: {
      root: 'Racine du projet, résolue depuis la configuration',
      test: { environment: 'jsdom', include: ['audit/*-2026-10-25.repro.tsx'] },
    },
    scope: 'App réelle et services réels ; repositories simulés et index Sclera simulé. Aucun navigateur automatisé.',
    evidence,
  }, null, 2) + '\n')
})

describe('audit qualité fonctionnelle et PDF', () => {
  it('reproduit les doublons de génération dans App avec la recherche Sclera réelle', async () => {
    repositories.boards.list.mockResolvedValue([])
    repositories.folders.list.mockResolvedValue([])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 1, label: 'chat' }, { id: 2, label: 'chien' }] }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Sclera Choisir/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Sclera Banque de ce TLA/ }).getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(screen.getByRole('button', { name: 'Modifier mon TLA' }))
    fireEvent.click(screen.getByRole('button', { name: 'Générer depuis une liste' }))
    fireEvent.change(screen.getByPlaceholderText('Ajouter ici vos mots'), { target: { value: 'chat, chat, chien' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher les pictogrammes proposés' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Insérer les propositions' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Insérer les propositions' }))
    await waitFor(() => {
      const latest = repositories.boards.save.mock.calls.at(-1)?.[0] as Board | undefined
      expect(latest?.cells.slice(0, 3).map((cell) => cell.label)).toEqual(['CHAT', 'CHAT', 'CHIEN'])
    })
    const actual = repositories.boards.save.mock.calls.at(-1)![0] as Board
    evidence.batchDuplicates = {
      input: ['chat', 'chat', 'chien'], expectedDeduplicated: ['CHAT', 'CHIEN'],
      actual: actual.cells.filter((cell) => cell.label).map((cell) => ({ label: cell.label, pictogramId: cell.pictogramId })),
      confirmed: true, references: ['src/App.tsx:286', 'src/App.tsx:307', 'src/domain/layout.ts:36'],
    }
  })

  it('reproduit dans App la perte photo/styles après réduction et réagrandissement', async () => {
    const saved = { ...createEmptyBoard(1, 2), title: 'Photo à préserver', createdAt: '2020-01-01T00:00:00.000Z' }
    saved.cells[1] = { ...saved.cells[1], label: 'PHOTO', source: 'upload', imageData: 'data:image/png;base64,YWJj', textSize: 'large', textColor: '#ff0000' }
    repositories.boards.list.mockResolvedValue([saved])
    repositories.folders.list.mockResolvedValue([])
    render(<App />)
    const title = await screen.findByDisplayValue('Photo à préserver')
    const page = title.closest('.board-page') as HTMLElement
    fireEvent.click(within(page).getByRole('button', { name: 'Grille 2 colonnes par 1 lignes' }))
    fireEvent.click(within(page).getByRole('gridcell', { name: '1 colonnes, 1 lignes' }))
    await waitFor(() => expect(repositories.boards.save).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id, columns: 1, overflowWords: ['PHOTO'] })))
    fireEvent.click(within(page).getByRole('button', { name: 'Grille 1 colonnes par 1 lignes' }))
    fireEvent.click(within(page).getByRole('gridcell', { name: '2 colonnes, 1 lignes' }))
    await waitFor(() => {
      const latest = repositories.boards.save.mock.calls.at(-1)?.[0] as Board | undefined
      expect(latest?.columns).toBe(2)
      expect(latest?.cells[1].label).toBe('')
      expect(latest?.cells[1].imageData).toBeUndefined()
    })
    const actual = repositories.boards.save.mock.calls.at(-1)![0] as Board
    evidence.resizePhotoLoss = {
      operation: '1 ligne × 2 colonnes → 1 × 1 → 1 × 2 dans App',
      initialCell: saved.cells[1], actualCell: actual.cells[1], overflowWords: actual.overflowWords,
      visibleRecoveryUi: false, confirmed: true,
      references: ['src/domain/layout.ts:14', 'src/App.tsx:573'],
    }
  })

  it('produit malgré tout un PDF lorsque toutes les tentatives de chargement image échouent', async () => {
    const board = createEmptyBoard(1, 1)
    board.cells[0] = { ...board.cells[0], label: 'CHAT', source: 'arasaac', imageData: 'https://example.invalid/unavailable.png' }
    const fetchMock = vi.fn().mockRejectedValue(new Error('simulated network failure'))
    let imageFallbackAttempted = false
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('Image', class {
      crossOrigin = ''
      onerror: (() => void) | null = null
      set src(value: string) { void value; imageFallbackAttempted = true; queueMicrotask(() => this.onerror?.()) }
    })
    const blob = await exportBoardPdf(document.createElement('div'), board, false)
    expect(fetchMock).toHaveBeenCalledWith(board.cells[0].imageData, { mode: 'cors' })
    expect(imageFallbackAttempted).toBe(true)
    expect(blob.size).toBeGreaterThan(0)
    evidence.silentMissingPdfImage = {
      fetch: 'rejected', imageFallback: 'onerror', export: 'resolved with PDF Blob', pdfBytes: blob.size,
      warningsReturned: false, confirmed: true, references: ['src/services/pdf.ts:28', 'src/services/pdf.ts:111'],
    }
  })

  it('mesure le débordement d’une légende PDF longue avec la version installée de jsPDF', () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const cellWidth = (297 - 22 - 2.5 * 14) / 15
    const cellHeight = (210 - 22 - 14 - 7 - 2.5 * 9) / 10
    const fontSize = 7
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(fontSize)
    const label = 'JE VEUX ALLER À LA PISCINE AVEC MES AMIS'
    const lines = doc.splitTextToSize(label, cellWidth - 6) as string[]
    const lastBaseline = cellHeight - 4 + (lines.length - 1) * fontSize * doc.getLineHeightFactor() / doc.internal.scaleFactor
    expect(lines).toHaveLength(8)
    expect(lastBaseline).toBeGreaterThan(cellHeight)
    evidence.longPdfLabel = {
      grid: 'A4 15 colonnes × 10 lignes', label, cellWidthMm: cellWidth, cellHeightMm: cellHeight,
      fontSizePt: fontSize, lines, lastLineBaselineFromCellTopMm: lastBaseline,
      overflowMm: lastBaseline - cellHeight, confirmedByGeometry: true,
      limitation: 'Mesure jsPDF des lignes et coordonnées selon le rendu source, sans inspection visuelle du PDF.',
      references: ['src/services/pdf.ts:115', 'src/services/pdf.ts:119'],
    }
  })
})
