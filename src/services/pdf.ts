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

const createExportCopy = async (element: HTMLElement): Promise<HTMLElement> => {
  const copy = element.cloneNode(true) as HTMLElement
  copy.style.position = 'fixed'
  copy.style.left = '-100000px'
  copy.style.top = '0'
  copy.style.width = `${element.getBoundingClientRect().width}px`
  copy.style.height = `${element.getBoundingClientRect().height}px`
  document.body.appendChild(copy)
  await Promise.all(Array.from(copy.querySelectorAll('img')).map(async (image) => {
    if (!image.src || image.src.startsWith('data:')) return
    try {
      const response = await fetch(image.src, { mode: 'cors' })
      if (response.ok) image.src = await blobToDataUrl(await response.blob())
    } catch {
      // The original source remains available for browsers that allow it.
    }
  }))
  return copy
}

export async function exportBoardPdf(element: HTMLElement, board: Board, download = true): Promise<Blob> {
  const copy = await createExportCopy(element)
  let dataUrl: string
  try {
    dataUrl = await toPng(copy, { pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff' })
  } finally {
    copy.remove()
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
