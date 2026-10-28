import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BagistoClient } from './bagisto-client.js'
import { buildTools } from './tools.js'

export function buildServer(client: BagistoClient): McpServer {
  const server = new McpServer({ name: 'bagisto-mcp-server', version: '0.1.0' })
  for (const tool of buildTools(client)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      tool.handler as any
    )
  }
  return server
}
