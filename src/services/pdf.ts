import { pictogramCredit } from './pictograms'
import { jsPDF } from 'jspdf'
import { saveAs } from 'file-saver'
import { type Board, type Cell } from '../types'

const IMAGE_CONCURRENCY = 4
const FETCH_TIMEOUT_MS = 8_000
const IMAGE_TIMEOUT_MS = 4_000
const LINE_HEIGHT = 1.2
const pageDimensions = (board: Board) => board.pageSize === 'A3' ? { width: 420, height: 297 } : { width: 297, height: 210 }

type PdfImage = { data: string; width: number; height: number; format: string }
type TextArea = { x: number; y: number; width: number; height: number }

const loadImageElement = (source: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image()
  const finish = (error?: Error) => {
    clearTimeout(timeout)
    image.onload = null
    image.onerror = null
    if (error) { image.src = ''; reject(error) }
    else resolve(image)
  }
  const timeout = setTimeout(() => finish(new Error('Délai de chargement de l’image dépassé.')), IMAGE_TIMEOUT_MS)
  image.crossOrigin = 'anonymous'
  image.onload = () => finish()
  image.onerror = () => finish(new Error('Image inaccessible ou illisible.'))
  image.src = source
})

const blobToDataUrl = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`
}

const imageToDataUrl = async (source: string, grayscale: boolean): Promise<string> => {
  const image = await loadImageElement(source)
  const canvas = document.createElement('canvas')
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const scale = Math.min(1, 1600 / Math.max(width, height))
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  if (!canvas.width || !canvas.height) throw new Error('Image vide.')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('La préparation des images est indisponible dans ce navigateur.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  if (grayscale) {
    // Pixel conversion also works in browsers whose canvas ignores context.filter.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let index = 0; index < pixels.data.length; index += 4) {
      const value = Math.round(pixels.data[index] * 0.2126 + pixels.data[index + 1] * 0.7152 + pixels.data[index + 2] * 0.0722)
      pixels.data[index] = value
      pixels.data[index + 1] = value
      pixels.data[index + 2] = value
    }
    context.putImageData(pixels, 0, 0)
  }
  return canvas.toDataURL('image/png')
}

const fetchImageData = async (source: string): Promise<string> => {
  if (source.startsWith('data:')) return source
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(source, { mode: 'cors', signal: controller.signal })
        if (!response.ok) throw new Error(`Image indisponible (${response.status}).`)
        return blobToDataUrl(await response.blob())
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('Délai de téléchargement de l’image dépassé.'))
        }, FETCH_TIMEOUT_MS)
      }),
    ])
  } catch {
    // The browser image cache may still contain a usable image after a fetch failure.
    return imageToDataUrl(source, false)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

const prepareImages = async (doc: jsPDF, boards: Board[]): Promise<Map<Cell, PdfImage>> => {
  const cells = boards.flatMap((board) => board.cells).filter((cell) => cell.imageData)
  const sources = new Map<string, Promise<string>>()
  const variants = new Map<string, Promise<PdfImage>>()
  const prepared = new Map<Cell, PdfImage>()
  const missing: string[] = []
  let nextIndex = 0
  const load = (cell: Cell) => {
    const source = cell.imageData!
    const key = `${cell.blackAndWhite ? 'gray:' : 'color:'}${source}`
    let result = variants.get(key)
    if (!result) {
      result = (async () => {
        let data = sources.get(source)
        if (!data) {
          data = fetchImageData(source)
          sources.set(source, data)
        }
        const original = await data
        const image = cell.blackAndWhite ? await imageToDataUrl(original, true) : original
        const properties = doc.getImageProperties(image)
        if (!(properties.width > 0 && properties.height > 0)) throw new Error('Image vide.')
        return { data: image, width: properties.width, height: properties.height, format: properties.fileType }
      })()
      variants.set(key, result)
    }
    return result
  }
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, cells.length) }, async () => {
    while (nextIndex < cells.length) {
      const cell = cells[nextIndex++]
      try { prepared.set(cell, await load(cell)) } catch {
        missing.push(cell.label.trim() || `case ${cell.row + 1}, ${cell.column + 1}`)
      }
    }
  }))
  if (missing.length) {
    const labels = [...new Set(missing)]
    const detail = labels.slice(0, 8).map((label) => `« ${label.slice(0, 80)} »`).join(', ')
    const remaining = labels.length > 8 ? ` et ${labels.length - 8} autre(s)` : ''
    throw new Error(`Le PDF n’a pas été créé : impossible de préparer les images de ${detail}${remaining}. Vérifiez la connexion ou remplacez ces images, puis réessayez.`)
  }
  return prepared
}

const ellipsize = (doc: jsPDF, text: string, width: number): string => {
  let result = text.trimEnd()
  while (result && doc.getTextWidth(`${result}...`) > width) result = result.slice(0, -1)
  return result ? `${result}...` : ''
}

const drawTextInArea = (doc: jsPDF, text: string, area: TextArea, preferredSize: number, minimumSize: number, align: 'left' | 'center' = 'center') => {
  if (!text || area.width <= 0 || area.height <= 0) return
  const value = text.replace(/[\r\n\t]+/g, ' ').slice(0, 2_000)
  let size = preferredSize
  let lines: string[] = []
  let maxLines = 1
  while (size >= minimumSize) {
    doc.setFontSize(size)
    lines = doc.splitTextToSize(value, area.width) as string[]
    maxLines = Math.floor(area.height / (size / doc.internal.scaleFactor * LINE_HEIGHT))
    if (maxLines >= lines.length && maxLines > 0) break
    if (size === minimumSize) break
    size = Math.max(minimumSize, size - 0.5)
  }
  if (maxLines < 1) {
    size = Math.min(size, area.height * doc.internal.scaleFactor / LINE_HEIGHT)
    doc.setFontSize(size)
    maxLines = 1
    lines = doc.splitTextToSize(value, area.width) as string[]
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    lines[lines.length - 1] = ellipsize(doc, lines[lines.length - 1], area.width)
  }
  const lineHeight = size / doc.internal.scaleFactor * LINE_HEIGHT
  const blockHeight = lines.length * lineHeight
  const y = area.y + (area.height - blockHeight) / 2 + size / doc.internal.scaleFactor * 0.9
  doc.text(lines, align === 'center' ? area.x + area.width / 2 : area.x, y, { align, lineHeightFactor: LINE_HEIGHT })
}

const drawBoard = (doc: jsPDF, board: Board, images: Map<Cell, PdfImage>) => {
  const { width, height } = pageDimensions(board)
  const margin = board.pageSize === 'A3' ? 16 : 11
  const titleHeight = 14
  const creditHeight = 7
  const gap = 2.5
  const gridWidth = width - margin * 2
  const gridHeight = height - margin * 2 - titleHeight - creditHeight
  const cellWidth = (gridWidth - gap * (board.columns - 1)) / board.columns
  const cellHeight = (gridHeight - gap * (board.rows - 1)) / board.rows
  doc.setFillColor(255, 255, 255)
  doc.rect(0, 0, width, height, 'F')
  doc.setTextColor(39, 51, 51)
  doc.setFont('helvetica', 'bold')
  drawTextInArea(doc, board.title || 'TLA', { x: margin, y: margin, width: gridWidth, height: titleHeight - 2 }, board.pageSize === 'A3' ? 19 : 15, 9)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(100, 110, 106)
  doc.text(`${board.pageSize} · paysage`, width - margin, margin - 2, { align: 'right' })
  const positions = new Map(board.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]))
  for (let row = 0; row < board.rows; row += 1) {
    for (let column = 0; column < board.columns; column += 1) {
      const cell = positions.get(`${row}:${column}`)
      const x = margin + column * (cellWidth + gap)
      const y = margin + titleHeight + row * (cellHeight + gap)
      const padding = Math.min(2.4, cellWidth * 0.08, cellHeight * 0.08)
      doc.setDrawColor(0, 0, 0)
      doc.setFillColor(255, 255, 255)
      doc.setLineWidth(0.7)
      doc.roundedRect(x, y, cellWidth, cellHeight, Math.min(2, cellWidth / 8, cellHeight / 8), Math.min(2, cellWidth / 8, cellHeight / 8), 'FD')
      if (!cell) continue
      const image = images.get(cell)
      const labelTop = y + cellHeight * 0.73
      if (image) {
        const imageWidth = cellWidth - padding * 2
        const imageHeight = cellHeight * 0.68 - padding
        const ratio = Math.min(imageWidth / image.width, imageHeight / image.height)
        const fittedWidth = image.width * ratio
        const fittedHeight = image.height * ratio
        doc.addImage(image.data, image.format, x + (cellWidth - fittedWidth) / 2, y + padding + (imageHeight - fittedHeight) / 2, fittedWidth, fittedHeight)
      }
      if (cell.label) {
        doc.setFont('helvetica', cell.bold === false ? 'normal' : 'bold')
        const scale = cell.textSize === 'small' ? 0.8 : cell.textSize === 'large' ? 1.25 : 1
        const preferredSize = Math.max(7, Math.min(17, (cellWidth / 6.5) * scale))
        const textColor = /^#[0-9a-f]{6}$/i.test(cell.textColor ?? '') ? cell.textColor! : '#263332'
        doc.setTextColor(Number.parseInt(textColor.slice(1, 3), 16), Number.parseInt(textColor.slice(3, 5), 16), Number.parseInt(textColor.slice(5, 7), 16))
        const label = cell.textCase === 'lowercase' ? cell.label.toLocaleLowerCase('fr-FR') : cell.label.toLocaleUpperCase('fr-FR')
        drawTextInArea(doc, label, { x: x + padding, y: labelTop, width: cellWidth - padding * 2, height: y + cellHeight - padding - labelTop }, preferredSize, Math.min(6.5, preferredSize))
      }
    }
  }
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 110, 106)
  drawTextInArea(doc, pictogramCredit(board), { x: margin, y: height - 8, width: gridWidth, height: 5 }, 6, 4.5, 'left')
}

/** Images are prepared completely before any file is downloaded. */
export async function exportBoardsPdf(boards: Board[], filename = 'tla', download = true): Promise<Blob> {
  if (!boards.length) throw new Error('Aucun TLA à exporter.')
  for (const board of boards) {
    if (!Number.isInteger(board.rows) || !Number.isInteger(board.columns) || board.rows < 1 || board.rows > 10 || board.columns < 1 || board.columns > 15) {
      throw new Error(`La grille du TLA « ${board.title} » est invalide.`)
    }
  }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: boards[0].pageSize.toLowerCase() })
  const images = await prepareImages(doc, boards)
  boards.forEach((board, index) => {
    if (index) doc.addPage(board.pageSize.toLowerCase(), 'landscape')
    drawBoard(doc, board, images)
  })
  const blob = doc.output('blob')
  if (download) saveAs(blob, `${filename || 'tla'}.pdf`)
  return blob
}

export async function exportBoardPdf(_element: HTMLElement, board: Board, download = true): Promise<Blob> {
  return exportBoardsPdf([board], board.title || 'tla', download)
}
