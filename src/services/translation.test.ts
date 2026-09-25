import { describe, expect, it } from 'vitest'
import { parseTranslationResponse } from './translation'

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
})
