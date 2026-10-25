/**
 * Smoke navigateur de production. Playwright est installé uniquement dans /private/tmp.
 * Exécuter après npm run build et npm run preview -- --host 127.0.0.1 --port 4173 :
 * PLAYWRIGHT_BROWSERS_PATH=/private/tmp/tla-flash-browsers node audit/verification-browser-2026-10-25.mjs
 * Un contexte neuf et des données inventées sont utilisés; aucune requête externe n'est autorisée.
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '/private/tmp/tla-flash-browser/node_modules/playwright/index.mjs'

const baseUrl = process.env.TLA_SMOKE_URL || 'http://127.0.0.1:4173'
const output = resolve('audit')
await mkdir(output, { recursive: true })
const report = { date: '2026-10-25', target: baseUrl, browser: '', checks: [], consoleErrors: [], externalRequestsBlocked: [], success: false }
const browser = await chromium.launch({ headless: true, channel: 'chromium' })
report.browser = browser.version()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
await context.route('**/*', async (route) => {
  const url = route.request().url()
  if (url.startsWith(new URL(baseUrl).origin) || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('chrome:') || url.startsWith('chrome-extension:')) return route.continue()
  report.externalRequestsBlocked.push(url)
  return route.abort()
})
const page = await context.newPage()
page.on('pageerror', (error) => report.consoleErrors.push(error.message))
page.on('dialog', (dialog) => dialog.accept())

async function check(name, action) {
  const start = performance.now()
  try {
    const detail = await action()
    report.checks.push({ name, success: true, durationMs: Math.round(performance.now() - start), ...(detail ? { detail } : {}) })
    console.log(`PASS ${name}`)
  } catch (error) {
    report.checks.push({ name, success: false, error: String(error), durationMs: Math.round(performance.now() - start) })
    throw error
  }
}
async function eventually(condition, message, timeout = 12_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await condition()) return; await delay(100) }
  throw new Error(message)
}
async function stored(target = page, store = 'boards') {
  return target.evaluate((name) => new Promise((resolve, reject) => {
    const opening = indexedDB.open('tla-flash')
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const db = opening.result
      const request = db.transaction(name).objectStore(name).getAll()
      request.onerror = () => { db.close(); reject(request.error) }
      request.onsuccess = () => { db.close(); resolve(request.result) }
    }
  }), store)
}
const title = 'Essai navigateur — école'
let originalId
let photoId
const copyTitle = `${title} (copie)`
const png = await readFile(resolve('public/pwa-192.png'))

try {
  await check('Création et persistance IndexedDB après rechargement', async () => {
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.getByRole('textbox', { name: 'Titre du TLA 1', exact: true }).fill(title)
    await eventually(async () => (await stored()).some((board) => board.title === title), 'Titre non persisté')
    originalId = (await stored()).find((board) => board.title === title).id
    await page.reload({ waitUntil: 'networkidle' })
    await eventually(async () => await page.getByRole('textbox', { name: 'Titre du TLA 1', exact: true }).inputValue() === title, 'Le dernier TLA actif ne se rouvre pas')
    assert.equal((await stored()).length, 1)
  })

  await check('Photo et styles conservés après réduction puis agrandissement', async () => {
    const board = page.locator('.board-page').first()
    await board.locator('.empty-add').last().click()
    await page.locator('input[accept="image/*"]').setInputFiles({ name: 'image-essai.png', mimeType: 'image/png', buffer: png })
    await eventually(async () => (await stored()).find((item) => item.id === originalId).cells.some((cell) => cell.source === 'upload'), 'Photo non importée')
    photoId = (await stored()).find((item) => item.id === originalId).cells.find((cell) => cell.source === 'upload').id
    await page.locator('.style-panel > summary').click()
    await page.getByRole('button', { name: 'Grand', exact: true }).click()
    await page.getByRole('button', { name: 'Gras', exact: true }).click()
    const resize = async (rows, columns) => {
      await board.getByRole('button', { name: /^Grille / }).click()
      await board.getByRole('spinbutton', { name: 'Nombre de lignes' }).fill(String(rows))
      await board.getByRole('spinbutton', { name: 'Nombre de colonnes' }).fill(String(columns))
      await board.getByRole('button', { name: 'Appliquer', exact: true }).click()
    }
    await resize(1, 1)
    await eventually(async () => (await stored()).find((item) => item.id === originalId).overflowCells?.some((cell) => cell.id === photoId && cell.textSize === 'large' && cell.bold === false), 'Photo ou style perdu en réserve')
    await resize(4, 5)
    await eventually(async () => (await stored()).find((item) => item.id === originalId).cells.some((cell) => cell.id === photoId && cell.imageData?.startsWith('data:image/') && cell.textSize === 'large' && cell.bold === false), 'Photo ou style non restauré')
  })

  await check('Recherche et insertion d’un pictogramme Sclera sans service externe', async () => {
    await page.getByRole('button', { name: /Pictogrammes .*ARASAAC/ }).click()
    await page.getByRole('button', { name: 'Sclera Choisir pour ce TLA', exact: true }).click()
    await eventually(async () => (await stored()).find((item) => item.id === originalId).pictogramBank === 'sclera', 'Banque non enregistrée')
    await page.locator('.board-page').first().locator('.empty-add').first().click()
    await page.getByRole('textbox', { name: 'Mot à rechercher' }).fill('maison')
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click()
    await page.locator('.result-card').first().waitFor()
    await page.locator('.result-card').first().click()
    await eventually(async () => (await stored()).find((item) => item.id === originalId).cells.some((cell) => cell.source === 'sclera'), 'Pictogramme non enregistré')
  })

  await check('Préparation explicite des images hors connexion', async () => {
    await page.getByRole('button', { name: 'Préparer hors connexion', exact: true }).click()
    await page.getByText(/images disponibles sur cet appareil\./).waitFor()
    return await page.getByText(/images disponibles sur cet appareil\./).textContent()
  })

  await check('Duplication du TLA avec identifiants indépendants', async () => {
    await page.getByRole('button', { name: 'Dupliquer ce TLA', exact: true }).click()
    await eventually(async () => (await stored()).some((board) => board.title === copyTitle), 'Copie absente')
    const boards = await stored()
    const original = boards.find((item) => item.id === originalId)
    const copy = boards.find((item) => item.title === copyTitle)
    assert.notEqual(copy.id, original.id)
    assert.equal(copy.cells.length, original.cells.length)
    assert.ok(copy.cells.every((cell) => !original.cells.some((other) => other.id === cell.id)))
  })

  await check('Filtre de recherche dans la bibliothèque', async () => {
    await page.getByRole('button', { name: 'Bibliothèque', exact: true }).click()
    const search = page.getByRole('textbox', { name: 'Rechercher dans la bibliothèque' })
    await search.fill('introuvable-test-123')
    await eventually(async () => await page.locator('.saved-board-row').count() === 0, 'Le filtre ne masque pas les autres TLA')
    await search.fill('copie')
    await eventually(async () => await page.locator('.saved-board-row').count() === 1, 'Le filtre ne retrouve pas la copie')
    assert.ok((await page.locator('.saved-board-row').textContent()).includes(copyTitle))
  })

  await check('Corbeille et restauration sans perte de contenu', async () => {
    const copy = (await stored()).find((item) => item.title === copyTitle)
    await page.getByRole('button', { name: `Supprimer ${copyTitle}`, exact: true }).click()
    await eventually(async () => (await stored(page, 'deletedBoards')).some((item) => item.id === copy.id), 'Corbeille non enregistrée')
    assert.ok(!(await stored()).some((item) => item.id === copy.id))
    await page.locator('.trash-panel > summary').click()
    await page.getByRole('button', { name: `Restaurer ${copyTitle}`, exact: true }).click()
    await eventually(async () => (await stored()).some((item) => item.id === copy.id), 'Restauration non enregistrée')
    const restored = (await stored()).find((item) => item.id === copy.id)
    assert.deepEqual(restored.cells, copy.cells)
    assert.equal((await stored(page, 'deletedBoards')).length, 0)
    await page.getByRole('textbox', { name: 'Rechercher dans la bibliothèque' }).fill('')
  })

  await check('Sauvegarde ZIP autonome et restauration réelle par l’interface', async () => {
    const before = await stored()
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Sauvegarder', exact: true }).click(),
    ]).then(([file]) => file)
    const archivePath = resolve(output, 'verification-sauvegarde-2026-10-25.zip')
    await download.saveAs(archivePath)
    await page.locator('input[accept=".zip,application/zip"]').setInputFiles(archivePath)
    await page.getByText(/Restauration terminée : 2 TLA/).waitFor({ timeout: 20_000 })
    const after = await stored()
    assert.equal(after.length, before.length)
    for (const previous of before) {
      const restored = after.find((board) => board.id === previous.id)
      assert.ok(restored)
      const semanticCells = (cells) => JSON.parse(JSON.stringify(cells.map(({ imageData, ...cell }) => ({ ...cell, hasImage: Boolean(imageData) }))))
      assert.deepEqual(semanticCells(restored.cells), semanticCells(previous.cells))
      assert.ok(restored.cells.filter((cell) => cell.imageData).every((cell) => cell.imageData.startsWith('data:image/')))
      assert.ok(restored.revision > previous.revision)
    }
    await eventually(async () => page.locator('.board-page .cell-main img').evaluateAll((images) => images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0)), 'Images restaurées non visibles')
    return { bytes: (await readFile(archivePath)).length, boards: after.length, embeddedImages: after.flatMap((board) => board.cells).filter((cell) => cell.imageData?.startsWith('data:image/')).length }
  })

  await check('Véritable aperçu PDF et téléchargement A4 paysage', async () => {
    await page.getByRole('button', { name: 'Aperçu PDF', exact: true }).click()
    const frame = page.locator('iframe.pdf-preview')
    await frame.waitFor({ timeout: 20_000 })
    assert.ok((await frame.getAttribute('src')).startsWith('blob:'))
    // The native PDF viewer loads after the iframe appears. Use full Chromium's new headless mode.
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: 'Télécharger le PDF', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve(output, 'verification-apercu-2026-10-25.png') })
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Télécharger le PDF', exact: true }).click(),
    ]).then(([file]) => file)
    const filePath = resolve(output, 'verification-export-2026-10-25.pdf')
    await download.saveAs(filePath)
    const pdf = (await readFile(filePath)).toString('latin1')
    assert.ok(pdf.startsWith('%PDF-'))
    const mediaBox = pdf.match(/\/MediaBox\s*\[([^\]]+)\]/)?.[1]
    assert.ok(mediaBox, 'MediaBox PDF manquant')
    const coordinates = mediaBox.trim().split(/\s+/).map(Number)
    assert.ok(Math.abs(coordinates[2] - 841.89) < 1 && Math.abs(coordinates[3] - 595.28) < 1)
    await page.getByRole('button', { name: 'Fermer l’aperçu', exact: true }).click()
    await page.screenshot({ path: resolve(output, 'verification-desktop-2026-10-25.png') })
    return { bytes: Buffer.byteLength(pdf, 'latin1'), mediaBox }
  })

  await check('Conflit entre deux onglets préserve la dernière version', async () => {
    const other = await context.newPage()
    other.on('pageerror', (error) => report.consoleErrors.push(error.message))
    await other.goto(baseUrl, { waitUntil: 'networkidle' })
    const latestTitle = 'Version du second onglet'
    await other.getByRole('textbox', { name: 'Titre du TLA 2', exact: true }).fill(latestTitle)
    await eventually(async () => (await stored()).some((item) => item.title === latestTitle), 'Second onglet non enregistré')
    await page.getByRole('textbox', { name: 'Titre du TLA 2', exact: true }).fill('Version ancienne à conserver')
    await page.getByRole('button', { name: 'Conserver ma version en copie', exact: true }).waitFor()
    assert.ok((await stored()).some((item) => item.title === latestTitle))
    assert.ok(!(await stored()).some((item) => item.title === 'Version ancienne à conserver'))
    await page.getByRole('button', { name: 'Conserver ma version en copie', exact: true }).click()
    await eventually(async () => (await stored()).some((item) => item.title === 'Version ancienne à conserver (copie)'), 'Copie de récupération non enregistrée')
    await other.close()
  })

  await check('Affichage mobile à 360 px sans débordement horizontal', async () => {
    await page.setViewportSize({ width: 360, height: 800 })
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
    assert.ok(dimensions.document <= dimensions.viewport + 1, `Débordement ${dimensions.document}px pour ${dimensions.viewport}px`)
    await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click()
    await eventually(async () => page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().left >= -1), 'Menu mobile non ouvert')
    await page.screenshot({ path: resolve(output, 'verification-mobile-menu-2026-10-25.png') })
    await page.getByRole('button', { name: 'Fermer le menu', exact: true }).first().click()
    await eventually(async () => page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right <= 1), 'Menu mobile non fermé')
    await page.screenshot({ path: resolve(output, 'verification-mobile-2026-10-25.png') })
    return dimensions
  })

  await check('Réouverture réelle hors connexion de l’interface et des TLA', async () => {
    await eventually(async () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'Service worker non activé', 15_000)
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await eventually(async () => (await stored()).length === 3, 'Tableaux hors connexion absents')
    await page.getByRole('textbox', { name: 'Titre du TLA 3', exact: true }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Titre du TLA 3', exact: true }).inputValue(), 'Version ancienne à conserver (copie)')
    await context.setOffline(false)
  })

  assert.deepEqual(report.consoleErrors, [])
  assert.deepEqual(report.externalRequestsBlocked, [])
  report.success = true
} catch (error) {
  report.error = String(error)
  await page.screenshot({ path: resolve(output, 'verification-echec-2026-10-25.png') }).catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally {
  await writeFile(resolve(output, 'verification-browser-2026-10-25.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
