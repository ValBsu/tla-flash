/** Mesure du DOM monté, avec 50 TLA fictifs de 150 cases, dans un contexte Chromium isolé. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '/private/tmp/tla-flash-browser/node_modules/playwright/index.mjs'

const baseUrl = process.env.TLA_SMOKE_URL || 'http://127.0.0.1:4173'
const report = { date: '2026-10-25', target: baseUrl, logicalBoards: 50, cellsPerBoard: 150, logicalCells: 7500, success: false }
const browser = await chromium.launch({ headless: true, channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await context.route('**/*', (route) => route.request().url().startsWith(new URL(baseUrl).origin) ? route.continue() : route.abort())
const page = await context.newPage()
try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.getByRole('textbox', { name: 'Titre du TLA 1', exact: true }).waitFor()
  await page.evaluate(async () => {
    const boards = Array.from({ length: 50 }, (_, index) => ({
      id: crypto.randomUUID(), title: `Charge essai ${index + 1}`, status: 'draft', pictogramBank: 'sclera', pageSize: 'A4', orientation: 'landscape', rows: 10, columns: 15,
      cells: Array.from({ length: 150 }, (_, cell) => ({ id: crypto.randomUUID(), row: Math.floor(cell / 15), column: cell % 15, label: `Mot ${cell + 1}`, source: null, category: 'other', essential: false, favorite: false })),
      overflowWords: [], revision: 1, createdAt: new Date(Date.UTC(2026, 9, 25, 10, 0, index)).toISOString(), updatedAt: new Date(Date.UTC(2026, 9, 25, 10, 0, index)).toISOString(),
    }))
    await new Promise((resolve, reject) => {
      const opening = indexedDB.open('tla-flash')
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => {
        const db = opening.result
        const transaction = db.transaction('boards', 'readwrite')
        boards.forEach((board) => transaction.objectStore('boards').put(board))
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onerror = () => { db.close(); reject(transaction.error) }
      }
    })
    localStorage.setItem('tla-flash-active-board', boards[0].id)
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('textbox', { name: 'Titre du TLA 1', exact: true }).waitFor()
  // Let IntersectionObserver and React finish mounting the visible region; no latency claim is made.
  await page.waitForTimeout(500)
  report.mountedCells = await page.locator('.cell-card').count()
  report.mountedPages = await page.locator('.board-page').count()
  report.placeholderPages = await page.locator('.board-placeholder').count()
  report.boardWrappers = await page.locator('.deferred-board').count()
  assert.equal(report.boardWrappers, 50)
  assert.ok(report.mountedCells > 0 && report.mountedCells < 1000)
  assert.ok(report.placeholderPages > 0)
  await page.getByRole('button', { name: 'Bibliothèque', exact: true }).click()
  assert.equal(await page.locator('.saved-board-row').count(), 50)
  await page.screenshot({ path: resolve('audit/verification-bibliotheque-2026-10-25.png') })
  report.success = true
  console.log(JSON.stringify(report))
} catch (error) {
  report.error = String(error)
  console.error(error)
  process.exitCode = 1
} finally {
  await writeFile(resolve('audit/verification-bibliotheque-2026-10-25.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
