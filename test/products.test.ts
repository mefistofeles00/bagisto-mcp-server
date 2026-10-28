import { describe, test, expect } from 'vitest'
import { createProduct, updateProduct, getProduct, listProducts, type ProductInput } from '../src/products.js'
import { ValidationError } from '../src/bagisto-client.js'

interface Call { method: string; path: string; json?: unknown; form?: FormData }

function recordingClient(opts: { responses?: Record<string, unknown>; throwOn?: Record<string, Error> } = {}) {
  const calls: Call[] = []
  const client = {
    calls,
    request: async (method: string, path: string, o: any = {}) => {
      calls.push({ method, path, json: o.json, form: o.form })
      const key = `${method} ${path}`
      if (opts.throwOn?.[key]) throw opts.throwOn[key]
      return opts.responses?.[key] ?? {}
    },
  }
  return client as any
}

const base: ProductInput = {
  attributeFamilyId: 1,
  sku: 'SK-1',
  name: 'Kolye',
  urlKey: 'kolye',
  shortDescription: '<p>kısa</p>',
  description: '<p>uzun</p>',
  price: 1000,
  locale: 'tr',
  channels: [1],
}

describe('createProduct', () => {
  test('rejects a non-simple type before making any call', async () => {
    const c = recordingClient()
    await expect(createProduct(c, { ...base, type: 'configurable' })).rejects.toThrow(/simple/)
    expect(c.calls).toHaveLength(0)
  })

  test('stores a skeleton then PUTs fields, attributes and locale', async () => {
    const c = recordingClient({
      responses: {
        'POST /api/v1/admin/catalog/products': { id: 31 },
        'POST /api/v1/admin/catalog/products/31': { id: 31, url_key: 'kolye' },
      },
    })
    await createProduct(c, { ...base, attributes: { ayar: 12 }, categories: [3], inventory: 20 })
    expect(c.calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/admin/catalog/products',
      json: { type: 'simple', attribute_family_id: 1, sku: 'SK-1' },
    })
    const form: FormData = c.calls[1].form
    expect(c.calls[1].path).toBe('/api/v1/admin/catalog/products/31')
    expect(form.get('_method')).toBe('PUT')
    expect(form.get('name')).toBe('Kolye')
    expect(form.get('ayar')).toBe('12')
    expect(form.get('locale')).toBe('tr')
    expect(form.getAll('categories[]')).toEqual(['3'])
    expect(form.getAll('channels[]')).toEqual(['1'])
  })

  test('defaults locale and channel from the store when omitted', async () => {
    const c = recordingClient({
      responses: {
        'GET /api/v1/admin/settings/channels': [{ id: 1, code: 'default', name: 'D', default_locale: { code: 'tr' } }],
        'POST /api/v1/admin/catalog/products': { id: 31 },
        'POST /api/v1/admin/catalog/products/31': { id: 31 },
      },
    })
    const { locale, channels, ...noScope } = base
    await createProduct(c, noScope)
    const form: FormData = c.calls.at(-1)!.form
    expect(form.get('locale')).toBe('tr')
    expect(form.getAll('channels[]')).toEqual(['1'])
  })

  test('sends an HTML description as a literal multipart string', async () => {
    const c = recordingClient({
      responses: {
        'POST /api/v1/admin/catalog/products': { id: 31 },
        'POST /api/v1/admin/catalog/products/31': { id: 31 },
      },
    })
    await createProduct(c, { ...base, description: '<p>el emeği</p>' })
    const form: FormData = c.calls[1].form
    expect(form.get('description')).toBe('<p>el emeği</p>')
  })

  test('rolls back the skeleton and rethrows when the update fails', async () => {
    const c = recordingClient({
      responses: { 'POST /api/v1/admin/catalog/products': { id: 31 } },
      throwOn: { 'POST /api/v1/admin/catalog/products/31': new ValidationError('bad', { description: ['required'] }) },
    })
    await expect(createProduct(c, base)).rejects.toBeInstanceOf(ValidationError)
    expect(c.calls.some((x) => x.method === 'DELETE' && x.path === '/api/v1/admin/catalog/products/31')).toBe(true)
  })
})

describe('updateProduct', () => {
  test('writes a second locale without storing a new product', async () => {
    const c = recordingClient({ responses: { 'POST /api/v1/admin/catalog/products/31': { id: 31 } } })
    await updateProduct(c, 31, { ...base, locale: 'en' })
    expect(c.calls.some((x) => x.path === '/api/v1/admin/catalog/products' && x.method === 'POST')).toBe(false)
    const form: FormData = c.calls[0].form
    expect(form.get('locale')).toBe('en')
  })
})

describe('verify tools', () => {
  test('listProducts maps rows to summaries', async () => {
    const c = recordingClient({
      responses: {
        'GET /api/v1/admin/catalog/products': [
          { id: 31, sku: 'SK-1', name: 'Kolye', price: '1000.0000', status: 1, url_key: 'kolye' },
        ],
      },
    })
    expect(await listProducts(c)).toEqual([
      { id: 31, sku: 'SK-1', name: 'Kolye', price: 1000, status: true, urlKey: 'kolye' },
    ])
  })

  test('getProduct by numeric id fetches the product resource', async () => {
    const c = recordingClient({
      responses: {
        'GET /api/v1/admin/catalog/products/31': { id: 31, sku: 'SK-1', name: 'Kolye', price: '1000.0000', status: 1, url_key: 'kolye' },
      },
    })
    expect(await getProduct(c, 31)).toEqual({ id: 31, sku: 'SK-1', name: 'Kolye', price: 1000, status: true, urlKey: 'kolye' })
  })

  test('getProduct by sku filters the product list', async () => {
    const c = recordingClient({
      responses: {
        'GET /api/v1/admin/catalog/products': [
          { id: 30, sku: 'SK-0', name: 'A', price: '1', status: 1, url_key: 'a' },
          { id: 31, sku: 'SK-1', name: 'Kolye', price: '1000', status: 1, url_key: 'kolye' },
        ],
      },
    })
    expect(await getProduct(c, 'SK-1')).toMatchObject({ id: 31, sku: 'SK-1' })
  })
})
