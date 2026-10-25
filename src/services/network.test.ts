import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson, mapConcurrent } from './network'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('requêtes annulables et délais', () => {
  it('interrompt aussi un téléchargement dont le corps ne répond plus', async () => {
    vi.useFakeTimers()
    let requestSignal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((_input, init) => {
      requestSignal = init.signal
      return Promise.resolve({ ok: true, json: () => new Promise(() => undefined) })
    }))
    const response = fetchJson('/slow', undefined, 100)
    const failure = expect(response).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(100)
    await failure
    expect(requestSignal.aborted).toBe(true)
  })

  it('ne lance aucune requête si le signal est déjà annulé', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    controller.abort()
    await expect(fetchJson('/cancelled', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('arrête la file et annule les travaux en cours après le premier échec', async () => {
    const signals: AbortSignal[] = []
    const worker = vi.fn(async (number: number, _index: number, signal: AbortSignal) => {
      signals.push(signal)
      if (number === 0) throw new Error('réseau indisponible')
      return await new Promise<number>(() => undefined)
    })
    await expect(mapConcurrent([0, 1, 2, 3, 4, 5], worker)).rejects.toThrow('réseau indisponible')
    expect(worker).toHaveBeenCalledTimes(4)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it('annule rapidement une file active sans attendre une requête bloquée', async () => {
    const controller = new AbortController()
    const worker = vi.fn(async () => await new Promise<number>(() => undefined))
    const running = mapConcurrent([0, 1, 2, 3, 4, 5], worker, controller.signal)
    controller.abort()
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker).toHaveBeenCalledTimes(4)
  })
})
