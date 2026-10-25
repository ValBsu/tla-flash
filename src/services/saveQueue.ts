import type { Board } from '../types'

type Waiting = { resolve: (board: Board) => void; reject: (error: unknown) => void }
type Entry = {
  revision: number
  pending?: { board: Board; waiting: Waiting[] }
  running?: Promise<void>
  error?: unknown
}

// One writer per board. Edits arriving during a write are coalesced into the
// latest snapshot, while the expected database revision advances in order.
export function createBoardSaveQueue(save: (board: Board) => Promise<Board>) {
  const entries = new Map<string, Entry>()
  const entryFor = (board: Board) => {
    let entry = entries.get(board.id)
    if (!entry) {
      entry = { revision: board.revision ?? 0 }
      entries.set(board.id, entry)
    }
    return entry
  }

  const run = (entry: Entry) => {
    if (entry.running || entry.error) return
    entry.running = (async () => {
      while (entry.pending && !entry.error) {
        const job = entry.pending
        entry.pending = undefined
        try {
          const saved = await save({ ...job.board, revision: entry.revision })
          // Older repository implementations/mocks may not return the value.
          const result = saved ?? job.board
          entry.revision = result.revision ?? entry.revision
          job.waiting.forEach(({ resolve }) => resolve(result))
        } catch (error) {
          entry.error = error
          job.waiting.forEach(({ reject }) => reject(error))
          const pending = entry.pending as Entry['pending']
          pending?.waiting.forEach(({ reject }) => reject(error))
          entry.pending = undefined
        }
      }
    })().finally(() => {
      entry.running = undefined
      if (entry.pending && !entry.error) run(entry)
    })
  }

  return {
    register(boards: Board[]) {
      for (const board of boards) {
        const entry = entries.get(board.id)
        if (!entry?.running && !entry?.pending) entries.set(board.id, { revision: board.revision ?? 0 })
      }
    },
    enqueue(board: Board): Promise<Board> {
      const entry = entryFor(board)
      if (entry.error) return Promise.reject(entry.error)
      const promise = new Promise<Board>((resolve, reject) => {
        const waiting = [...(entry.pending?.waiting ?? []), { resolve, reject }]
        entry.pending = { board, waiting }
      })
      run(entry)
      return promise
    },
    retry(board: Board): Promise<Board> {
      const entry = entryFor(board)
      entry.error = undefined
      return this.enqueue(board)
    },
    revision(id: string) { return entries.get(id)?.revision },
    isPending(id: string) { const entry = entries.get(id); return Boolean(entry?.running || entry?.pending) },
    async flush(id?: string) {
      const selected = id ? [entries.get(id)].filter((entry): entry is Entry => Boolean(entry)) : [...entries.values()]
      for (const entry of selected) {
        while (entry.running) await entry.running
        if (entry.error) throw entry.error
      }
    },
  }
}
