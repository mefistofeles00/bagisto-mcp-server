import { describe, test, expect } from 'vitest'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { resolveImages, ImageError } from '../src/images.js'

async function tempPng(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'img-test-'))
  const p = join(dir, 'ring.png')
  await writeFile(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return p
}

function fakeFetch(res: { ok: boolean; status: number; contentType?: string; bytes?: Uint8Array }) {
  return async (): Promise<any> => ({
    ok: res.ok,
    status: res.status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? res.contentType ?? null : null) },
    arrayBuffer: async () => (res.bytes ?? new Uint8Array()).buffer,
  })
}

describe('resolveImages', () => {
  test('local path becomes a part with its basename', async () => {
    const p = await tempPng()
    const { parts, cleanup } = await resolveImages([p])
    expect(parts).toHaveLength(1)
    expect(parts[0].filename).toBe(basename(p))
    expect(parts[0].blob.size).toBe(8)
    await cleanup()
  })

  test('http url is downloaded into a part', async () => {
    const fake = fakeFetch({ ok: true, status: 200, contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]) })
    const { parts, cleanup } = await resolveImages(['https://x.test/a.png'], fake as any)
    expect(parts).toHaveLength(1)
    expect(parts[0].blob.size).toBe(3)
    expect(parts[0].filename).toBe('a.png')
    await cleanup()
  })

  test('bad url (404) throws ImageError', async () => {
    const fake = fakeFetch({ ok: false, status: 404 })
    await expect(resolveImages(['https://x.test/missing.png'], fake as any)).rejects.toBeInstanceOf(ImageError)
  })

  test('non-image content-type throws ImageError', async () => {
    const fake = fakeFetch({ ok: true, status: 200, contentType: 'text/html', bytes: new Uint8Array([1]) })
    await expect(resolveImages(['https://x.test/page'], fake as any)).rejects.toBeInstanceOf(ImageError)
  })

  test('cleanup is callable with no images', async () => {
    const { parts, cleanup } = await resolveImages([])
    expect(parts).toEqual([])
    await expect(cleanup()).resolves.toBeUndefined()
  })
})
