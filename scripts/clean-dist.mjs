import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Finder can recreate .DS_Store while a large generated directory is removed.
// Node retries ENOTEMPTY/EBUSY here; Vite's default synchronous cleanup does not.
const output = fileURLToPath(new URL('../dist', import.meta.url))
rmSync(output, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
