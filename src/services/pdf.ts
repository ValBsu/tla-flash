import { jsPDF } from 'jspdf'
import { toPng } from 'html-to-image'
import { saveAs } from 'file-saver'
import type { Board } from '../types'

export async function exportBoardPdf(element: HTMLElement, board: Board, download = true): Promise<Blob> {
  const dataUrl = await toPng(element, { pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff' })
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: board.pageSize.toLowerCase() })
  const width = board.pageSize === 'A3' ? 420 : 297
  const height = board.pageSize === 'A3' ? 297 : 210
  pdf.addImage(dataUrl, 'PNG', 0, 0, width, height)
  pdf.setFontSize(6)
  pdf.setTextColor(100)
  pdf.text('Pictogrammes : ARASAAC (CC BY-NC-SA)', 8, height - 5)
  const blob = pdf.output('blob')
  if (download) saveAs(blob, `${board.title || 'tla'}.pdf`)
  return blob
}
