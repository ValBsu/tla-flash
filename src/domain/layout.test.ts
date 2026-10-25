import { describe, expect, it } from 'vitest'
import { createEmptyBoard } from '../types'
import { moveOrSwapCells, normalizeWords, placeWords, resizeBoard, restoreOverflowCell } from './layout'

describe('moteur de placement TLA', () => {
  it('place les mots et expose le débordement sans supprimer silencieusement', () => {
    const result = placeWords(createEmptyBoard(1, 2), ['oui', 'manger', 'boire'])
    expect(result.cells.map((cell) => cell.label)).toEqual(['oui', 'manger'])
    expect(result.cells[0].essential).toBe(true)
    expect(result.overflowWords).toEqual(['boire'])
  })

  it('retire les anciens pictogrammes quand une nouvelle liste remplace la grille', () => {
    const board = createEmptyBoard(1, 1)
    board.cells[0] = { ...board.cells[0], label: 'ancien', source: 'upload', imageData: 'data:image/png;base64,abc', blackAndWhite: true, textSize: 'large', textCase: 'lowercase', bold: false, textColor: '#ab34cd' }
    const result = placeWords(board, ['nouveau'])
    expect(result.cells[0]).toMatchObject({ label: 'nouveau', source: null, category: 'other', blackAndWhite: false, textSize: 'normal', textCase: 'uppercase', bold: true, textColor: undefined })
    expect(result.cells[0].imageData).toBeUndefined()
  })

  it('conserve les contenus et signale les mots hors grille lors du redimensionnement', () => {
    const board = placeWords(createEmptyBoard(1, 2), ['un', 'deux'])
    const result = resizeBoard(board, 1, 1)
    expect(result.cells[0].label).toBe('un')
    expect(result.overflowWords).toContain('deux')
  })

  it('permute deux cases et permet donc un retour arrière par historique', () => {
    const board = placeWords(createEmptyBoard(1, 2), ['gauche', 'droite'])
    const result = moveOrSwapCells(board, board.cells[0].id, board.cells[1].id)
    expect(result.cells.map((cell) => cell.label)).toEqual(['droite', 'gauche'])
  })

  it('restaure les photos, identifiants et styles après réduction puis agrandissement', () => {
    const board = placeWords(createEmptyBoard(2, 2), ['un', 'deux', 'trois', 'photo'])
    board.cells[3] = { ...board.cells[3], source: 'upload', imageData: 'data:image/png;base64,aGVsbG8=', textSize: 'large', bold: false, textColor: '#ab34cd' }
    const reduced = resizeBoard(board, 1, 1)
    expect(reduced.overflowCells).toHaveLength(3)
    const restored = resizeBoard(reduced, 2, 2)
    expect(restored.cells).toEqual(board.cells)
    expect(restored.overflowCells).toEqual([])
    expect(restored.overflowWords).toEqual([])
  })

  it('conserve les anciens mots en attente et ne remplace pas une case occupée', () => {
    const board = placeWords(createEmptyBoard(1, 2), ['un', 'deux'])
    board.overflowWords = ['ancien mot']
    const reduced = resizeBoard(board, 1, 1)
    reduced.cells[0].label = 'nouveau'
    const restored = resizeBoard(reduced, 1, 2)
    expect(restored.cells.map((cell) => cell.label)).toEqual(['nouveau', 'deux'])
    expect(restored.overflowWords).toEqual(['ancien mot'])
  })

  it('réinsère une case mise de côté dans la première case libre sans perdre son image', () => {
    const board = placeWords(createEmptyBoard(1, 2), ['un', 'photo'])
    board.cells[1].imageData = 'data:image/png;base64,aGVsbG8='
    const reduced = resizeBoard(board, 1, 1)
    const retained = reduced.overflowCells![0]
    expect(restoreOverflowCell(reduced, retained.id)).toBe(reduced)
    reduced.cells[0] = { ...reduced.cells[0], label: '', essential: false }
    const restored = restoreOverflowCell(reduced, retained.id)
    expect(restored.cells[0]).toMatchObject({ id: retained.id, label: 'photo', imageData: retained.imageData, row: 0, column: 0 })
    expect(restored.overflowCells).toEqual([])
    expect(restored.overflowWords).toEqual([])
  })

  it('déduplique les listes de façon identique malgré casse et espaces', () => {
    const words = ['  École ', 'école', 'à  table', 'À table', '', 'oui']
    expect(normalizeWords(words)).toEqual(['École', 'à table', 'oui'])
    expect(placeWords(createEmptyBoard(1, 3), words).cells.map((cell) => cell.label)).toEqual(normalizeWords(words))
  })

  it('refuse une grille en dehors des limites de l’éditeur', () => {
    expect(() => resizeBoard(createEmptyBoard(), 0, 3)).toThrow()
    expect(() => resizeBoard(createEmptyBoard(), 2, 16)).toThrow()
  })
})
