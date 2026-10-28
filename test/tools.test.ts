import { describe, test, expect } from 'vitest'
import { buildTools } from '../src/tools.js'
import { buildServer } from '../src/server.js'
import { ValidationError } from '../src/bagisto-client.js'

function stubClient(opts: { responses?: Record<string, unknown>; throwOn?: Record<string, Error> } = {}) {
  return {
    request: async (method: string, path: string) => {
      const key = `${method} ${path}`
      if (opts.throwOn?.[key]) throw opts.throwOn[key]
      return opts.responses?.[key] ?? {}
    },
  } as any
}

const ALL_TOOLS = [
  'list_attribute_families',
  'list_attributes',
  'list_categories',
  'list_locales',
  'list_channels',
  'create_product',
  'update_product',
  'get_product',
  'list_products',
]

describe('buildTools', () => {
  test('registers all nine tools', () => {
    const names = buildTools(stubClient()).map((t) => t.name)
    expect(names.sort()).toEqual([...ALL_TOOLS].sort())
  })

  test('a discovery tool routes to the client and returns ok content', async () => {
    const client = stubClient({
      responses: { 'GET /api/v1/admin/catalog/categories': [{ id: 3, name: 'Kolye', slug: 'kolye' }] },
    })
    const tool = buildTools(client).find((t) => t.name === 'list_categories')!
    const res = await tool.handler({})
    expect(res.isError).toBeFalsy()
    expect(res.content[0].text).toContain('kolye')
  })

  test('create_product surfaces a ValidationError as a readable error result', async () => {
    const client = stubClient({
      responses: { 'POST /api/v1/admin/catalog/products': { id: 31 } },
      throwOn: { 'POST /api/v1/admin/catalog/products/31': new ValidationError('bad', { description: ['description is required'] }) },
    })
    const tool = buildTools(client).find((t) => t.name === 'create_product')!
    const res = await tool.handler({
      attributeFamilyId: 1,
      sku: 'SK-1',
      name: 'Kolye',
      urlKey: 'kolye',
      shortDescription: 'x',
      description: '',
      price: 10,
      locale: 'tr',
      channels: [1],
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('description is required')
  })
})

describe('buildServer', () => {
  test('constructs without throwing', () => {
    expect(() => buildServer(stubClient())).not.toThrow()
  })
})
