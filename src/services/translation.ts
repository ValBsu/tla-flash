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

const translateOne = async (text: string): Promise<string> => {
  const url = new URL('https://api.mymemory.translated.net/get')
  url.searchParams.set('q', text)
  url.searchParams.set('langpair', 'fr|en')
  const response = await fetch(url)
  if (!response.ok) throw new Error('Le service de traduction est indisponible.')
  return parseTranslationResponse(await response.json())
}

export async function translateTexts(texts: string[]): Promise<string[]> {
  const uniqueTexts = [...new Set(texts.filter((text) => text.trim()))]
  const translated = new Map<string, string>()
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < uniqueTexts.length) {
      const text = uniqueTexts[nextIndex]
      nextIndex += 1
      translated.set(text, await translateOne(text))
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, uniqueTexts.length) }, () => worker()))
  return texts.map((text) => translated.get(text) ?? text)
}
