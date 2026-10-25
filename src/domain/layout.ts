import type { Board, Cell } from '../types'

const wordKey = (word: string) => word.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR')

export const normalizeWords = (words: string[]): string[] => {
  const seen = new Set<string>()
  return words.map((word) => word.normalize('NFC').trim().replace(/\s+/g, ' ')).filter((word) => {
    const key = wordKey(word)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const hasContent = (cell: Cell) => Boolean(cell.label.trim() || cell.imageData || cell.pictogramId
  || cell.favorite || cell.essential || cell.colorOverride || cell.blackAndWhite
  || (cell.textSize && cell.textSize !== 'normal') || (cell.textCase && cell.textCase !== 'uppercase')
  || cell.bold === false || cell.textColor)

const remainingWords = (board: Board, overflowCells: Cell[]) => {
  const previousCellWords = new Set((board.overflowCells ?? []).map((cell) => wordKey(cell.label)))
  const legacyWords = board.overflowWords.filter((word) => !previousCellWords.has(wordKey(word)))
  return normalizeWords([...legacyWords, ...overflowCells.map((cell) => cell.label)])
}

export const resizeBoard = (board: Board, rows: number, columns: number): Board => {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 10 || columns < 1 || columns > 15) {
    throw new Error('La grille doit contenir de 1 à 10 lignes et de 1 à 15 colonnes.')
  }
  const currentByPosition = new Map(board.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]))
  const retainedByPosition = new Map<string, Cell>()
  for (const cell of board.overflowCells ?? []) {
    const key = `${cell.row}:${cell.column}`
    if (!retainedByPosition.has(key)) retainedByPosition.set(key, cell)
  }
  const cells: Cell[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const current = currentByPosition.get(`${row}:${column}`)
      const retained = retainedByPosition.get(`${row}:${column}`)
      const existing = current && hasContent(current) ? current : retained ?? current
      cells.push(existing ? { ...existing, row, column } : {
        id: crypto.randomUUID(), row, column, source: null, label: '', category: 'other', essential: false, favorite: false,
      })
    }
  }
  const visibleIds = new Set(cells.map((cell) => cell.id))
  const retained = new Map<string, Cell>()
  for (const cell of [...board.cells, ...(board.overflowCells ?? [])]) {
    if (!visibleIds.has(cell.id) && hasContent(cell)) retained.set(cell.id, cell)
  }
  const overflowCells = [...retained.values()]
  return { ...board, rows, columns, cells, overflowCells, overflowWords: remainingWords(board, overflowCells) }
}

export const restoreOverflowCell = (board: Board, id: string): Board => {
  const retained = board.overflowCells?.find((cell) => cell.id === id)
  const empty = board.cells.find((cell) => !hasContent(cell))
  if (!retained || !empty) return board
  const overflowCells = (board.overflowCells ?? []).filter((cell) => cell.id !== id)
  return {
    ...board,
    cells: board.cells.map((cell) => cell.id === empty.id ? { ...retained, row: empty.row, column: empty.column } : cell),
    overflowCells,
    overflowWords: remainingWords(board, overflowCells),
  }
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
  const normalized = normalizeWords(words)
  const placed = normalized.slice(0, board.cells.length)
  const essential = new Set(essentialWords.map((word) => word.toLocaleLowerCase('fr-FR')))
  return {
    ...board,
    cells: board.cells.map((cell, index) => ({
      ...cell,
      label: placed[index] ?? '',
      essential: Boolean(placed[index] && essential.has(placed[index].toLocaleLowerCase('fr-FR'))),
      source: null,
      pictogramId: undefined,
      imageData: undefined,
      imageMime: undefined,
      searchTerm: undefined,
      category: 'other',
      colorOverride: undefined,
      blackAndWhite: false,
      textSize: 'normal',
      textCase: 'uppercase',
      bold: true,
      textColor: undefined,
      favorite: false,
    })),
    overflowWords: normalized.slice(board.cells.length),
  }
}
