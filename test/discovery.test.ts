import { describe, test, expect } from 'vitest'
import {
  listAttributeFamilies,
  listAttributes,
  listCategories,
  listLocales,
  listChannels,
  getDefaults,
} from '../src/discovery.js'

function stubClient(byPath: Record<string, unknown>) {
  return {
    request: async <T>(_method: string, path: string): Promise<T> => {
      if (!(path in byPath)) throw new Error(`no stub for ${path}`)
      return byPath[path] as T
    },
  } as any
}

describe('discovery', () => {
  test('listAttributeFamilies maps id/code/name', async () => {
    const c = stubClient({ '/api/v1/admin/catalog/attribute-families': [{ id: 1, code: 'default', name: 'Default' }] })
    expect(await listAttributeFamilies(c)).toEqual([{ id: 1, code: 'default', name: 'Default' }])
  })

  test('listAttributes surfaces isRequired and select options (id→label)', async () => {
    const c = stubClient({
      '/api/v1/admin/catalog/attributes': [
        {
          id: 25,
          code: 'ayar',
          type: 'select',
          is_required: 1,
          options: [
            { id: 12, admin_name: '22 Ayar', label: '22 Ayar' },
            { id: 11, admin_name: '18 Ayar', label: null },
          ],
        },
        { id: 2, code: 'sku', type: 'text', is_required: 1, options: [] },
      ],
    })
    const attrs = await listAttributes(c)
    expect(attrs[0]).toEqual({
      id: 25,
      code: 'ayar',
      type: 'select',
      isRequired: true,
      options: [
        { id: 12, label: '22 Ayar' },
        { id: 11, label: '18 Ayar' },
      ],
    })
    expect(attrs[1].options).toEqual([])
  })

  test('listCategories maps id/name/slug', async () => {
    const c = stubClient({ '/api/v1/admin/catalog/categories': [{ id: 3, name: 'Kolye', slug: 'kolye' }] })
    expect(await listCategories(c)).toEqual([{ id: 3, name: 'Kolye', slug: 'kolye' }])
  })

  test('listLocales maps code/name', async () => {
    const c = stubClient({ '/api/v1/admin/settings/locales': [{ id: 1, code: 'tr', name: 'Turkish' }] })
    expect(await listLocales(c)).toEqual([{ code: 'tr', name: 'Turkish' }])
  })

  test('listChannels maps id/code/name/defaultLocale', async () => {
    const c = stubClient({
      '/api/v1/admin/settings/channels': [{ id: 1, code: 'default', name: 'Default', default_locale: { code: 'tr' } }],
    })
    expect(await listChannels(c)).toEqual([{ id: 1, code: 'default', name: 'Default', defaultLocale: 'tr' }])
  })

  test('getDefaults returns the first channel id and its default locale', async () => {
    const c = stubClient({
      '/api/v1/admin/settings/channels': [{ id: 1, code: 'default', name: 'Default', default_locale: { code: 'tr' } }],
    })
    expect(await getDefaults(c)).toEqual({ locale: 'tr', channel: 1 })
  })
})
