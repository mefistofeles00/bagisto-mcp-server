#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig, ConfigError } from './config.js'
import { BagistoClient } from './bagisto-client.js'
import { buildServer } from './server.js'

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const client = new BagistoClient(config)
  const server = buildServer(client)
  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  if (e instanceof ConfigError) {
    process.stderr.write(`Configuration error: ${e.message}\n`)
  } else {
    process.stderr.write(`Fatal: ${e?.message ?? e}\n`)
  }
  process.exit(1)
})
