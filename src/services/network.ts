const DEFAULT_TIMEOUT = 15_000

export const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError'

/** Cancel one consumer without cancelling a shared request (for example an index load). */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function request<T>(input: RequestInfo | URL, read: (response: Response) => Promise<T>, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT): Promise<T> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Le service a mis trop de temps à répondre.', 'TimeoutError')), timeoutMs)
  try {
    return await abortable(fetch(input, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Service indisponible (${response.status}).`)
      return read(response)
    }), controller.signal)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export const fetchJson = (input: RequestInfo | URL, signal?: AbortSignal, timeoutMs?: number): Promise<unknown> => request(input, (response) => response.json(), signal, timeoutMs)

/** Includes body download in the deadline, so a stalled body cannot block an operation. */
export const fetchWithTimeout = (input: RequestInfo | URL, signal?: AbortSignal, timeoutMs?: number): Promise<Response> => request(input, async (response) => {
  await response.clone().arrayBuffer()
  return response
}, signal, timeoutMs)

/** Preserve input order, cap network concurrency and cancel the remaining work on failure. */
export async function mapConcurrent<T, R>(items: readonly T[], worker: (item: T, index: number, signal: AbortSignal) => Promise<R>, signal?: AbortSignal, concurrency = 4): Promise<R[]> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const results = new Array<R>(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      controller.signal.throwIfAborted()
      const index = next++
      results[index] = await abortable(worker(items[index], index, controller.signal), controller.signal)
    }
  }
  try {
    const limit = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 4
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
    signal?.throwIfAborted()
    return results
  } catch (error) {
    controller.abort(error)
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
