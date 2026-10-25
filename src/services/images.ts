const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_EDGE = 1600
const MAX_PIXELS = 50_000_000
const IMPORT_TIMEOUT_MS = 20_000
const supportedTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'])

const aborted = () => new DOMException('Import annulé.', 'AbortError')

const readFile = (file: File, signal?: AbortSignal): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  const cleanup = () => {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
    reader.onload = null
    reader.onerror = null
    reader.onabort = null
  }
  const fail = (error: Error) => { cleanup(); reject(error) }
  const onAbort = () => { fail(aborted()); reader.abort() }
  const timeout = setTimeout(() => { fail(new Error('La lecture de l’image a pris trop de temps. Réessayez.')); reader.abort() }, IMPORT_TIMEOUT_MS)
  reader.onload = () => {
    const result = reader.result
    if (typeof result !== 'string') { fail(new Error('Le fichier image est illisible.')); return }
    cleanup()
    resolve(result)
  }
  reader.onerror = () => fail(new Error('Le fichier image ne peut pas être lu.'))
  reader.onabort = () => fail(aborted())
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) { onAbort(); return }
  try { reader.readAsDataURL(file) } catch { fail(new Error('Le fichier image ne peut pas être lu.')) }
})

const decodeImage = (source: string, signal?: AbortSignal): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image()
  const cleanup = () => {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
    image.onload = null
    image.onerror = null
  }
  const fail = (error: Error) => { cleanup(); image.src = ''; reject(error) }
  const onAbort = () => fail(aborted())
  const timeout = setTimeout(() => fail(new Error('L’ouverture de l’image a pris trop de temps. Réessayez.')), IMPORT_TIMEOUT_MS)
  image.onload = () => { cleanup(); resolve(image) }
  image.onerror = () => fail(new Error('Cette image est illisible ou son format n’est pas pris en charge par ce navigateur.'))
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) { onAbort(); return }
  image.src = source
})

/** Rasterize imports before storing them so boards and their history stay small. */
export async function readImportedImage(file: File, signal?: AbortSignal): Promise<{ dataUrl: string; mime: string }> {
  if (signal?.aborted) throw aborted()
  const type = file.type.toLowerCase()
  if (!supportedTypes.has(type)) throw new Error('Choisissez une image PNG, JPEG, WebP, GIF, BMP ou AVIF.')
  if (!file.size) throw new Error('Le fichier image est vide.')
  if (file.size > MAX_FILE_BYTES) throw new Error('L’image est trop volumineuse. Choisissez un fichier de moins de 20 Mo.')
  const source = await readFile(file, signal)
  const image = await decodeImage(source, signal)
  if (signal?.aborted) throw aborted()
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height || width * height > MAX_PIXELS) throw new Error('Les dimensions de cette image sont trop grandes ou invalides. Réduisez-la avant de l’importer.')
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('La préparation des images est indisponible dans ce navigateur.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  let transparent = type === 'image/png' || type === 'image/gif'
  if (!transparent && type !== 'image/jpeg' && type !== 'image/jpg') {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) { transparent = true; break }
    }
  }
  if (signal?.aborted) throw aborted()
  const mime = transparent ? 'image/png' : 'image/jpeg'
  try {
    const dataUrl = canvas.toDataURL(mime, 0.88)
    if (!dataUrl.startsWith(`data:${mime};base64,`)) throw new Error('Image vide.')
    return { dataUrl, mime }
  } catch {
    throw new Error('L’image n’a pas pu être préparée. Choisissez un autre fichier.')
  }
}
