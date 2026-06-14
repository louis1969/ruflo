import { Server }              from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RufloContext }         from './context.js';
import { registerTools }        from './tools.js';
import { registerResources }    from './resources.js';
import { registerPrompts }      from './prompts.js';
import type { McpContextOptions } from './context.js';

export async function createMcpServer(opts: McpContextOptions = {}): Promise<void> {
  const ctx = await RufloContext.create(opts);

  const server = new Server(
    { name: 'ruflo', version: '0.1.0' },
    {
      capabilities: {
        tools:     {},
        resources: {},
        prompts:   {},
      },
    }
  );

  registerTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown.
  process.on('SIGINT',  async () => { await ctx.close(); process.exit(0); });
  process.on('SIGTERM', async () => { await ctx.close(); process.exit(0); });
}
