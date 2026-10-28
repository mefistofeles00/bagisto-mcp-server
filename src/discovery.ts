import type { BagistoClient } from './bagisto-client.js'

export interface AttributeFamily {
  id: number
  code: string
  name: string
}

export interface AttributeOption {
  id: number
  label: string
}

export interface Attribute {
  id: number
  code: string
  type: string
  isRequired: boolean
  options: AttributeOption[]
}

export interface Category {
  id: number
  name: string
  slug: string
}

export interface Locale {
  code: string
  name: string
}

export interface Channel {
  id: number
  code: string
  name: string
  defaultLocale: string
}

export async function listAttributeFamilies(client: BagistoClient): Promise<AttributeFamily[]> {
  const rows = await client.request<any[]>('GET', '/api/v1/admin/catalog/attribute-families')
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name ?? r.admin_name ?? '' }))
}

export async function listAttributes(client: BagistoClient): Promise<Attribute[]> {
  const rows = await client.request<any[]>('GET', '/api/v1/admin/catalog/attributes')
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    type: r.type,
    isRequired: Boolean(r.is_required),
    options: (r.options ?? []).map((o: any) => ({ id: o.id, label: o.label ?? o.admin_name ?? '' })),
  }))
}

export async function listCategories(client: BagistoClient): Promise<Category[]> {
  const rows = await client.request<any[]>('GET', '/api/v1/admin/catalog/categories')
  return rows.map((r) => ({ id: r.id, name: r.name ?? '', slug: r.slug ?? '' }))
}

export async function listLocales(client: BagistoClient): Promise<Locale[]> {
  const rows = await client.request<any[]>('GET', '/api/v1/admin/settings/locales')
  return rows.map((r) => ({ code: r.code, name: r.name ?? r.code }))
}

export async function listChannels(client: BagistoClient): Promise<Channel[]> {
  const rows = await client.request<any[]>('GET', '/api/v1/admin/settings/channels')
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name ?? r.code,
    defaultLocale: r.default_locale?.code ?? r.default_locale_code ?? '',
  }))
}

export async function getDefaults(client: BagistoClient): Promise<{ locale: string; channel: number }> {
  const channels = await listChannels(client)
  if (channels.length === 0) {
    throw new Error('No channels found on the store.')
  }
  return { locale: channels[0].defaultLocale, channel: channels[0].id }
}
