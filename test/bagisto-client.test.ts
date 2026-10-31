import { describe, test, expect } from 'vitest'
import { BagistoClient, AuthError, ValidationError } from '../src/bagisto-client.js'

type CannedResponse = { status: number; body: unknown }
interface RecordedCall { url: string; method: string; headers: Record<string, string>; body: unknown }

function fakeFetch(calls: RecordedCall[], routes: Record<string, CannedResponse | CannedResponse[]>) {
  const cursors: Record<string, number> = {}
  return async (input: any, init: any = {}): Promise<any> => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const pathname = new URL(url).pathname
    const key = `${method} ${pathname}`
    calls.push({ url, method, headers: init.headers ?? {}, body: init.body })
    const entry = routes[key]
    if (entry === undefined) throw new Error(`no route for ${key}`)
    let res: CannedResponse
    if (Array.isArray(entry)) {
      const i = cursors[key] ?? 0
      res = entry[Math.min(i, entry.length - 1)]
      cursors[key] = i + 1
    } else {
      res = entry
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body,
      text: async () => JSON.stringify(res.body),
    }
  }
}

describe('BagistoClient', () => {
  test('logs in with credentials and sends Bearer token', async () => {
    const calls: RecordedCall[] = []
    const fake = fakeFetch(calls, {
      'POST /api/v1/admin/login': { status: 200, body: { data: { token: 'tok123' } } },
      'GET /api/v1/admin/catalog/categories': { status: 200, body: { data: [] } },
    })
    const c = new BagistoClient({ baseUrl: 'https://s.test', auth: { email: 'a@b.c', password: 'p' } }, fake as any)
    await c.request('GET', '/api/v1/admin/catalog/categories')
    expect(calls.at(-1)!.headers.Authorization).toBe('Bearer tok123')
  })

  test('login sends device_name so the token endpoint accepts a non-stateful client', async () => {
    const calls: RecordedCall[] = []
    const fake = fakeFetch(calls, {
      'POST /api/v1/admin/login': { status: 200, body: { token: 'tok123' } },
      'GET /api/v1/admin/catalog/categories': { status: 200, body: { data: [] } },
    })
    const c = new BagistoClient({ baseUrl: 'https://s.test', auth: { email: 'a@b.c', password: 'p' } }, fake as any)
    await c.request('GET', '/api/v1/admin/catalog/categories')
    const loginCall = calls.find((x) => new URL(x.url).pathname === '/api/v1/admin/login')!
    expect(JSON.parse(String(loginCall.body)).device_name).toBeTruthy()
  })

  test('uses a provided token without calling login', async () => {
    const calls: RecordedCall[] = []
    const fake = fakeFetch(calls, {
      'GET /api/v1/admin/catalog/categories': { status: 200, body: { data: [] } },
    })
    const c = new BagistoClient({ baseUrl: 'https://s.test', auth: { token: 't' } }, fake as any)
    await c.request('GET', '/api/v1/admin/catalog/categories')
    expect(calls.map((x) => `${x.method} ${new URL(x.url).pathname}`)).not.toContain('POST /api/v1/admin/login')
    expect(calls.at(-1)!.headers.Authorization).toBe('Bearer t')
  })

  test('returns the parsed data field', async () => {
    const fake = fakeFetch([], {
      'GET /api/v1/admin/catalog/categories': { status: 200, body: { data: [{ id: 1 }] } },
    })
    const c = new BagistoClient({ baseUrl: 'https://s.test', auth: { token: 't' } }, fake as any)
    const data = await c.request<{ id: number }[]>('GET', '/api/v1/admin/catalog/categories')
    expect(data).toEqual([{ id: 1 }])
  })

  test('maps 422 to ValidationError with fields', async () => {
    const fake = fakeFetch([], {
      'POST /api/v1/admin/catalog/products': {
        status: 422,
        body: { message: 'The given data was invalid.', errors: { description: ['description is required'] } },
      },
    })
    const c = new BagistoClient({ baseUrl: 'https://s.test', auth: { token: 't' } }, fake as any)
    await expect(c.request('POST', '/api/v1/admin/catalog/products', { json: {} })).rejects.toMatchObject({
      name: 'ValidationError',
      fields: { description: ['description is required'] },
    })
  })

  test('on 401 with credentials, re-logs in once and retries', async () => {
    const calls: RecordedCall[] = []
    const fake = fakeFetch(calls, {
      'POST /api/v1/admin/login': [
        { status: 200, body: { data: { token: 'old' } } },
        { status: 200, body: { data: { token: 'new' } } },
      ],
      'GET /api/v1/admin/catalog/products': [
        { status: 401, body: { message: 'Unauthenticated.' } },
        { status: 200, body: { data: [] } },
      ],
    })
    const c = new BagistoClient({ baseUrl: 'https://s.test', auth: { email: 'a@b.c', password: 'p' } }, fake as any)
    await c.request('GET', '/api/v1/admin/catalog/products')
    const logins = calls.filter((x) => new URL(x.url).pathname === '/api/v1/admin/login')
    expect(logins).toHaveLength(2)
    expect(calls.at(-1)!.headers.Authorization).toBe('Bearer new')
  })

  test('on 401 with only a token, throws AuthError without retry', async () => {
    const calls: RecordedCall[] = []
    const fake = fakeFetch(calls, {
      'GET /api/v1/admin/catalog/products': { status: 401, body: { message: 'Unauthenticated.' } },
    })
    const c = new BagistoClient({ baseUrl: 'https://s.test', auth: { token: 't' } }, fake as any)
    await expect(c.request('GET', '/api/v1/admin/catalog/products')).rejects.toBeInstanceOf(AuthError)
    expect(calls.filter((x) => new URL(x.url).pathname === '/api/v1/admin/catalog/products')).toHaveLength(1)
  })

  test('a 500 error surfaces the server-provided message for debugging', async () => {
    const fake = fakeFetch([], {
      'GET /api/v1/admin/catalog/products': { status: 500, body: { message: 'Call to a member function on null' } },
    })
    const c = new BagistoClient({ baseUrl: 'https://s.test', auth: { token: 't' } }, fake as any)
    const err = await c.request('GET', '/api/v1/admin/catalog/products').catch((e) => e)
    expect(err.message).toContain('500')
    expect(err.message).toContain('Call to a member function on null')
  })

  test('never includes the password or token in a thrown error', async () => {
    const fake = fakeFetch([], {
      'POST /api/v1/admin/login': { status: 401, body: { message: 'Invalid credentials.' } },
    })
    const c = new BagistoClient({ baseUrl: 'https://s.test', auth: { email: 'a@b.c', password: 'sup3rsecret' } }, fake as any)
    const err = await c.request('GET', '/api/v1/admin/catalog/products').catch((e) => e)
    const dump = `${err.name} ${err.message} ${err.stack ?? ''}`
    expect(dump).not.toContain('sup3rsecret')
  })
})
