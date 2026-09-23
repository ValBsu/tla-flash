import { describe, expect, it } from 'vitest'
import { createEmptyBoard } from '../types'
import { moveOrSwapCells, placeWords, resizeBoard } from './layout'
import { suggestFolderId } from './classification'

describe('moteur de placement TLA', () => {
  it('place les mots et expose le débordement sans supprimer silencieusement', () => {
    const result = placeWords(createEmptyBoard(1, 2), ['oui', 'manger', 'boire'])
    expect(result.cells.map((cell) => cell.label)).toEqual(['oui', 'manger'])
    expect(result.cells[0].essential).toBe(true)
    expect(result.overflowWords).toEqual(['boire'])
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

  it('propose un dossier à partir du thème du tableau', () => {
    const board = placeWords(createEmptyBoard(1, 2), ['pinceau', 'couleur'])
    const folderId = suggestFolderId({ ...board, title: 'Atelier peinture' }, [
      { id: 'peinture', name: 'Peinture' },
      { id: 'cuisine', name: 'Cuisine' },
    ])
    expect(folderId).toBe('peinture')
  })
})