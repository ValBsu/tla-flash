import { jsPDF } from 'jspdf'
import { saveAs } from 'file-saver'
import type { Board, Cell } from '../types'

const pageDimensions = (board: Board) => board.pageSize === 'A3' ? { width: 420, height: 297 } : { width: 297, height: 210 }

const fetchImageData = async (cell: Cell): Promise<string | undefined> => {
  if (!cell.imageData) return undefined
  if (cell.imageData.startsWith('data:')) return cell.imageData
  try {
    const response = await fetch(cell.imageData, { mode: 'cors' })
    if (!response.ok) return undefined
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}

const imageFormat = (dataUrl: string) => {
  const mime = dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase()
  return mime.includes('jpeg') || mime.includes('jpg') ? 'JPEG' : 'PNG'
}

const fitImage = (doc: jsPDF, dataUrl: string, x: number, y: number, width: number, height: number) => {
  const imageProperties = doc.getImageProperties(dataUrl)
  const ratio = Math.min(width / imageProperties.width, height / imageProperties.height)
  const imageWidth = imageProperties.width * ratio
  const imageHeight = imageProperties.height * ratio
  doc.addImage(dataUrl, imageFormat(dataUrl), x + (width - imageWidth) / 2, y + (height - imageHeight) / 2, imageWidth, imageHeight)
}

export async function exportBoardPdf(_element: HTMLElement, board: Board, download = true): Promise<Blob> {
  const { width, height } = pageDimensions(board)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: board.pageSize.toLowerCase() })
  const margin = board.pageSize === 'A3' ? 16 : 11
  const titleHeight = 15
  const creditHeight = 7
  const gap = 3
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
  doc.text(board.title || 'TLA', margin, margin + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(145, 157, 153)
  doc.text(`${board.pageSize} · paysage`, width - margin, margin + 5, { align: 'right' })

  board.cells.forEach((cell, index) => {
    const x = margin + cell.column * (cellWidth + gap)
    const y = margin + titleHeight + cell.row * (cellHeight + gap)
    const color = cell.colorOverride ?? '#96a0aa'
    const rgb = color.match(/[\da-f]{2}/gi)?.map((part) => Number.parseInt(part, 16)) ?? [150, 160, 170]
    doc.setDrawColor(rgb[0] ?? 150, rgb[1] ?? 160, rgb[2] ?? 170)
    doc.setLineWidth(0.6)
    doc.roundedRect(x, y, cellWidth, cellHeight, 2, 2, 'S')
    const image = imageCache[index]
    if (image) fitImage(doc, image, x + 3, y + 3, cellWidth - 6, cellHeight * 0.67)
    if (cell.label) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(Math.max(7, Math.min(12, cellWidth / 7)))
      doc.setTextColor(38, 51, 50)
      doc.text(cell.label, x + cellWidth / 2, y + cellHeight - 5, { align: 'center', maxWidth: cellWidth - 6 })
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
