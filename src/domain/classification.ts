import type { Board, Folder } from '../types'

const themeAliases: Record<string, string[]> = {
  art: ['art', 'plastique', 'peinture', 'modeler', 'pâte', 'dessin', 'collage'],
  peinture: ['peinture', 'pinceau', 'couleur'],
  pate: ['pâte', 'modeler', 'modelage'],
  cuisine: ['cuisine', 'manger', 'boire', 'assiette', 'couteau', 'fourchette', 'serviette', 'recette'],
  piscine: ['piscine', 'nager', 'nage', 'eau', 'bassin'],
}

export const suggestFolderId = (board: Pick<Board, 'title' | 'cells'>, folders: Folder[]): string | undefined => {
  const text = `${board.title} ${board.cells.map((cell) => cell.label).join(' ')}`.toLocaleLowerCase('fr-FR')
  const candidates = folders.map((folder) => {
    const aliases = themeAliases[folder.id] ?? folder.name.toLocaleLowerCase('fr-FR').split(/\s+/)
    const score = aliases.reduce((total, alias) => total + (text.includes(alias) ? alias.length : 0), 0)
    return { folder, score }
  }).sort((left, right) => right.score - left.score)
  return candidates[0]?.score ? candidates[0].folder.id : undefined
}
