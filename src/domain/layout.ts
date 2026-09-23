import type { Board, Cell } from '../types'

export const resizeBoard = (board: Board, rows: number, columns: number): Board => {
  const currentByPosition = new Map(board.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]))
  const cells: Cell[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const existing = currentByPosition.get(`${row}:${column}`)
      cells.push(existing ? { ...existing, row, column } : {
        id: crypto.randomUUID(), row, column, source: null, label: '', category: 'other', essential: false, favorite: false,
      })
    }
  }
  const overflowWords = board.cells
    .filter((cell) => cell.label && (cell.row >= rows || cell.column >= columns))
    .map((cell) => cell.label)
  return { ...board, rows, columns, cells, overflowWords: [...new Set([...board.overflowWords, ...overflowWords])] }
}

export const moveOrSwapCells = (board: Board, fromId: string, toId: string): Board => {
  if (fromId === toId) return board
  const from = board.cells.find((cell) => cell.id === fromId)
  const to = board.cells.find((cell) => cell.id === toId)
  if (!from || !to) return board
  return {
    ...board,
    cells: board.cells.map((cell) => {
      if (cell.id === fromId) return { ...cell, row: to.row, column: to.column }
      if (cell.id === toId) return { ...cell, row: from.row, column: from.column }
      return cell
    }).sort((a, b) => a.row - b.row || a.column - b.column),
  }
}

export const placeWords = (board: Board, words: string[], essentialWords: string[] = ['oui', 'non', 'je', 'tu']): Board => {
  const normalized = [...new Set(words.map((word) => word.trim()).filter(Boolean))]
  const placed = normalized.slice(0, board.cells.length)
  const essential = new Set(essentialWords.map((word) => word.toLocaleLowerCase('fr-FR')))
  return {
    ...board,
    cells: board.cells.map((cell, index) => ({
      ...cell,
      label: placed[index] ?? '',
      essential: Boolean(placed[index] && essential.has(placed[index].toLocaleLowerCase('fr-FR'))),
      source: null,
    })),
    overflowWords: normalized.slice(board.cells.length),
  }
}
