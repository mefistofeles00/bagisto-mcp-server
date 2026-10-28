import type { Config } from './config.js'

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export class ValidationError extends Error {
  fields: Record<string, string[]>
  constructor(summary: string, fields: Record<string, string[]>) {
    super(summary)
    this.name = 'ValidationError'
    this.fields = fields
  }
}

export interface RequestOptions {
  json?: unknown
  form?: FormData
  query?: Record<string, string | number>
}

type FetchImpl = typeof fetch

export class BagistoClient {
  private token: string | null = null

  constructor(
    private config: Config,
    private fetchImpl: FetchImpl = globalThis.fetch
  ) {
    if ('token' in config.auth) {
      this.token = config.auth.token
    }
  }

  private hasCredentials(): boolean {
    return 'email' in this.config.auth
  }

  private async login(): Promise<string> {
    const auth = this.config.auth
    if (!('email' in auth)) {
      throw new AuthError('No credentials configured to obtain a token.')
    }
    const res = await this.fetchImpl(`${this.config.baseUrl}/api/v1/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: auth.email, password: auth.password }),
    })
    if (!res.ok) {
      throw new AuthError('Login failed: check BAGISTO_ADMIN_EMAIL / BAGISTO_ADMIN_PASSWORD.')
    }
    const body: any = await res.json()
    const token = body?.data?.token ?? body?.token
    if (!token) {
      throw new AuthError('Login response did not contain a token.')
    }
    this.token = token
    return token
  }

  private async getToken(): Promise<string> {
    if (this.token) return this.token
    return this.login()
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    return this.send<T>(method, path, opts, false)
  }

  private async send<T>(method: string, path: string, opts: RequestOptions, retried: boolean): Promise<T> {
    const token = await this.getToken()

    let url = `${this.config.baseUrl}${path}`
    if (opts.query) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(opts.query)) qs.set(k, String(v))
      url += `?${qs.toString()}`
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    }
    let body: BodyInit | undefined
    if (opts.form) {
      body = opts.form
    } else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.json)
    }

    const res = await this.fetchImpl(url, { method, headers, body })

    if (res.status === 401) {
      if (this.hasCredentials() && !retried) {
        this.token = null
        await this.login()
        return this.send<T>(method, path, opts, true)
      }
      throw new AuthError('Unauthenticated: the admin token is missing, invalid, or expired.')
    }

    if (res.status === 422) {
      const parsed: any = await res.json().catch(() => ({}))
      const fields: Record<string, string[]> = parsed?.errors ?? {}
      const summary = parsed?.message ?? 'Validation failed.'
      throw new ValidationError(summary, fields)
    }

    if (!res.ok) {
      throw new Error(`Bagisto API error ${res.status} on ${method} ${path}.`)
    }

    const parsed: any = await res.json().catch(() => ({}))
    return (parsed?.data ?? parsed) as T
  }
}
