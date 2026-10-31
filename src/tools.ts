import { z } from 'zod'
import type { BagistoClient } from './bagisto-client.js'
import { ValidationError } from './bagisto-client.js'
import {
  listAttributeFamilies,
  listAttributes,
  listCategories,
  listLocales,
  listChannels,
} from './discovery.js'
import { createProduct, updateProduct, getProduct, listProducts } from './products.js'

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: z.ZodRawShape
  handler: (args: any) => Promise<ToolResult>
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

async function guard(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn())
  } catch (e: any) {
    if (e instanceof ValidationError) {
      const lines = Object.entries(e.fields)
        .map(([k, v]) => `- ${k}: ${(v as string[]).join('; ')}`)
        .join('\n')
      return fail(`Validation failed. Fix these fields and retry:\n${lines}`)
    }
    return fail(e?.message ?? 'Unknown error')
  }
}

const productShape = {
  attributeFamilyId: z.number().describe('From list_attribute_families.'),
  sku: z.string(),
  name: z.string(),
  urlKey: z.string(),
  shortDescription: z.string(),
  description: z.string(),
  price: z.number(),
  weight: z.number().optional(),
  status: z.boolean().optional(),
  visibleIndividually: z.boolean().optional(),
  attributes: z
    .record(z.union([z.string(), z.number()]))
    .optional()
    .describe('Map of attribute code to value; for select attributes the value is an option id (see list_attributes).'),
  categories: z.array(z.number()).optional(),
  inventory: z.number().optional(),
  channels: z.array(z.number()).optional(),
  images: z.array(z.string()).optional().describe('Local file paths and/or http(s) URLs.'),
  locale: z.string().optional().describe('Defaults to the store default locale.'),
  channel: z.number().optional(),
}

export function buildTools(client: BagistoClient): ToolDef[] {
  return [
    {
      name: 'list_attribute_families',
      description: 'List attribute families. Call before create_product to choose attributeFamilyId.',
      inputSchema: {},
      handler: () => guard(() => listAttributeFamilies(client)),
    },
    {
      name: 'list_attributes',
      description:
        'List attributes with their codes, whether required, and select options (id to label). Read this before create_product to know which attributes to set and what option ids mean.',
      inputSchema: {},
      handler: () => guard(() => listAttributes(client)),
    },
    {
      name: 'list_categories',
      description: 'List categories (id, name, slug) to place a product.',
      inputSchema: {},
      handler: () => guard(() => listCategories(client)),
    },
    {
      name: 'list_locales',
      description: 'List the store locales. A product write targets one locale.',
      inputSchema: {},
      handler: () => guard(() => listLocales(client)),
    },
    {
      name: 'list_channels',
      description: 'List the store channels and their default locale.',
      inputSchema: {},
      handler: () => guard(() => listChannels(client)),
    },
    {
      name: 'create_product',
      description:
        'Create a simple product and make it live on the storefront. First call list_attribute_families, list_attributes and list_categories so you set the right fields and option ids.',
      inputSchema: productShape,
      handler: (args) => guard(() => createProduct(client, args)),
    },
    {
      name: 'update_product',
      description: 'Update a product by id. To add another locale, call again with a different locale.',
      inputSchema: { id: z.number(), ...productShape },
      handler: (args) => guard(() => updateProduct(client, args.id, args)),
    },
    {
      name: 'get_product',
      description: 'Fetch one product by numeric id or by sku, to verify a create/update.',
      inputSchema: { idOrSku: z.union([z.number(), z.string()]) },
      handler: (args) => guard(() => getProduct(client, args.idOrSku)),
    },
    {
      name: 'list_products',
      description: 'List products as summaries.',
      inputSchema: { query: z.record(z.union([z.string(), z.number()])).optional() },
      handler: (args) => guard(() => listProducts(client, args.query)),
    },
  ]
}
