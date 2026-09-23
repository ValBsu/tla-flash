import { jsPDF } from 'jspdf'
import { toPng } from 'html-to-image'
import { saveAs } from 'file-saver'
import type { Board } from '../types'

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

const prepareImagesForExport = async (element: HTMLElement): Promise<() => void> => {
  const restorations: Array<() => void> = []
  await Promise.all(Array.from(element.querySelectorAll('img')).map(async (image) => {
    if (!image.src || image.src.startsWith('data:')) return
    const originalSource = image.src
    try {
      const response = await fetch(originalSource, { mode: 'cors' })
      if (!response.ok) return
      image.src = await blobToDataUrl(await response.blob())
      await image.decode().catch(() => undefined)
      restorations.push(() => { image.src = originalSource })
    } catch {
      // Keep the remote source when the browser cannot fetch it as a blob.
    }
  }))
  return () => restorations.forEach((restore) => restore())
}

export async function exportBoardPdf(element: HTMLElement, board: Board, download = true): Promise<Blob> {
  const restoreImages = await prepareImagesForExport(element)
  let dataUrl: string
  try {
    dataUrl = await toPng(element, { pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff' })
  } finally {
    restoreImages()
  }
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
