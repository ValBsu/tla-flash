export type PageSize = 'A4' | 'A3'
export type Orientation = 'landscape'
export type SourceType = 'arasaac' | 'upload' | 'camera' | null
export type FitzgeraldCategory = 'people' | 'verbs' | 'descriptive' | 'nouns' | 'social' | 'other'

export interface Cell {
  id: string
  row: number
  column: number
  source: SourceType
  pictogramId?: number
  imageData?: string
  imageMime?: string
  label: string
  searchTerm?: string
  category: FitzgeraldCategory
  colorOverride?: string
  essential: boolean
  favorite: boolean
}

export interface Board {
  id: string
  title: string
  folderId?: string
  status: 'draft' | 'complete'
  pageSize: PageSize
  orientation: Orientation
  rows: number
  columns: number
  cells: Cell[]
  overflowWords: string[]
  createdAt: string
  updatedAt: string
}

export interface Folder {
  id: string
  name: string
  parentId?: string
}

export interface PictogramResult {
  id: number
  label: string
  imageUrl: string
  keywords: string[]
}

export const categoryColors: Record<FitzgeraldCategory, string> = {
  people: '#f1c84b',
  verbs: '#65b96d',
  descriptive: '#66a8d8',
  nouns: '#ed9a55',
  social: '#d88ab6',
  other: '#96a0aa',
}

export const categoryLabels: Record<FitzgeraldCategory, string> = {
  people: 'Personnes / pronoms',
  verbs: 'Actions',
  descriptive: 'Descriptifs',
  nouns: 'Noms',
  social: 'Social',
  other: 'Divers',
}

export const createEmptyBoard = (rows = 4, columns = 5): Board => {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: 'Mon nouveau TLA',
    status: 'draft',
    pageSize: 'A4',
    orientation: 'landscape',
    rows,
    columns,
    cells: Array.from({ length: rows * columns }, (_, index) => ({
      id: crypto.randomUUID(),
      row: Math.floor(index / columns),
      column: index % columns,
      source: null,
      label: '',
      category: 'other',
      essential: false,
      favorite: false,
    })),
    overflowWords: [],
    createdAt: now,
    updatedAt: now,
  }
}
