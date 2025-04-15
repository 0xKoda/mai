import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

interface MCPExecuteRequest {
  command: string;
  args: string[];
  serverId: string;
}

export async function POST({ request }: RequestEvent) {
  console.log('[API /api/mcp/execute] Received POST request');
  let transport: StdioClientTransport | null = null;
  let client: Client | null = null;

  try {
    const requestData = await request.json() as MCPExecuteRequest;
    if (!requestData || typeof requestData.command !== 'string' || !Array.isArray(requestData.args) || typeof requestData.serverId !== 'string') {
        console.error('[API /api/mcp/execute] Invalid request data:', requestData);
        return json({ error: { message: 'Invalid request payload' } }, { status: 400 });
    }
    const { command, args, serverId } = requestData;
    console.log('[API /api/mcp/execute] Request data:', { command, args, serverId });

    transport = new StdioClientTransport({
      command: 'node',
      args: [command],
    });
    console.log(`[API /api/mcp/execute] StdioClientTransport created for node with script: ${command}`);

    client = new Client({
      name: "mcp-svelte-client",
      version: "1.0.0",
      capabilities: {}
    });
    console.log('[API /api/mcp/execute] MCP Client instance created.');

    await client.connect(transport);
    console.log('[API /api/mcp/execute] Connected to MCP server.');

    console.log('[API /api/mcp/execute] Listing available tools...');
    const listToolsResponse = await client.request({ method: "tools/list" }, ListToolsResultSchema);
    console.log('[API /api/mcp/execute] Available tools:', listToolsResponse.tools);
    
    if (!listToolsResponse.tools || listToolsResponse.tools.length === 0) {
      throw new Error("No tools available in the MCP server");
    }
    
    const toolNameToCall = listToolsResponse.tools[0].name;
    console.log(`[API /api/mcp/execute] Using tool name: "${toolNameToCall}"`);

    const firstArg = args[0] || '';

    console.log(`[API /api/mcp/execute] Executing tool call for tool "${toolNameToCall}"`);
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: toolNameToCall,
          arguments: { crate: firstArg },
          _meta: {
            progressToken: Date.now()
          }
        },
      },
      CallToolResultSchema
    );
    console.log('[API /api/mcp/execute] Tool call successful. Result:', result);

    await transport.close();
    transport = null;
    console.log('[API /api/mcp/execute] Transport closed.');

    return json({
      output: result.content,
      error: null,
      serverId
    });

  } catch (error: any) {
    console.error('[API /api/mcp/execute] Caught error during execution:', error);
    if (transport) {
        try {
            console.log('[API /api/mcp/execute] Closing transport in error handler...');
            await transport.close();
            console.log('[API /api/mcp/execute] Transport closed in error handler.');
        } catch (closeError) {
            console.error('[API /api/mcp/execute] Error closing transport during error handling:', closeError);
        }
    }
    
    const errorMessage = error?.message || 'Unknown server error occurred';
    const errorStack = error?.stack || undefined;
    const errorOutput = typeof error === 'object' && error !== null && 'stdout' in error ? error.stdout : null;
    const errorStderr = typeof error === 'object' && error !== null && 'stderr' in error ? error.stderr : null;
    
    let serverIdFromRequest: string | null = null;
    try {
      if (request && typeof request.json === 'function') {
        const reqBody = await request.json().catch(() => null);
        if (reqBody && typeof reqBody === 'object' && 'serverId' in reqBody && typeof reqBody.serverId === 'string') {
            serverIdFromRequest = reqBody.serverId;
        }
      }
    } catch (reqError) {
      console.warn('[API /api/mcp/execute] Could not re-parse request body in error handler:', reqError);
    }

    return json({
      error: {
        message: errorMessage,
        stack: errorStack,
        output: errorOutput,
        stderr: errorStderr,
        serverId: serverIdFromRequest
      }
    }, { status: 500 });
  }
} 