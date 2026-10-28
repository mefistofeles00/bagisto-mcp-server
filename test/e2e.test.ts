import { describe, test, expect, beforeAll } from 'vitest'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.js'
import { BagistoClient } from '../src/bagisto-client.js'
import { listAttributeFamilies, listAttributes, listCategories } from '../src/discovery.js'
import { createProduct, getProduct } from '../src/products.js'

const live = Boolean(process.env.BAGISTO_URL)

describe.skipIf(!live)('e2e against a live Bagisto', () => {
  let client: BagistoClient

  beforeAll(() => {
    client = new BagistoClient(loadConfig(process.env))
  })

  test('creates a simple product with an attribute + image and it is visible', async () => {
    const [families, attrs, cats] = await Promise.all([
      listAttributeFamilies(client),
      listAttributes(client),
      listCategories(client),
    ])
    const select = attrs.find((a) => a.type === 'select' && a.options.length > 0)

    const dir = await mkdtemp(join(tmpdir(), 'e2e-'))
    const img = join(dir, 'e2e.png')
    await writeFile(img, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

    const sku = `E2E-${Date.now()}`
    const { id } = await createProduct(client, {
      attributeFamilyId: families[0].id,
      sku,
      name: 'E2E Test',
      urlKey: sku.toLowerCase(),
      shortDescription: '<p>e2e</p>',
      description: '<p>e2e</p>',
      price: 1234,
      attributes: select ? { [select.code]: select.options[0].id } : {},
      categories: cats[0] ? [cats[0].id] : [],
      inventory: 5,
      images: [img],
    })

    const prod = await getProduct(client, id)
    expect(prod.name).toBe('E2E Test')
    expect(prod.price).toBe(1234)
    expect(prod.status).toBe(true)

    await client.request('DELETE', `/api/v1/admin/catalog/products/${id}`)
  })
})
