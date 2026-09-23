import { jsPDF } from 'jspdf'
import { saveAs } from 'file-saver'
import { categoryColors, type Board, type Cell } from '../types'

const pageDimensions = (board: Board) => board.pageSize === 'A3' ? { width: 420, height: 297 } : { width: 297, height: 210 }

const hexToRgb = (hex: string) => {
  const value = hex.replace('#', '')
  const normalized = value.length === 3 ? value.split('').map((part) => `${part}${part}`).join('') : value
  const numeric = Number.parseInt(normalized, 16)
  return {
    r: (numeric >> 16) & 255,
    g: (numeric >> 8) & 255,
    b: numeric & 255,
  }
}

type PdfImage = string | HTMLImageElement

const loadImageElement = (source: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Image ARASAAC inaccessible'))
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

const fetchImageData = async (cell: Cell): Promise<PdfImage | undefined> => {
  if (!cell.imageData) return undefined
  if (cell.imageData.startsWith('data:')) return cell.imageData
  try {
    const response = await fetch(cell.imageData, { mode: 'cors' })
    if (!response.ok) throw new Error(`Image indisponible (${response.status})`)
    return await blobToDataUrl(await response.blob())
  } catch {
    try {
      return await loadImageElement(cell.imageData)
    } catch {
      return undefined
    }
  }
}

const imageFormat = (dataUrl: string) => {
  const mime = dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase()
  return mime.includes('jpeg') || mime.includes('jpg') ? 'JPEG' : 'PNG'
}

const fitImage = (doc: jsPDF, image: PdfImage, x: number, y: number, width: number, height: number) => {
  const imageProperties = doc.getImageProperties(image)
  const ratio = Math.min(width / imageProperties.width, height / imageProperties.height)
  const imageWidth = imageProperties.width * ratio
  const imageHeight = imageProperties.height * ratio
  const format = typeof image === 'string' ? imageFormat(image) : 'PNG'
  doc.addImage(image, format, x + (width - imageWidth) / 2, y + (height - imageHeight) / 2, imageWidth, imageHeight)
}

export async function exportBoardPdf(_element: HTMLElement, board: Board, download = true): Promise<Blob> {
  const { width, height } = pageDimensions(board)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: board.pageSize.toLowerCase() })
  const margin = board.pageSize === 'A3' ? 16 : 11
  const titleHeight = 14
  const creditHeight = 7
  const gap = 2.5
  const gridWidth = width - margin * 2
  const gridHeight = height - margin * 2 - titleHeight - creditHeight
  const cellWidth = (gridWidth - gap * (board.columns - 1)) / board.columns
  const cellHeight = (gridHeight - gap * (board.rows - 1)) / board.rows
  const imageCache = await Promise.all(board.cells.map((cell) => fetchImageData(cell)))

  doc.setFillColor(255, 255, 255)
  doc.rect(0, 0, width, height, 'F')

  doc.setTextColor(39, 51, 51)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(board.pageSize === 'A3' ? 19 : 15)
  doc.text(board.title || 'TLA', width / 2, margin + 5.5, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(145, 157, 153)
  doc.text(`${board.pageSize} · paysage`, width - margin, margin + 5.5, { align: 'right' })

  board.cells.forEach((cell, index) => {
    const x = margin + cell.column * (cellWidth + gap)
    const y = margin + titleHeight + cell.row * (cellHeight + gap)
    const baseColor = cell.colorOverride ?? categoryColors[cell.category] ?? '#96a0aa'
    const border = hexToRgb(baseColor)
    const filled = cell.label ? [255, 255, 255] : [250, 252, 250]

    doc.setDrawColor(border.r, border.g, border.b)
    doc.setFillColor(filled[0], filled[1], filled[2])
    doc.setLineWidth(cell.label ? 0.7 : 0.5)
    doc.roundedRect(x, y, cellWidth, cellHeight, 2, 2, 'FD')

    if (!cell.label) {
      doc.setDrawColor(190, 202, 196)
      doc.setLineWidth(0.35)
      doc.line(x + cellWidth * 0.32, y + cellHeight / 2, x + cellWidth * 0.68, y + cellHeight / 2)
      doc.line(x + cellWidth / 2, y + cellHeight * 0.32, x + cellWidth / 2, y + cellHeight * 0.68)
    }

    const image = imageCache[index]
    if (image) fitImage(doc, image, x + 2.4, y + 2.4, cellWidth - 4.8, cellHeight * 0.68)
    if (cell.label) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(Math.max(8, Math.min(12, cellWidth / 6.5)))
      doc.setTextColor(38, 51, 50)
      doc.text(cell.label, x + cellWidth / 2, y + cellHeight - 4, { align: 'center', maxWidth: cellWidth - 6 })
    }
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(100, 110, 106)
  doc.text('Pictogrammes : ARASAAC (CC BY-NC-SA)', margin, height - 5)
  const blob = doc.output('blob')
  if (download) saveAs(blob, `${board.title || 'tla'}.pdf`)
  return blob
}
