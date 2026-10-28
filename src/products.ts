import type { BagistoClient } from './bagisto-client.js'
import { getDefaults } from './discovery.js'
import { resolveImages } from './images.js'

export interface ProductInput {
  type?: string
  attributeFamilyId: number
  sku: string
  name: string
  urlKey: string
  shortDescription: string
  description: string
  price: number
  weight?: number
  status?: boolean
  visibleIndividually?: boolean
  attributes?: Record<string, string | number>
  categories?: number[]
  inventory?: number
  channels?: number[]
  images?: string[]
  locale?: string
  channel?: number
}

interface Scope {
  locale: string
  channelCode: string
  channelIds: number[]
  inventorySourceId: number
}

async function resolveScope(client: BagistoClient, input: ProductInput): Promise<Scope> {
  const d = await getDefaults(client)
  const channelIds = input.channels && input.channels.length > 0 ? input.channels : [input.channel ?? d.channel]
  return {
    locale: input.locale ?? d.locale,
    channelCode: d.channelCode,
    channelIds,
    inventorySourceId: d.inventorySourceId,
  }
}

async function buildForm(input: ProductInput, scope: Scope): Promise<{ form: FormData; cleanup: () => Promise<void> }> {
  const form = new FormData()
  form.append('_method', 'PUT')
  form.append('sku', input.sku)
  form.append('product_number', input.sku)
  form.append('name', input.name)
  form.append('url_key', input.urlKey)
  form.append('short_description', input.shortDescription)
  form.append('description', input.description)
  form.append('price', String(input.price))
  if (input.weight !== undefined) form.append('weight', String(input.weight))
  form.append('status', input.status === false ? '0' : '1')
  form.append('visible_individually', input.visibleIndividually === false ? '0' : '1')
  form.append('locale', scope.locale)
  form.append('channel', scope.channelCode)
  for (const ch of scope.channelIds) form.append('channels[]', String(ch))
  for (const [code, value] of Object.entries(input.attributes ?? {})) {
    form.append(code, String(value))
  }
  for (const cat of input.categories ?? []) form.append('categories[]', String(cat))
  if (input.inventory !== undefined) form.append(`inventories[${scope.inventorySourceId}]`, String(input.inventory))

  const { parts, cleanup } = await resolveImages(input.images ?? [])
  parts.forEach((p, i) => form.append(`images[files][${i}]`, p.blob, p.filename))
  return { form, cleanup }
}

export async function updateProduct(
  client: BagistoClient,
  id: number,
  input: ProductInput
): Promise<{ id: number; urlKey: string }> {
  const scope = await resolveScope(client, input)
  const { form, cleanup } = await buildForm(input, scope)
  try {
    await client.request('POST', `/api/v1/admin/catalog/products/${id}`, { form })
  } finally {
    await cleanup()
  }
  return { id, urlKey: input.urlKey }
}

export interface ProductSummary {
  id: number
  sku: string
  name: string
  price: number
  status: boolean
  urlKey: string
}

function toSummary(r: any): ProductSummary {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name ?? '',
    price: Number(r.price ?? 0),
    status: Boolean(r.status),
    urlKey: r.url_key ?? '',
  }
}

export async function listProducts(
  client: BagistoClient,
  query?: Record<string, string | number>
): Promise<ProductSummary[]> {
  const rows = await client.request<any[]>('GET', '/api/v1/admin/catalog/products', { query })
  return rows.map(toSummary)
}

export async function getProduct(client: BagistoClient, idOrSku: number | string): Promise<ProductSummary> {
  if (typeof idOrSku === 'number') {
    const row = await client.request<any>('GET', `/api/v1/admin/catalog/products/${idOrSku}`)
    return toSummary(row)
  }
  const matches = (await listProducts(client)).filter((p) => p.sku === idOrSku)
  if (matches.length === 0) {
    throw new Error(`No product found with sku '${idOrSku}'.`)
  }
  return matches[0]
}

export async function createProduct(
  client: BagistoClient,
  input: ProductInput
): Promise<{ id: number; urlKey: string }> {
  const type = input.type ?? 'simple'
  if (type !== 'simple') {
    throw new Error(`v1 supports only 'simple' products; received '${type}'.`)
  }

  const created = await client.request<{ id: number }>('POST', '/api/v1/admin/catalog/products', {
    json: { type: 'simple', attribute_family_id: input.attributeFamilyId, sku: input.sku },
  })
  const id = created.id

  try {
    await updateProduct(client, id, input)
  } catch (e) {
    try {
      await client.request('DELETE', `/api/v1/admin/catalog/products/${id}`)
    } catch {
      void 0
    }
    throw e
  }

  return { id, urlKey: input.urlKey }
}
