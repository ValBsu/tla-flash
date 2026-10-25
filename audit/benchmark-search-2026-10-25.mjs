/**
 * Benchmark de recherche Sclera, sans modification du code applicatif.
 * Exécution depuis n'importe quel dossier : node audit/benchmark-search-2026-10-25.mjs
 * Le benchmark reproduit searchBank puis compare une préparation unique de l'index.
 * Mesure CPU Node sur cette machine ; ce n'est pas une mesure navigateur/tablette.
 */
import fs from 'node:fs'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { gzipSync } from 'node:zlib'

const indexBytes = fs.readFileSync(new URL('../public/pictograms/sclera/index.json', import.meta.url))
const index = JSON.parse(indexBytes.toString())
const terms = ['manger', 'boire', 'école', 'aller', 'je', 'ordinateur', 'maison', 'jouer', 'travail', 'chat']
const normalize = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').replace(/[^a-z0-9]+/g, ' ').trim()

const originalSearch = (term) => {
  const query = normalize(term)
  const words = query.split(' ')
  return index.map((entry) => ({ ...entry, normalized: normalize([entry.label, ...(entry.keywords ?? [])].join(' ')) }))
    .filter((entry) => words.every((word) => entry.normalized.split(' ').includes(word)))
    .sort((a, b) => Number(normalize(a.label) !== query) - Number(normalize(b.label) !== query) || a.label.length - b.label.length || a.id - b.id)
    .slice(0, 12).map(({ id }) => id)
}

const prepareStarted = performance.now()
const preparedIndex = index.map((entry) => ({
  ...entry,
  normalizedLabel: normalize(entry.label),
  tokens: normalize([entry.label, ...(entry.keywords ?? [])].join(' ')).split(' '),
}))
const preparationMs = performance.now() - prepareStarted

const preparedSearch = (term) => {
  const query = normalize(term)
  const words = query.split(' ')
  return preparedIndex.filter((entry) => words.every((word) => entry.tokens.includes(word)))
    .sort((a, b) => Number(a.normalizedLabel !== query) - Number(b.normalizedLabel !== query) || a.label.length - b.label.length || a.id - b.id)
    .slice(0, 12).map(({ id }) => id)
}

const searchesPerRun = 150
const runs = 5
const measure = (search) => {
  const durationsMs = []
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now()
    for (let position = 0; position < searchesPerRun; position += 1) search(terms[position % terms.length])
    durationsMs.push(performance.now() - started)
  }
  const sorted = [...durationsMs].sort((a, b) => a - b)
  return { durationsMs, medianMs: sorted[Math.floor(sorted.length / 2)], minMs: sorted[0], maxMs: sorted.at(-1) }
}

const equivalentOnTerms = terms.every((term) => JSON.stringify(originalSearch(term)) === JSON.stringify(preparedSearch(term)))
const original = measure(originalSearch)
const prepared = measure(preparedSearch)
const report = {
  auditDate: '2026-10-25',
  command: 'node audit/benchmark-search-2026-10-25.mjs',
  scope: 'CPU Node uniquement : transformation, filtrage et tri de l’index Sclera local. Réseau, React, rendu et images exclus.',
  environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model },
  source: 'src/services/pictograms.ts:22-25',
  index: { entries: index.length, bytes: indexBytes.length, gzipBytes: gzipSync(indexBytes).length },
  terms,
  searchesPerRun,
  runs,
  equivalentOnTerms,
  preparationMs,
  original,
  prepared,
  medianSpeedup: original.medianMs / prepared.medianMs,
  limitations: [
    'Le prototype préparé est isolé dans ce script ; il n’est pas intégré à l’application.',
    'L’équivalence a été vérifiée uniquement sur les dix termes indiqués.',
    'Les mêmes termes sont répétés pour simuler 150 cases ; le code actuel ne déduplique pas les recherches.',
    'Les temps peuvent varier selon la machine, sa charge et le moteur JavaScript.',
    'Ce résultat ne prédit pas directement la latence réelle sur tablette.',
  ],
}
fs.writeFileSync(new URL('./benchmark-search-2026-10-25.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
