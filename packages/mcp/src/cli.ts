#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
async function main() {
  const url = new URL(process.env.HELIOUS_URL ?? 'http://localhost:3000');
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('Invalid URL');
  const token = process.env.HELIOUS_TOKEN;
  if (!token || !/^hel_pat_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Missing token');
  const remote = new Client({ name: 'helious-stdio', version: '0.7.0' });
  await remote.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const local = new Server(
    { name: 'helious-stdio', version: '0.7.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  local.setRequestHandler(ListToolsRequestSchema, (req) => remote.listTools(req.params));
  local.setRequestHandler(CallToolRequestSchema, (req) => remote.callTool(req.params));
  local.setRequestHandler(ListResourcesRequestSchema, (req) => remote.listResources(req.params));
  local.setRequestHandler(ReadResourceRequestSchema, (req) => remote.readResource(req.params));
  local.setRequestHandler(ListResourceTemplatesRequestSchema, (req) =>
    remote.listResourceTemplates(req.params),
  );
  local.setRequestHandler(ListPromptsRequestSchema, () => remote.listPrompts());
  local.setRequestHandler(GetPromptRequestSchema, (req) => remote.getPrompt(req.params));
  const stop = async () => {
    await local.close();
    await remote.close();
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  await local.connect(new StdioServerTransport());
  process.stdin.once('end', () => void stop());
}
main().catch(() => {
  console.error(
    'Helious MCP could not connect. Check HELIOUS_URL, HELIOUS_TOKEN and token permissions.',
  );
  process.exitCode = 1;
});
