import { jsPDF } from 'jspdf'
import { saveAs } from 'file-saver'
import { type Board, type Cell } from '../types'

const pageDimensions = (board: Board) => board.pageSize === 'A3' ? { width: 420, height: 297 } : { width: 297, height: 210 }

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

const grayscaleImage = async (source: PdfImage): Promise<string> => {
  const image = typeof source === 'string' ? await loadImageElement(source) : source
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas indisponible')
  context.filter = 'grayscale(1)'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
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
  const imageCache = await Promise.all(board.cells.map(async (cell) => {
    const image = await fetchImageData(cell)
    if (!image || !cell.blackAndWhite) return image
    try { return await grayscaleImage(image) } catch { return image }
  }))

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
    if (!cell.label) return
    const x = margin + cell.column * (cellWidth + gap)
    const y = margin + titleHeight + cell.row * (cellHeight + gap)

    doc.setDrawColor(0, 0, 0)
    doc.setFillColor(255, 255, 255)
    doc.setLineWidth(0.7)
    doc.roundedRect(x, y, cellWidth, cellHeight, 2, 2, 'FD')

    const image = imageCache[index]
    if (image) fitImage(doc, image, x + 2.4, y + 2.4, cellWidth - 4.8, cellHeight * 0.68)
    if (cell.label) {
      doc.setFont('helvetica', cell.bold === false ? 'normal' : 'bold')
      const scale = cell.textSize === 'small' ? 0.8 : cell.textSize === 'large' ? 1.25 : 1
      doc.setFontSize(Math.max(7, Math.min(17, (cellWidth / 6.5) * scale)))
      const textColor = cell.textColor ?? '#263332'
      doc.setTextColor(Number.parseInt(textColor.slice(1, 3), 16), Number.parseInt(textColor.slice(3, 5), 16), Number.parseInt(textColor.slice(5, 7), 16))
      const label = cell.textCase === 'lowercase' ? cell.label.toLocaleLowerCase('fr-FR') : cell.label.toLocaleUpperCase('fr-FR')
      doc.text(label, x + cellWidth / 2, y + cellHeight - 4, { align: 'center', maxWidth: cellWidth - 6 })
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
