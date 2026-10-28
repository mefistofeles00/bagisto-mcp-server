# Bagisto MCP Server (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a TypeScript MCP server that lets an AI create, update, and verify `simple` products on any Bagisto 2.3.x store through the official `bagisto/rest-api`.

**Architecture:** A single standalone stdio MCP server. It authenticates to the store's admin REST API, exposes discovery tools (families, attributes, categories, locales, channels) so it works on any store, and write tools (`create_product`, `update_product`) that orchestrate rest-api's store-then-update flow, plus read tools to verify. All Bagisto access goes through one HTTP client module; tool logic is unit-tested against a mocked client.

**Tech Stack:** TypeScript (ES modules), Node ≥ 20 (global `fetch`, `FormData`, `Blob`), `@modelcontextprotocol/sdk`, `zod` for tool input schemas, `vitest` for tests. No HTTP-client dependency.

**Spec:** `/Users/inanc/Desktop/o-source/bagisto-mcp-server/DESIGN.md`

## Global Constraints

- Language TypeScript, ES modules, Node ≥ 20; distributed on npm.
- Target Bagisto 2.3.x with `bagisto/rest-api` 2.3.x; admin base path `/api/v1/admin`.
- v1 handles `type` = `simple` only; any other type is rejected with a clear message.
- v1 writes one locale per call; `locale`/`channel` default to the store's default.
- Secrets (password, token) are never logged and never returned in tool output.
- Product writes use rest-api's two-step: `POST .../catalog/products` (store) then
  `PUT .../catalog/products/{id}` (update, as `POST` + `_method=PUT` when sending files).
- Multipart text fields must be sent as literal strings (HTML like `<p>` must never be
  routed through any file-reference syntax).
- No comments in code unless a step's test or signature requires one.

## Review Focus

- **HTML field value beginning with `<`** (e.g. `description=<p>…</p>`): must be sent as a
  literal multipart string, not interpreted as a file read. → Task 5.
- **rest-api 422 validation error**: surfaced to the AI as a readable list of failing
  fields (e.g. "description is required"), not a generic failure. → Task 2 (mapping) +
  Task 5 (create path).
- **Write to a non-default locale**: translatable fields land in the given `locale`; the
  product is correctly scoped in `product_flat` for (channel, locale). → Task 5.
- **Image URL that fails to download / non-image content**: a clear error, no crash, temp
  files cleaned up. → Task 4.
- **Expired/invalid token → 401 mid-session**: mapped to a clear "re-authenticate" error;
  if credentials are configured, one transparent re-login retry. → Task 2.

---

### Task 1: Project scaffold + config loading

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config` where
  `Config = { baseUrl: string; auth: { token: string } | { email: string; password: string } }`.
  Throws `ConfigError` with a human message when neither a token nor an email+password
  pair is present, or when `BAGISTO_URL` is missing/not http(s).

- [ ] **Step 1: Scaffold the npm + TS + vitest project**

`package.json` (type `module`, bin `bagisto-mcp`, deps `@modelcontextprotocol/sdk` + `zod`,
devDeps `typescript`, `vitest`, `@types/node`), `tsconfig.json` (NodeNext, strict, outDir
`dist`), `vitest.config.ts`, `.gitignore` (`node_modules`, `dist`).

- [ ] **Step 2: Write the failing test** — `test/config.test.ts`

```ts
test('reads url + token', () => {
  const c = loadConfig({ BAGISTO_URL: 'https://s.test', BAGISTO_ADMIN_TOKEN: 't' } as any)
  expect(c).toEqual({ baseUrl: 'https://s.test', auth: { token: 't' } })
})
test('reads url + email/password when no token', () => {
  const c = loadConfig({ BAGISTO_URL: 'https://s.test', BAGISTO_ADMIN_EMAIL: 'a@b.c', BAGISTO_ADMIN_PASSWORD: 'p' } as any)
  expect(c.auth).toEqual({ email: 'a@b.c', password: 'p' })
})
test('token wins over credentials', () => {
  const c = loadConfig({ BAGISTO_URL: 'https://s.test', BAGISTO_ADMIN_TOKEN: 't', BAGISTO_ADMIN_EMAIL: 'a@b.c', BAGISTO_ADMIN_PASSWORD: 'p' } as any)
  expect(c.auth).toEqual({ token: 't' })
})
test('throws when no auth', () => { expect(() => loadConfig({ BAGISTO_URL: 'https://s.test' } as any)).toThrow(ConfigError) })
test('throws when url missing or not http', () => { expect(() => loadConfig({ BAGISTO_ADMIN_TOKEN: 't' } as any)).toThrow(ConfigError) })
```

- [ ] **Step 3: Run test, verify it fails** — `npx vitest run test/config.test.ts` → FAIL (module not found)
- [ ] **Step 4: Implement `loadConfig` and `ConfigError` in `src/config.ts`** — trims a trailing slash off `baseUrl`.
- [ ] **Step 5: Run test, verify it passes**
- [ ] **Step 6: Commit** — `chore: scaffold project and config loading`

---

### Task 2: Bagisto admin HTTP client + auth + error mapping

**Files:**
- Create: `src/bagisto-client.ts`
- Test: `test/bagisto-client.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1).
- Produces: `class BagistoClient` with
  - `constructor(config: Config, fetchImpl?: typeof fetch)` (fetch injectable for tests)
  - `request<T>(method, path, opts?: { json?: unknown; form?: FormData; query?: Record<string,string|number> }): Promise<T>` — resolves to parsed `data`, injects `Authorization: Bearer`, lazily authenticates.
  - On 401: if credentials configured, re-login once and retry; else throw `AuthError`.
  - On 422: throw `ValidationError` carrying `fields: Record<string,string[]>` and a one-line summary.
- `getToken(): Promise<string>` (internal) — returns the configured token, or logs in via `POST /api/v1/admin/login` with email+password and caches the returned token.

- [ ] **Step 1: Write the failing tests** — `test/bagisto-client.test.ts` (inject a fake `fetch`)

```ts
test('logs in with credentials and sends Bearer token', async () => {
  const calls: any[] = []
  const fake = fakeFetch(calls, {
    'POST /api/v1/admin/login': { status: 200, body: { data: { token: 'tok123' } } },
    'GET /api/v1/admin/catalog/categories': { status: 200, body: { data: [] } },
  })
  const c = new BagistoClient({ baseUrl: 'https://s.test', auth: { email: 'a@b.c', password: 'p' } }, fake)
  await c.request('GET', '/api/v1/admin/catalog/categories')
  expect(calls.at(-1).headers.Authorization).toBe('Bearer tok123')
})
test('maps 422 to ValidationError with fields', async () => {
  const fake = fakeFetch([], { 'POST /api/v1/admin/catalog/products': { status: 422, body: { message: 'x', errors: { description: ['description is required'] } } } })
  const c = new BagistoClient({ baseUrl: 'https://s.test', auth: { token: 't' } }, fake)
  await expect(c.request('POST', '/api/v1/admin/catalog/products', { json: {} }))
    .rejects.toMatchObject({ name: 'ValidationError', fields: { description: ['description is required'] } })
})
test('on 401 with credentials, re-logs in once and retries', async () => { /* first GET 401, login 200, retry 200; assert login called once, final resolves */ })
test('on 401 with only a token, throws AuthError (no retry)', async () => { /* ... */ })
test('never includes password/token in thrown error messages', async () => { /* assert error.message/stack excludes secrets */ })
```

- [ ] **Step 2: Run tests, verify they fail**
- [ ] **Step 3: Implement `BagistoClient`, `AuthError`, `ValidationError` in `src/bagisto-client.ts`** — `request` builds the URL from `baseUrl + path + query`, sends `json` as `application/json` or `form` as `FormData`, sets `Accept: application/json`. Token cached after first `getToken()`.
- [ ] **Step 4: Run tests, verify they pass**
- [ ] **Step 5: Commit** — `feat: bagisto admin http client with auth and error mapping`

---

### Task 3: Discovery (families, attributes, categories, locales, channels)

**Files:**
- Create: `src/discovery.ts`
- Test: `test/discovery.test.ts`

**Interfaces:**
- Consumes: `BagistoClient` (Task 2).
- Produces (all `(client) => Promise<...>`):
  - `listAttributeFamilies` → `{ id: number; code: string; name: string }[]`
  - `listAttributes` → `{ id: number; code: string; type: string; isRequired: boolean; options: { id: number; label: string }[] }[]` (options empty for non-select types)
  - `listCategories` → `{ id: number; name: string; slug: string }[]`
  - `listLocales` → `{ code: string; name: string }[]`
  - `listChannels` → `{ id: number; code: string; name: string; defaultLocale: string }[]`
  - `getDefaults(client)` → `{ locale: string; channel: number }` from the first/default channel.

- [ ] **Step 1: Write the failing tests** — feed mocked rest-api payloads through a stubbed `BagistoClient.request`; assert each mapper returns the normalized shape, and that `listAttributes` surfaces `isRequired` and select `options` (id→label) from the attribute resource's embedded options field.
- [ ] **Step 2: Run tests, verify they fail**
- [ ] **Step 3: Implement the mappers in `src/discovery.ts`** — hit `GET /api/v1/admin/catalog/{attributes,attribute-families,categories}` and `GET /api/v1/admin/settings/{locales,channels}`; map response fields to the shapes above. (Exact source field names confirmed against a live store during execution; adjust mapper only.)
- [ ] **Step 4: Run tests, verify they pass**
- [ ] **Step 5: Commit** — `feat: store discovery (families, attributes, categories, locales, channels)`

---

### Task 4: Image resolution (local path or URL → multipart parts)

**Files:**
- Create: `src/images.ts`
- Test: `test/images.test.ts`

**Interfaces:**
- Produces: `resolveImages(images: string[], fetchImpl?: typeof fetch): Promise<{ parts: { blob: Blob; filename: string }[]; cleanup: () => Promise<void> }>`.
  - A local filesystem path → read into a `Blob` with its basename.
  - An `http(s)` URL → download; on non-2xx or non-image content-type throw `ImageError`;
    save to a temp file, include it, and have `cleanup()` remove temp files.

- [ ] **Step 1: Write the failing tests**

```ts
test('local path becomes a part with its basename', async () => { /* write a temp png, resolveImages([path]), assert one part, filename basename */ })
test('http url is downloaded into a part', async () => { /* fake fetch returns png bytes + content-type image/png; assert one part */ })
test('bad url (404) throws ImageError and cleans up', async () => { /* fake fetch 404; expect ImageError; assert no temp files left */ })
test('non-image content-type throws ImageError', async () => { /* fake fetch 200 text/html; expect ImageError */ })
```

- [ ] **Step 2: Run tests, verify they fail**
- [ ] **Step 3: Implement `resolveImages` and `ImageError` in `src/images.ts`** — detect URL vs path by `/^https?:\/\//`; temp files under `os.tmpdir()`.
- [ ] **Step 4: Run tests, verify they pass**
- [ ] **Step 5: Commit** — `feat: image resolution from local path or url`

---

### Task 5: create_product / update_product (orchestration)

**Files:**
- Create: `src/products.ts`
- Test: `test/products.test.ts`

**Interfaces:**
- Consumes: `BagistoClient` (2), `resolveImages` (4), `getDefaults` (3), `ValidationError` (2).
- Produces:
  - `type ProductInput = { type?: string; attributeFamilyId: number; sku: string; name: string; urlKey: string; shortDescription: string; description: string; price: number; weight?: number; status?: boolean; visibleIndividually?: boolean; attributes?: Record<string, string|number>; categories?: number[]; inventory?: number; channels?: number[]; images?: string[]; locale?: string; channel?: number }`
  - `createProduct(client, input): Promise<{ id: number; urlKey: string }>`
  - `updateProduct(client, id, input): Promise<{ id: number; urlKey: string }>`

- [ ] **Step 1: Write the failing tests** (stubbed client records calls)

```ts
test('rejects non-simple type before any call', async () => {
  await expect(createProduct(client, { type: 'configurable', ...base })).rejects.toThrow(/simple/)
  expect(client.calls).toHaveLength(0)
})
test('store then update: posts skeleton, then PUT with fields + attributes + locale', async () => {
  // store → {data:{id:31}}; update → ok. assert POST products body has type/family/sku;
  // assert update form carries name, description, ayar=<optId>, categories, inventory, channels, locale
})
test('defaults locale and channel from store when omitted', async () => { /* getDefaults stub returns {locale:'tr',channel:1}; assert update carries them */ })
test('HTML description is sent as a literal multipart string', async () => {
  // input.description = '<p>x</p>'; assert the captured FormData field value equals '<p>x</p>' exactly
})
test('update failure rolls back: deletes the skeleton and rethrows ValidationError', async () => {
  // store ok id=31; update throws ValidationError; assert DELETE /products/31 called; assert rethrow
})
test('writes a second locale via updateProduct with a different locale', async () => { /* ... */ })
```

- [ ] **Step 2: Run tests, verify they fail**
- [ ] **Step 3: Implement `createProduct` / `updateProduct` in `src/products.ts`** — build `FormData` for update (append each field as a string; append image parts under `images[files][i]`; `_method=PUT`); spread `attributes` map as `code=value`; apply `getDefaults` when `locale`/`channel` missing; on update error after a successful store, `DELETE /catalog/products/{id}` then rethrow.
- [ ] **Step 4: Run tests, verify they pass**
- [ ] **Step 5: Commit** — `feat: create/update product orchestration with rollback`

---

### Task 6: Verify tools (get_product / list_products)

**Files:**
- Modify: `src/products.ts`
- Test: `test/products.test.ts`

**Interfaces:**
- Produces: `getProduct(client, idOrSku): Promise<ProductSummary>`, `listProducts(client, opts?): Promise<ProductSummary[]>` where `ProductSummary = { id; sku; name; price; status; urlKey }`.

- [ ] **Step 1: Write the failing tests** — mocked `GET /products` and `GET /products/{id}`; assert normalized summaries; `getProduct` accepts a sku by filtering.
- [ ] **Step 2: Run tests, verify they fail**
- [ ] **Step 3: Implement `getProduct` / `listProducts`.**
- [ ] **Step 4: Run tests, verify they pass**
- [ ] **Step 5: Commit** — `feat: get/list product verify tools`

---

### Task 7: MCP server wiring (tool registration + stdio)

**Files:**
- Create: `src/tools.ts` (zod schemas + handler wrappers), `src/server.ts`, `src/index.ts` (bin entry)
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `buildServer(client): McpServer` registering tools `list_attribute_families`,
  `list_attributes`, `list_categories`, `list_locales`, `list_channels`, `create_product`,
  `update_product`, `get_product`, `list_products`, each with a zod input schema and a
  description that tells the AI to call discovery before writing. `src/index.ts` loads
  config, constructs the client, and connects the server over `StdioServerTransport`.

- [ ] **Step 1: Write the failing tests** — `buildServer` with a stubbed client; assert the tool list contains all nine names; invoke `create_product` through the server and assert it calls `createProduct` with mapped args; assert a thrown `ValidationError` becomes an error result whose text lists the failing fields and contains no secret.
- [ ] **Step 2: Run tests, verify they fail**
- [ ] **Step 3: Implement `src/tools.ts`, `src/server.ts`, `src/index.ts`** — map each tool's zod input to the `ProductInput`/discovery calls; format `ValidationError` into a readable tool error.
- [ ] **Step 4: Run tests, verify they pass**
- [ ] **Step 5: Commit** — `feat: mcp server wiring over stdio`

---

### Task 8: End-to-end integration test (gated on a live store)

**Files:**
- Create: `test/e2e.test.ts`, `README.md`

**Interfaces:**
- Consumes: the built server / tools against a real Bagisto + rest-api.

- [ ] **Step 1: Write the e2e test** — `describe.skipIf(!process.env.BAGISTO_URL)`: discover a family + an attribute option + a category, `create_product` with that attribute + a local image, then `get_product` and assert name/price/status and that it is visible; finally delete it. Mirrors the manual spike.
- [ ] **Step 2: Run with a live store configured** — `BAGISTO_URL=… BAGISTO_ADMIN_EMAIL=… BAGISTO_ADMIN_PASSWORD=… npx vitest run test/e2e.test.ts` → PASS; without env → skipped.
- [ ] **Step 3: Write `README.md`** — install, the two config modes, the MCP-client snippet, the `composer require bagisto/rest-api` prerequisite, and the v1 scope (simple products, one locale per call).
- [ ] **Step 4: Commit** — `test: end-to-end against a live store + readme`

---

## Notes for the executor

- Confirm the exact rest-api response field names (attribute options container, channel
  default locale, product resource fields) against a live store the first time Task 3/6
  mappers run; adjust only the mapping, not the interfaces.
- The spike that validated the write path lived in a separate Bagisto project; a disposable
  Bagisto 2.3.x with `bagisto/rest-api` is needed for Task 8.
