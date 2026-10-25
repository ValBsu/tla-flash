// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type jsPDF } from 'jspdf'
import { createEmptyBoard } from '../types'
import { exportBoardPdf, exportBoardsPdf } from './pdf'

const observation = vi.hoisted(() => ({
  documents: [] as unknown[],
  text: [] as { value: string | string[]; x: number; y: number; size: number; color: string; font: string; page: number; width: number }[],
  save: vi.fn(),
}))
vi.mock('file-saver', () => ({ saveAs: observation.save }))
vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>()
  class ObservedPdf extends actual.jsPDF {
    constructor(options?: import('jspdf').jsPDFOptions) {
      super(options)
      observation.documents.push(this)
      const originalText = this.text.bind(this)
      vi.spyOn(this as jsPDF, 'text').mockImplementation((...args) => {
        const [value, x, y] = args
        observation.text.push({ value, x, y, size: this.getFontSize(), color: this.getTextColor(), font: this.getFont().fontStyle, page: this.getCurrentPageInfo().pageNumber, width: Math.max(...(Array.isArray(value) ? value : [value]).map((line) => this.getTextWidth(line))) })
        return originalText(...args)
      })
      vi.spyOn(this as jsPDF, 'roundedRect')
      vi.spyOn(this as jsPDF, 'addImage')
    }
  }
  return { ...actual, jsPDF: ObservedPdf }
})

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const pngData = `data:image/png;base64,${pngBase64}`
const imageResponse = () => ({ ok: true, blob: async () => ({ type: 'image/png', arrayBuffer: async () => Uint8Array.from(atob(pngBase64), (value) => value.charCodeAt(0)).buffer }) })

afterEach(() => {
  observation.documents.length = 0
  observation.text.length = 0
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('export PDF', () => {
  it('dessine aussi les cases vides et borne les légendes et titres longs à leur zone', async () => {
    const board = createEmptyBoard(10, 15)
    board.title = 'UN TITRE TRÈS LONG '.repeat(100)
    board.cells[0] = { ...board.cells[0], label: 'je veux aller à la piscine avec tous mes amis '.repeat(20), textCase: 'lowercase', textColor: '#ff0000', bold: false, textSize: 'large' }
    const blob = await exportBoardPdf(document.createElement('div'), board, false)
    expect(blob.size).toBeGreaterThan(0)
    const doc = observation.documents[0] as jsPDF
    expect(doc.roundedRect).toHaveBeenCalledTimes(150)
    const label = observation.text.find((entry) => entry.color === '#ff0000')!
    expect(label.font).toBe('normal')
    expect(Array.isArray(label.value) && label.value.join(' ')).toMatch(/^je veux/)
    expect(label.width).toBeLessThanOrEqual(16 - 2 * 14.45 * 0.08 + 0.001)
    const lineCount = Array.isArray(label.value) ? label.value.length : 1
    const lastBaseline = label.y + (lineCount - 1) * label.size / doc.internal.scaleFactor * 1.2
    expect(lastBaseline + label.size / doc.internal.scaleFactor * 0.2).toBeLessThan(25 + 14.45)
    expect(Array.isArray(label.value) ? label.value.at(-1) : label.value).toMatch(/\.\.\.$/)
    const title = observation.text[0]
    expect(title.width).toBeLessThanOrEqual(275.001)
    expect(title.y).toBeGreaterThanOrEqual(11)
    expect(observation.save).not.toHaveBeenCalled()
  })

  it('borne les téléchargements concurrents et déduplique les images dans le PDF', async () => {
    const board = createEmptyBoard(2, 5)
    board.cells = board.cells.map((cell, index) => ({ ...cell, label: `IMAGE ${index}`, imageData: `https://images.example/${index % 6}.png` }))
    const pending: (() => void)[] = []
    let active = 0
    let maximum = 0
    const fetchMock = vi.fn(() => new Promise((resolve) => {
      active += 1
      maximum = Math.max(maximum, active)
      pending.push(() => { active -= 1; resolve(imageResponse()) })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = exportBoardPdf(document.createElement('div'), board, false)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    while (fetchMock.mock.calls.length < 6 || pending.length) {
      pending.splice(0).forEach((resolve) => resolve())
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    await expect(result).resolves.toBeInstanceOf(Blob)
    expect(maximum).toBe(4)
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect((observation.documents[0] as jsPDF).addImage).toHaveBeenCalledTimes(10)
  })

  it('refuse un PDF avec image inaccessible, identifie la légende et ne télécharge rien', async () => {
    const board = createEmptyBoard(1, 1)
    board.cells[0] = { ...board.cells[0], label: 'CHAT', imageData: 'https://images.example/missing.png' }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      crossOrigin = ''
      set src(value: string) { if (value) queueMicrotask(() => this.onerror?.()) }
    })
    await expect(exportBoardPdf(document.createElement('div'), board)).rejects.toThrow(/PDF n’a pas été créé.*CHAT/)
    expect(observation.save).not.toHaveBeenCalled()
  })

  it('convertit les images en gris en préservant leur transparence', async () => {
    const board = createEmptyBoard(1, 1)
    board.cells[0] = { ...board.cells[0], label: 'ROUGE', imageData: pngData, blackAndWhite: true }
    vi.stubGlobal('Image', class {
      naturalWidth = 1
      naturalHeight = 1
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      crossOrigin = ''
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()) }
    })
    const data = new Uint8ClampedArray([255, 0, 0, 100])
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data })), putImageData: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(pngData)
    await exportBoardPdf(document.createElement('div'), board, false)
    expect(Array.from(data)).toEqual([54, 54, 54, 100])
    expect(context.putImageData).toHaveBeenCalledOnce()
  })

  it('borne les attentes réseau et image même si le réseau ne termine jamais', async () => {
    vi.useFakeTimers()
    const board = createEmptyBoard(1, 1)
    board.cells[0] = { ...board.cells[0], label: 'IMAGE BLOQUÉE', imageData: 'https://images.example/stalled.png' }
    const fetchMock = vi.fn(() => new Promise(() => undefined))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('Image', class { onload = null; onerror = null; crossOrigin = ''; src = '' })
    const rejection = expect(exportBoardPdf(document.createElement('div'), board, false)).rejects.toThrow('IMAGE BLOQUÉE')
    await vi.advanceTimersByTimeAsync(12_000)
    await rejection
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true)
  })

  it('exporte un dossier en PDF multipage aux formats A4 et A3 sans recharger une image commune', async () => {
    const first = createEmptyBoard(1, 1)
    const second = { ...createEmptyBoard(1, 1), pageSize: 'A3' as const }
    first.cells[0] = { ...first.cells[0], label: 'CHAT', imageData: pngData }
    second.cells[0] = { ...second.cells[0], label: 'CHIEN', imageData: pngData }
    await exportBoardsPdf([first, second], 'Mon dossier')
    const doc = observation.documents[0] as jsPDF
    expect(doc.getNumberOfPages()).toBe(2)
    doc.setPage(1)
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(297, 1)
    doc.setPage(2)
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(420, 1)
    expect(observation.save).toHaveBeenCalledWith(expect.any(Blob), 'Mon dossier.pdf')
  })
})
