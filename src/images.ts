import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

export class ImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageError'
  }
}

export interface ImagePart {
  blob: Blob
  filename: string
}

export interface ResolvedImages {
  parts: ImagePart[]
  cleanup: () => Promise<void>
}

const isUrl = (s: string) => /^https?:\/\//i.test(s)

async function fromUrl(url: string, fetchImpl: typeof fetch): Promise<ImagePart> {
  let res: Awaited<ReturnType<typeof fetch>>
  try {
    res = await fetchImpl(url)
  } catch (e) {
    throw new ImageError(`Failed to download image: ${url}`)
  }
  if (!res.ok) {
    throw new ImageError(`Image URL returned ${res.status}: ${url}`)
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    throw new ImageError(`URL is not an image (content-type ${contentType || 'unknown'}): ${url}`)
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  const name = basename(new URL(url).pathname) || 'image'
  return { blob: new Blob([buf], { type: contentType }), filename: name }
}

async function fromPath(path: string): Promise<ImagePart> {
  let buf: Buffer
  try {
    buf = await readFile(path)
  } catch (e) {
    throw new ImageError(`Cannot read local image file: ${path}`)
  }
  return { blob: new Blob([buf]), filename: basename(path) }
}

export async function resolveImages(
  images: string[],
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<ResolvedImages> {
  const parts: ImagePart[] = []
  for (const image of images) {
    parts.push(isUrl(image) ? await fromUrl(image, fetchImpl) : await fromPath(image))
  }
  return { parts, cleanup: async () => {} }
}
