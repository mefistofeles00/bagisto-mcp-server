# Bagisto MCP Server — Design (v1)

> Status: approved design, pre-implementation. Scope: **product management only** for v1.

## 1. Intent & why

Store owners and developers running [Bagisto](https://bagisto.com) fill their product
catalog by hand, one product at a time, through the admin panel. This is slow and
repetitive, especially for stores with many SKUs or frequent additions.

This project is an **MCP (Model Context Protocol) server** that lets an AI assistant
(Claude, or any MCP client) create and manage Bagisto products conversationally. Typical
moment: the user has a product photo and some details in mind ("22k gold necklace, 3333
TRY, 20 in stock") and tells the AI to add it; the AI creates the product through this
server, and it goes live on both the product page and the storefront listing.

It is a **community / open-source** tool: it must work on *any* Bagisto store, not one
specific catalog.

## 2. Goals / Non-goals / Anti-goals

**Goals**
- Create, update, and verify products on any Bagisto 2.3.x store via MCP tools.
- Be **store-agnostic**: discover each store's attribute families, attributes (with
  required flags and options), and categories at runtime, and expose them so the AI fills
  the correct fields.
- Support product images from **both a local file path and a URL**.
- Guarantee the "appears in storefront" promise (i.e. `product_flat` is indexed).
- One-command install for the user on the Bagisto side; a single npm package for the MCP
  server.

**Non-goals (v1)**
- Order management, customer management.
- Category **creation** (v1 reads categories only; create/update comes later).
- Bulk/CSV import.
- A custom admin-panel UI on the Bagisto side.
- **Product types other than `simple`.** v1 handles `simple` products only (the spike
  proved `simple`). Configurable/grouped/virtual/downloadable need `super_attributes` and
  per-variant flows that roughly double the payload model — deferred. The tool rejects
  non-simple types with a clear message rather than half-creating. *(Author's call.)*
- **Multi-locale writes in a single call.** v1 writes one locale per call (see §6/§5);
  translating a product into several locales is repeated calls, not one payload. *(Author's
  call.)*

**Anti-goals (would make this a failure even if it technically works)**
- Reinventing what `bagisto/rest-api` already does (we are a thin, value-adding layer
  over it, not a reimplementation).
- Forking or patching Bagisto core.
- A product that silently creates products that never show up in the storefront.
- Being hard-wired to one store's attributes (e.g. jewelry-specific fields).

## 3. Architecture

Single standalone MCP server. No companion Bagisto package is needed — the spike (section
8) proved the official `bagisto/rest-api` package already handles product creation, EAV
attributes, image upload, and `product_flat` indexing.

```
┌──────────┐   MCP     ┌──────────────────────┐   HTTPS + token    ┌──────────────────────────┐
│  Claude  │ ◄───────► │  bagisto-mcp-server  │ ◄────────────────► │  User's Bagisto store     │
│ (client) │  stdio    │  (TypeScript, npm)   │  /api/v1/admin/*   │  + official bagisto/rest-api│
└──────────┘           └──────────────────────┘                    └──────────────────────────┘
```

- **MCP server (this repo):** implements the MCP protocol, exposes the tools in section 6,
  translates them into `bagisto/rest-api` admin HTTP calls, handles image fetching and the
  multipart encoding.
- **Bagisto side (user installs, we do not ship):** official `bagisto/rest-api`.

## 4. Prerequisites (what the user does once)

1. On their Bagisto store: `composer require bagisto/rest-api` and run its install/discover
   so the `api/v1/admin/*` routes are live.
2. Install this MCP server (npm) and point their MCP client at it with the store URL plus
   **admin email + password** (the server obtains a token itself, see section 5). A
   pre-minted token may be supplied instead.

## 5. Authentication

- Bagisto admin auth here is a **Laravel Sanctum personal access token** on the `Admin`
  model. The spike confirmed a token minted via `$admin->createToken()` is accepted by
  `rest-api`'s `auth:sanctum` admin guard.
- **Primary mechanism:** the server reads `BAGISTO_URL` + `BAGISTO_ADMIN_EMAIL` +
  `BAGISTO_ADMIN_PASSWORD` and obtains a token itself via `POST /api/v1/admin/login`
  (confirmed to exist and return a token in the spike). This is the primary path because
  stock `bagisto/rest-api` does not ship an admin-UI route for minting personal access
  tokens, so asking the end user to produce one by hand is a poor install story.
- **Override:** a pre-minted `BAGISTO_ADMIN_TOKEN` may be supplied instead; if present it
  wins over credentials.
- The token/password are secrets: never log them, never echo them back in tool output.

## 6. Tools (v1)

Grouped by purpose. Exact JSON schemas are left to the builder; the shape below is
normative.

**Discovery (the thing that makes it store-agnostic)**
- `list_attribute_families` → families to pick `attribute_family_id` from.
- `list_attributes` → per family (or global): each attribute's `code`, type, whether it's
  required, and for select/multiselect its options (id + label). This is what the AI reads
  to know it must set e.g. `ayar` and what option ids mean "22 Ayar".
- `list_categories` → id + name + slug, so products can be placed.
- `list_locales` → the store's locales (code + name); the default locale is the fallback
  when a write omits `locale`.
- `list_channels` → the store's channels (id + code + name + default locale); the default
  channel is the fallback when a write omits `channels`.

All five map to confirmed rest-api read endpoints (see §8). Attribute options are not a
separate endpoint; they come embedded in an attribute's `getResource` response — the
builder confirms the field name and shape against a live store.

**Write**
- `create_product` — inputs: `type` (default `simple`; non-simple rejected in v1),
  `attribute_family_id`, `sku`, `name`, `url_key`, `short_description`, `description`,
  `price`, `weight`, `status`, `visible_individually`, a dynamic **`attributes`** map
  (`{ attribute_code: value }`, where value for a select is an option id), `categories`
  (ids), `inventory` (qty, default source), `channels` (ids), `images` (list of local
  paths and/or URLs), and **`locale`** (defaults to the store's default locale) +
  **`channel`** (defaults to the store's default channel). Translatable fields (name,
  descriptions, url_key) are written in the given/default locale; sku/price/weight are not
  locale-scoped. Implemented as rest-api **store then update** (see section 8); the server
  hides that two-step from the caller.
- `update_product` — same fields, by product id, all optional. To add another locale's
  translation, call again with a different `locale`.

**Verify (so the AI can confirm its own work)**
- `get_product` (by id or sku), `list_products` (with simple filters).

## 7. Image handling

- Accept each image as a local filesystem path **or** an `http(s)` URL.
- For a URL, the server downloads to a temp file first.
- Send to rest-api as multipart under `images[files][<index>]`, with an explicit MIME type.
- **Critical encoding gotcha (proven in the spike):** rest-api validates `description` /
  `short_description` as required and they contain HTML (`<p>...`). When posting multipart,
  a field *value* beginning with `<` is interpreted by some HTTP/curl layers as a
  file-read directive. The builder must ensure text fields are sent as literal strings
  (in curl terms, `--form-string`, not `-F`). In a TS HTTP client (e.g. undici/axios
  FormData) appending a plain string value is already literal — just don't route HTML
  through any `@`/`<` file-reference syntax.

## 8. Spike findings (concrete, verified facts — don't re-derive)

Verified against Bagisto **2.3.19** + `bagisto/rest-api` **v2.3.1**, Laravel 11:

- Admin product routes exist:
  - `POST /api/v1/admin/catalog/products` → `store` (requires `type`,
    `attribute_family_id`, `sku`; returns the new product with its `id`).
  - `PUT  /api/v1/admin/catalog/products/{id}` → `update` (set all other fields here).
  - `POST /api/v1/admin/catalog/products/{id}/inventories` → inventory.
  - `DELETE /api/v1/admin/catalog/products/{id}`.
  - Category read + create routes also exist (create deferred to a later version).
- Discovery read routes exist and are confirmed (rest-api v2.3.1), so the store-agnostic
  design needs no companion package:
  - `GET /api/v1/admin/catalog/attributes` (+ `/{id}`) — attribute options come embedded
    in the single-attribute resource (no separate options route).
  - `GET /api/v1/admin/catalog/attribute-families` (+ `/{id}`).
  - `GET /api/v1/admin/catalog/categories` (+ `/{id}`).
  - `GET /api/v1/admin/settings/locales` (+ `/{id}`).
  - `GET /api/v1/admin/settings/channels` (+ `/{id}`).
- `product_flat` is keyed by (product, channel, locale). A write targets one (channel,
  locale); the spike store was single-locale (tr). On a multi-locale store, a product
  written only in the default locale is intentionally absent from other locales'
  storefronts until written there too — hence the per-call `locale`/`channel` params.
- Admin auth: `POST /api/v1/admin/login` (email+password) returns a usable admin token;
  a Sanctum token minted on the `Admin` model is also accepted by the admin guard.
- `store()` dispatches `catalog.product.create.after`; `update()` dispatches
  `catalog.product.update.after`. **These trigger `product_flat` indexing**, so a product
  created through the API shows up on the storefront — the exact trap that breaks naive
  implementations is already handled by rest-api.
- EAV custom attributes (e.g. a `select` attribute `ayar`) are set by passing the option id
  under the attribute code in the update payload. Confirmed: product listed in `/magaza`
  and `/{url_key}` returned 200.
- Image upload: multipart `images[files][0]=@file`. rest-api stores it and auto-converts to
  webp (`product/{id}/<hash>.webp`), recorded in `product_images`.
- Validation (v2.3.1) requires `short_description` and `description` on update.
- `update` with file upload: POST with `_method=PUT` + multipart (standard Laravel method
  spoofing) works.
- A full end-to-end create (skeleton → update with EAV + category + inventory + image)
  produced a correct `product_flat` row (name, price, status, visible) and a live
  storefront product.

## 9. Tech stack & constraints

- **Language:** TypeScript. **SDK:** `@modelcontextprotocol/sdk`. **Distribution:** npm.
  (Chosen for the mature MCP SDK and npm reach; this is the author's call.)
- **Transport:** stdio for local MCP clients; an optional HTTP/SSE transport may follow.
- **Target:** Bagisto 2.3.x with `bagisto/rest-api` 2.3.x installed.
- **HTTP client:** builder's choice (undici/axios/node-fetch); must support multipart with
  literal string fields and streamed file parts.

## 10. Error handling expectations

- Surface rest-api validation errors (HTTP 422) back to the AI as a clear, actionable
  message listing the failing fields (e.g. "description is required"), so the AI can fix
  and retry — rather than a generic failure.
- Map 401 to a clear "token invalid/expired" message.
- Never leak the token or raw internal stack traces into tool output.
- A tool that creates a product should return enough to verify (id, url_key, and a hint to
  call `get_product`).
- **Partial-failure in store-then-update:** `create_product` is two calls (skeleton
  `store`, then `update` with the real content). If the `update` fails (e.g. 422 on a
  missing required attribute), the server **deletes the orphan skeleton** (`DELETE
  /products/{id}`) before returning the error. Rationale: the skeleton carries no user
  content yet, so deleting it is safe; leaving it would both violate the "never silently
  create products that don't show up" anti-goal and block the `sku`/`url_key` on retry.
  The error returned still lists the failing fields so the AI can fix and retry cleanly.

## 11. What's left to the builder

- Exact MCP tool JSON schemas and descriptions (the descriptions matter a lot — they teach
  the AI how/when to use each tool; invest here).
- Exact response shapes of the (now-confirmed) discovery endpoints — in particular the
  field name/shape of the embedded attribute options in the attribute resource — verified
  against a live store.
- Temp-file lifecycle for downloaded URL images (cleanup).
- Packaging, README, examples, and MCP-client setup snippets.
- Tests: at minimum an end-to-end "create product with EAV + image, assert it appears"
  against a disposable Bagisto.

## 12. Future (post-v1)

- Category create/update, attribute/attribute-family create.
- Order and customer tools.
- Bulk / CSV import.
- Optional HTTP/SSE transport for hosted use (with the security caveats a public endpoint
  implies).
