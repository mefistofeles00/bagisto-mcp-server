# Bagisto MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant create, update,
and verify **products** on any [Bagisto](https://bagisto.com) 2.3.x store — talking to the
store's official admin REST API. Give the AI a photo and some details; it adds the product
and it goes live on the storefront.

Store-agnostic: it discovers each store's attribute families, attributes (with options),
categories, locales, and channels at runtime, so the same tool works for a jewelry shop or
a shoe shop.

## Prerequisites

On your Bagisto store, install the official REST API package so the admin API is available:

```bash
composer require bagisto/rest-api
```

(Run its install/discover step so the `api/v1/admin/*` routes are live.)

## Install

```bash
npm install -g bagisto-mcp-server
```

## Configure

The server authenticates as an admin. Two modes:

- **Email + password (recommended):** the server logs in and manages the token for you.
- **Token:** supply a pre-minted admin token instead.

| Variable | Required | Notes |
|----------|----------|-------|
| `BAGISTO_URL` | yes | e.g. `https://store.example.com` |
| `BAGISTO_ADMIN_EMAIL` | one mode | admin email |
| `BAGISTO_ADMIN_PASSWORD` | one mode | admin password |
| `BAGISTO_ADMIN_TOKEN` | other mode | wins over email/password if set |

### MCP client (e.g. Claude Desktop)

```json
{
  "mcpServers": {
    "bagisto": {
      "command": "bagisto-mcp",
      "env": {
        "BAGISTO_URL": "https://store.example.com",
        "BAGISTO_ADMIN_EMAIL": "admin@example.com",
        "BAGISTO_ADMIN_PASSWORD": "••••••"
      }
    }
  }
}
```

## Tools

- Discovery: `list_attribute_families`, `list_attributes`, `list_categories`,
  `list_locales`, `list_channels`
- Write: `create_product`, `update_product`
- Verify: `get_product`, `list_products`

## Status

v1 is unit-tested against a mocked API. The write-path field keys and the response shapes
(`channels[]`, scoping `channel` code, `inventories[<source>]`, product fields) are based on
Bagisto 2.3.x internals and a manual spike, but have **not yet been verified end-to-end
against a live store in CI**. Run the e2e test (below) against a real Bagisto 2.3.x before
relying on it in production.

## Scope (v1)

- Simple products only.
- One locale per call — to translate a product into another locale, call `update_product`
  again with a different `locale`.
- Reads categories; does not create them yet.
- No order or customer tools yet.

## Develop

```bash
npm install
npm test          # unit tests (mocked HTTP)
npm run build
```

End-to-end test against a disposable Bagisto with `bagisto/rest-api` installed:

```bash
BAGISTO_URL=… BAGISTO_ADMIN_EMAIL=… BAGISTO_ADMIN_PASSWORD=… npx vitest run test/e2e.test.ts
```

Without `BAGISTO_URL` the e2e test is skipped.

## License

MIT
