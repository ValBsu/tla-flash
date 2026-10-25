import { createEmptyBoard, type Board } from '../types'
import { placeWords } from './layout'

export const boardTemplates = [
  { id: 'repas', name: 'Repas', words: ['je', 'veux', 'manger', 'boire', 'encore', 'fini', 'oui', 'non', 'eau', 'pain', 'fruit', 'aide'] },
  { id: 'emotions', name: 'Émotions', words: ['je', 'suis', 'content', 'triste', 'fatigué', 'peur', 'mal', 'calme', 'oui', 'non', 'aide', 'pause'] },
  { id: 'sortie', name: 'Sortie', words: ['je', 'veux', 'aller', 'rentrer', 'toilettes', 'eau', 'attendre', 'aide', 'oui', 'non', 'encore', 'fini'] },
] as const

export function createTemplateBoard(templateId: string): Board | undefined {
  const template = boardTemplates.find((item) => item.id === templateId)
  if (!template) return undefined
  return placeWords({ ...createEmptyBoard(3, 4), title: template.name }, [...template.words])
}
