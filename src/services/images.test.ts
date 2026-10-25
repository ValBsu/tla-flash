// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readImportedImage } from './images'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

const prepareImageMocks = (width = 4000, height = 3000) => {
  vi.stubGlobal('Image', class {
    naturalWidth = width
    naturalHeight = height
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()) }
  })
  const drawImage = vi.fn()
  const context = { drawImage, getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })) }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation((mime) => `data:${mime};base64,YWJj`)
  return { drawImage, toDataURL, context }
}

describe('readImportedImage', () => {
  it('redimensionne une photo à 1600 pixels en gardant ses proportions', async () => {
    const { drawImage, toDataURL } = prepareImageMocks()
    const result = await readImportedImage(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }))
    expect(result.mime).toBe('image/jpeg')
    expect(result.dataUrl).toBe('data:image/jpeg;base64,YWJj')
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200)
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.88)
  })

  it('préserve le PNG et la transparence des autres formats', async () => {
    const { toDataURL, context } = prepareImageMocks(800, 600)
    expect((await readImportedImage(new File(['png'], 'image.png', { type: 'image/png' }))).mime).toBe('image/png')
    context.getImageData.mockReturnValue({ data: new Uint8ClampedArray([0, 0, 0, 100]) })
    expect((await readImportedImage(new File(['webp'], 'image.webp', { type: 'image/webp' }))).mime).toBe('image/png')
    expect(toDataURL).toHaveBeenLastCalledWith('image/png', 0.88)
  })

  it('rejette les fichiers non pris en charge, vides ou trop volumineux avant lecture', async () => {
    await expect(readImportedImage(new File(['text'], 'text.txt', { type: 'text/plain' }))).rejects.toThrow('Choisissez une image')
    await expect(readImportedImage(new File([], 'vide.png', { type: 'image/png' }))).rejects.toThrow('vide')
    const oversized = new File(['png'], 'large.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 21 * 1024 * 1024 })
    await expect(readImportedImage(oversized)).rejects.toThrow('20 Mo')
  })

  it('annule une lecture en cours et borne le temps d’attente', async () => {
    vi.useFakeTimers()
    const abort = vi.fn()
    vi.stubGlobal('FileReader', class {
      onload = null
      onerror = null
      onabort = null
      readAsDataURL = vi.fn()
      abort = abort
    })
    const file = new File(['png'], 'image.png', { type: 'image/png' })
    const controller = new AbortController()
    const canceled = readImportedImage(file, controller.signal)
    controller.abort()
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
    const timeout = readImportedImage(file)
    const rejection = expect(timeout).rejects.toThrow('trop de temps')
    await vi.advanceTimersByTimeAsync(20_000)
    await rejection
    expect(abort).toHaveBeenCalledTimes(2)
  })
})
