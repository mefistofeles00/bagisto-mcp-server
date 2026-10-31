# Bagisto MCP Server

Add products to a [Bagisto](https://bagisto.com) store by talking to an AI assistant.
Hand it a photo and a few details — "create a 22k gold ring, 1200 TL, 4 grams, in stock" —
and it shows up on the storefront.

This is an [MCP](https://modelcontextprotocol.io) server. It plugs into any MCP-capable
assistant (Claude Desktop, and others) and gives it a small set of tools for managing
products on your Bagisto store over the store's official admin REST API. Nothing is patched
into Bagisto itself; the server runs on its own and speaks HTTP to your store.

It's store-agnostic on purpose. There's no hardcoded list of attributes or categories — the
server asks your store what it has (attribute families, attributes and their options,
categories, locales, channels) and works from that. A jewelry shop and a shoe shop use the
exact same build.

## What it can do

- **Create and update products** — simple products, with attributes, categories, stock, and
  images (from a local file path or a URL).
- **Inspect the store** — list attribute families, attributes, categories, locales, channels,
  so the assistant knows what values are valid before it writes anything.
- **Verify its own work** — fetch a product by id or SKU, or list products, to confirm what
  landed.

## Requirements

- A Bagisto 2.3.x store with the official REST API installed:

  ```bash
  composer require bagisto/rest-api
  ```

  Run its install/discover step so the `api/v1/admin/*` routes are live.

- Node.js 20 or newer.

## Install

```bash
npm install -g bagisto-mcp-server
```

## Configure

The server acts as an admin. Give it credentials one of two ways:

- **Email + password** (easiest) — it logs in and keeps the token fresh for you.
- **A pre-minted admin token** — if you'd rather manage the token yourself.

| Variable | Needed | Notes |
|----------|--------|-------|
| `BAGISTO_URL` | always | e.g. `https://store.example.com`, no trailing slash |
| `BAGISTO_ADMIN_EMAIL` | email mode | admin email |
| `BAGISTO_ADMIN_PASSWORD` | email mode | admin password |
| `BAGISTO_ADMIN_TOKEN` | token mode | takes precedence if set |

Keep these out of version control — they're secrets. Use your MCP client's env config or a
`.env` file that's gitignored.

### Claude Desktop

```json
{
  "mcpServers": {
    "bagisto": {
      "command": "bagisto-mcp",
      "env": {
        "BAGISTO_URL": "https://store.example.com",
        "BAGISTO_ADMIN_EMAIL": "admin@example.com",
        "BAGISTO_ADMIN_PASSWORD": "your-password"
      }
    }
  }
}
```

## Tools

| Tool | What it does |
|------|--------------|
| `list_attribute_families` | List attribute families |
| `list_attributes` | List attributes with their options |
| `list_categories` | List categories |
| `list_locales` | List store locales |
| `list_channels` | List sales channels |
| `create_product` | Create a simple product |
| `update_product` | Update a product (also used to add another locale) |
| `get_product` | Fetch a product by id or SKU |
| `list_products` | List products |

## A note on product images

Bagisto re-encodes every uploaded image to WebP on its side, using the server's GD/Imagick.
If your PHP doesn't have WebP support, image uploads fail with a 500 — no matter what format
you send. You can check with:

```bash
php -r 'var_dump(function_exists("imagewebp"));'
```

If that prints `false`, enable WebP in your PHP image extension. Everything other than image
upload works regardless.

## Scope

v1 is deliberately small:

- Simple products only.
- One locale per call. To translate a product, call `update_product` again with a different
  `locale`.
- Reads categories; doesn't create them yet.
- No order or customer tools yet.

The create → update → verify → delete path has been exercised end to end against a live
Bagisto 2.3.x store.

## Development

```bash
npm install
npm test        # unit tests, mocked HTTP
npm run build
```

There's an end-to-end test that runs against a real store. It creates a throwaway product and
deletes it afterwards:

```bash
BAGISTO_URL=… BAGISTO_ADMIN_EMAIL=… BAGISTO_ADMIN_PASSWORD=… npx vitest run test/e2e.test.ts
```

Without `BAGISTO_URL` it's skipped.

## License

MIT
