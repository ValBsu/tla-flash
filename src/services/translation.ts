import { fetchJson, mapConcurrent } from './network'

interface TranslationResponse {
  responseStatus?: unknown
  responseData?: { translatedText?: unknown }
}

export const parseTranslationResponse = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') throw new Error('Réponse de traduction illisible.')
  const response = payload as TranslationResponse
  if (response.responseStatus !== 200 || typeof response.responseData?.translatedText !== 'string') {
    throw new Error('Le service de traduction a refusé la demande.')
  }
  return response.responseData.translatedText
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

const translateOne = async (text: string, signal: AbortSignal): Promise<string> => {
  const url = new URL('https://api.mymemory.translated.net/get')
  url.searchParams.set('q', text)
  url.searchParams.set('langpair', 'fr|en')
  return parseTranslationResponse(await fetchJson(url, signal))
}

export async function translateTexts(texts: string[], signal?: AbortSignal): Promise<string[]> {
  const uniqueTexts = [...new Set(texts.filter((text) => text.trim()))]
  const translated = new Map<string, string>()
  await mapConcurrent(uniqueTexts, async (text, _index, requestSignal) => {
    translated.set(text, await translateOne(text, requestSignal))
  }, signal, 3)
  return texts.map((text) => translated.get(text) ?? text)
}
