import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseTranslationResponse, translateTexts } from './translation'

afterEach(() => vi.unstubAllGlobals())

describe('réponse du service de traduction', () => {
  it('extrait le texte traduit et décode les entités HTML', () => {
    expect(parseTranslationResponse({
      responseStatus: 200,
      responseData: { translatedText: 'I &amp; you&#39;re here' },
    })).toBe("I & you're here")
  })

  it('rejette une réponse en erreur ou incomplète', () => {
    expect(() => parseTranslationResponse({ responseStatus: 429 })).toThrow()
    expect(() => parseTranslationResponse(null)).toThrow()
  })

  it('traduit une seule fois les doublons et conserve l’ordre et les textes vides', async () => {
    const request = vi.fn(async (input: URL) => new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: `${input.searchParams.get('q')} traduit` } })))
    vi.stubGlobal('fetch', request)
    expect(await translateTexts(['chat', '', 'chien', 'chat'])).toEqual(['chat traduit', '', 'chien traduit', 'chat traduit'])
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('annule les traductions en cours sans soumettre les suivantes', async () => {
    const request = vi.fn(() => new Promise<Response>(() => undefined))
    vi.stubGlobal('fetch', request)
    const controller = new AbortController()
    const running = translateTexts(['a', 'b', 'c', 'd'], controller.signal)
    controller.abort()
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).toHaveBeenCalledTimes(3)
  })
})
