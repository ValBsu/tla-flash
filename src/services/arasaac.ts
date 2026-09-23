import type { PictogramResult } from '../types'

const API_BASE = 'https://api.arasaac.org/api/pictograms/fr/search/'
const imageUrl = (id: number) => `https://static.arasaac.org/pictograms/${id}/${id}_500.png`

export async function searchPictograms(term: string, signal?: AbortSignal): Promise<PictogramResult[]> {
  const response = await fetch(`${API_BASE}${encodeURIComponent(term.trim())}`, { signal })
  if (!response.ok) throw new Error(`ARASAAC indisponible (${response.status})`)
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) return []
  return payload.slice(0, 12).flatMap((entry): PictogramResult[] => {
    const object = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : null
    const rawId = object?._id ?? object?.id ?? entry
    const id = Number(rawId)
    if (!Number.isFinite(id)) return []
    const keywords = Array.isArray(object?.keywords) ? object.keywords.map((keyword) => {
      if (typeof keyword === 'string') return keyword
      if (typeof keyword === 'object' && keyword !== null) {
        const value = keyword as Record<string, unknown>
        return String(value.keyword ?? value.word ?? value.text ?? '')
      }
      return String(keyword)
    }).filter(Boolean) : []
    return [{ id, label: keywords[0] ?? term, imageUrl: imageUrl(id), keywords }]
  })
}
