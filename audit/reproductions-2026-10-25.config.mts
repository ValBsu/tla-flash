import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Exécution volontaire des preuves d'audit, séparée de la suite habituelle.
// Une assertion réussie confirme ici le défaut observé dans la version auditée.
export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  test: {
    environment: 'jsdom',
    include: ['audit/*-2026-10-25.repro.tsx'],
  },
})
