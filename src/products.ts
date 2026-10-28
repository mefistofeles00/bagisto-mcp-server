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
  channels: number[]
}

async function resolveScope(client: BagistoClient, input: ProductInput): Promise<Scope> {
  if (input.locale && input.channels) {
    return { locale: input.locale, channels: input.channels }
  }
  const d = await getDefaults(client)
  return {
    locale: input.locale ?? d.locale,
    channels: input.channels ?? [input.channel ?? d.channel],
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
  for (const ch of scope.channels) form.append('channels[]', String(ch))
  for (const [code, value] of Object.entries(input.attributes ?? {})) {
    form.append(code, String(value))
  }
  for (const cat of input.categories ?? []) form.append('categories[]', String(cat))
  if (input.inventory !== undefined) form.append('inventories[1]', String(input.inventory))

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
