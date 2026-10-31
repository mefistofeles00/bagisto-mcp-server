import { describe, test, expect } from 'vitest'
import { loadConfig, ConfigError } from '../src/config.js'

describe('loadConfig', () => {
  test('reads url + token', () => {
    const c = loadConfig({ BAGISTO_URL: 'https://s.test', BAGISTO_ADMIN_TOKEN: 't' })
    expect(c).toEqual({ baseUrl: 'https://s.test', auth: { token: 't' } })
  })

  test('reads url + email/password when no token', () => {
    const c = loadConfig({ BAGISTO_URL: 'https://s.test', BAGISTO_ADMIN_EMAIL: 'a@b.c', BAGISTO_ADMIN_PASSWORD: 'p' })
    expect(c.auth).toEqual({ email: 'a@b.c', password: 'p' })
  })

  test('token wins over credentials', () => {
    const c = loadConfig({ BAGISTO_URL: 'https://s.test', BAGISTO_ADMIN_TOKEN: 't', BAGISTO_ADMIN_EMAIL: 'a@b.c', BAGISTO_ADMIN_PASSWORD: 'p' })
    expect(c.auth).toEqual({ token: 't' })
  })

  test('trims a trailing slash off the base url', () => {
    const c = loadConfig({ BAGISTO_URL: 'https://s.test/', BAGISTO_ADMIN_TOKEN: 't' })
    expect(c.baseUrl).toBe('https://s.test')
  })

  test('throws when no auth', () => {
    expect(() => loadConfig({ BAGISTO_URL: 'https://s.test' })).toThrow(ConfigError)
  })

  test('throws when email present but password missing', () => {
    expect(() => loadConfig({ BAGISTO_URL: 'https://s.test', BAGISTO_ADMIN_EMAIL: 'a@b.c' })).toThrow(ConfigError)
  })

  test('throws when url missing', () => {
    expect(() => loadConfig({ BAGISTO_ADMIN_TOKEN: 't' })).toThrow(ConfigError)
  })

  test('throws when url is not http(s)', () => {
    expect(() => loadConfig({ BAGISTO_URL: 'ftp://s.test', BAGISTO_ADMIN_TOKEN: 't' })).toThrow(ConfigError)
  })
})
