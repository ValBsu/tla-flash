/**
 * Mesure le searchBank réellement exporté par le produit actuel.
 * Exécution : node audit/benchmark-search-after-2026-10-25.mjs
 * Vite construit le module en mémoire ; un répertoire temporaire reçoit seulement
 * le bundle ESM à importer et est supprimé à la fin. Aucun réseau n'est utilisé.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const indexBytes = await fs.readFile(new URL('../public/pictograms/sclera/index.json', import.meta.url))
const catalog = JSON.parse(indexBytes.toString())
const terms = ['manger', 'boire', 'école', 'aller', 'je', 'ordinateur', 'maison', 'jouer', 'travail', 'chat']
const searchesPerRun = 150
const runs = 5
const normalize = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').replace(/[^a-z0-9]+/g, ' ').trim()

// Ancienne implémentation : utilisée seulement comme oracle de compatibilité
// et point de comparaison mesuré dans le même processus, jamais comme produit.
const previousSearch = (term) => {
  const query = normalize(term)
  const words = query.split(' ')
  return catalog.map((entry) => ({ ...entry, normalized: normalize([entry.label, ...(entry.keywords ?? [])].join(' ')) }))
    .filter((entry) => words.every((word) => entry.normalized.split(' ').includes(word)))
    .sort((a, b) => Number(normalize(a.label) !== query) - Number(normalize(b.label) !== query) || a.label.length - b.label.length || a.id - b.id)
    .slice(0, 12).map(({ id, label, keywords }) => ({ id, label, keywords: keywords ?? [label], imageUrl: `/pictograms/sclera/${id}.png` }))
}

const measure = async (search) => {
  const durationsMs = []
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now()
    for (let position = 0; position < searchesPerRun; position += 1) await search(terms[position % terms.length])
    durationsMs.push(performance.now() - started)
  }
  const sorted = [...durationsMs].sort((a, b) => a - b)
  return { durationsMs, medianMs: sorted[Math.floor(sorted.length / 2)], minMs: sorted[0], maxMs: sorted.at(-1) }
}

const temporaryDirectory = await fs.mkdtemp('/private/tmp/tla-flash-search-benchmark-')
const originalFetch = globalThis.fetch
let indexRequests = 0
try {
  const buildStarted = performance.now()
  const output = await build({
    // Isolate all Vite filesystem defaults from the application workspace.
    root: temporaryDirectory,
    configFile: false,
    publicDir: false,
    cacheDir: path.join(temporaryDirectory, 'vite-cache'),
    logLevel: 'silent',
    define: { 'import.meta.env.BASE_URL': JSON.stringify('/') },
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      outDir: path.join(temporaryDirectory, 'output'),
      emptyOutDir: false,
      copyPublicDir: false,
      lib: { entry: path.join(projectRoot, 'src/services/pictograms.ts'), formats: ['es'], fileName: () => 'pictograms-product.mjs' },
    },
  })
  const bundles = Array.isArray(output) ? output : [output]
  let entryPath
  for (const bundle of bundles) {
    for (const chunk of bundle.output) {
      const target = path.join(temporaryDirectory, chunk.fileName)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, chunk.type === 'chunk' ? chunk.code : chunk.source)
      if (chunk.type === 'chunk' && chunk.isEntry) entryPath = target
    }
  }
  if (!entryPath) throw new Error('Le bundle produit ne contient pas de point d’entrée.')
  const buildMs = performance.now() - buildStarted

  globalThis.fetch = async (input) => {
    if (String(input) !== '/pictograms/sclera/index.json') throw new Error(`Accès réseau inattendu : ${String(input)}`)
    indexRequests += 1
    return new Response(indexBytes, { headers: { 'Content-Type': 'application/json' } })
  }
  const { searchBank } = await import(pathToFileURL(entryPath).href)
  const firstStarted = performance.now()
  await searchBank(terms[0], 'sclera')
  const firstIndexAndSearchMs = performance.now() - firstStarted

  const compatibility = []
  const preparationStarted = performance.now()
  for (const term of terms) {
    const actual = await searchBank(term, 'sclera')
    const expected = previousSearch(term)
    compatibility.push({ term, equivalent: JSON.stringify(actual) === JSON.stringify(expected), ids: actual.map((item) => item.id) })
  }
  const compatibilityAndWarmupMs = performance.now() - preparationStarted
  if (compatibility.some((item) => !item.equivalent)) throw new Error('Les résultats diffèrent de l’ancienne implémentation.')

  const productWarmCache = await measure((term) => searchBank(term, 'sclera'))
  const previousAlgorithm = await measure(previousSearch)
  const sourceHashes = {}
  for (const filename of ['src/services/pictograms.ts', 'src/services/arasaac.ts', 'src/services/network.ts']) {
    sourceHashes[filename] = createHash('sha256').update(await fs.readFile(path.join(projectRoot, filename))).digest('hex')
  }
  const report = {
    auditDate: '2026-10-25',
    command: 'node audit/benchmark-search-after-2026-10-25.mjs',
    implementation: 'Module produit src/services/pictograms.ts construit par Vite en bibliothèque ESM avec write:false, puis importé depuis un répertoire temporaire.',
    environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model },
    sourceHashes,
    index: { entries: catalog.length, bytes: indexBytes.length, simulatedFetchRequests: indexRequests },
    terms,
    searchesPerRun,
    runs,
    buildMs,
    firstIndexAndSearchMs,
    compatibilityAndWarmupMs,
    compatibility,
    productWarmCache,
    previousAlgorithm,
    medianWarmCacheSpeedup: previousAlgorithm.medianMs / productWarmCache.medianMs,
    limitations: [
      'Mesure CPU isolée dans Node ; React, rendu, images et latence réseau sont exclus.',
      'Le premier appel comprend le décodage JSON, la préparation de l’index et la première recherche ; la durée de construction Vite est rapportée séparément.',
      'Les dix termes sont amorcés avant les séries de mesure : les séries produit mesurent le cache de résultats chaud et la copie défensive des résultats.',
      'L’ancienne implémentation n’avait pas de cache de résultats ; son coût est remesuré ici sur les mêmes entrées.',
      'L’équivalence est vérifiée sur dix termes, pas sur toutes les requêtes possibles.',
      'Le gain mesuré ne prédit pas directement la latence réelle sur tablette ni les recherches inédites.',
    ],
  }
  await fs.writeFile(new URL('./benchmark-search-after-2026-10-25.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  globalThis.fetch = originalFetch
  await fs.rm(temporaryDirectory, { recursive: true, force: true })
}
