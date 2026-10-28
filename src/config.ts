export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export type Auth = { token: string } | { email: string; password: string }

export interface Config {
  baseUrl: string
  auth: Auth
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const url = env.BAGISTO_URL
  if (!url) {
    throw new ConfigError('BAGISTO_URL is required.')
  }
  if (!/^https?:\/\//.test(url)) {
    throw new ConfigError('BAGISTO_URL must start with http:// or https://.')
  }
  const baseUrl = url.replace(/\/+$/, '')

  const token = env.BAGISTO_ADMIN_TOKEN
  if (token) {
    return { baseUrl, auth: { token } }
  }

  const email = env.BAGISTO_ADMIN_EMAIL
  const password = env.BAGISTO_ADMIN_PASSWORD
  if (email && password) {
    return { baseUrl, auth: { email, password } }
  }

  throw new ConfigError(
    'Authentication is required: set BAGISTO_ADMIN_TOKEN, or both BAGISTO_ADMIN_EMAIL and BAGISTO_ADMIN_PASSWORD.'
  )
}
