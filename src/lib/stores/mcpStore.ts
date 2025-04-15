import { writable, get } from 'svelte/store';
import { db } from '$lib/db';

// Type definitions for Electron
declare global {
  interface Window {
    electron?: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      ipcRenderer?: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
      };
    };
    electronAPI?: {
      executeMCP: (serverConfig: MCPServer, args: string[]) => Promise<any>;
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      fetchMCPCapabilities: (options: { command: string; args: string[]; serverId: string; }) => Promise<any>;
    };
    process?: {
      type?: string;
    };
  }
}

// Types for MCP server configurations
export interface MCPTool {
  name: string;
  description: string;
  parameters?: {
    name: string;
    type: string;
    description: string;
    required?: boolean;
  }[];
}

export interface MCPPrompt {
  name: string;
  description: string;
  template: string;
}

export interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  tools: MCPTool[];
  prompts: MCPPrompt[];
  url?: string; // RPC endpoint URL
  client?: any; // Store the MCP client instance
  isLoading?: boolean; // Flag to indicate if server is currently loading/refreshing
}

export interface MCPServerResult {
  serverId: string;
  result: any;
  timestamp: Date;
}

// Store for MCP servers
export const mcpServers = writable<MCPServer[]>([]);

// Store for MCP execution results
export const mcpResults = writable<MCPServerResult[]>([]);

// Define interface for HTTP API responses
interface MCPCapabilitiesResponse {
  tools?: {
    name: string;
    description: string;
    parameters?: {
      name: string;
      type: string;
      description: string;
      required?: boolean;
    }[];
  }[];
  prompts?: {
    name: string;
    description: string;
    template: string;
  }[];
}

// Check if we're running in Electron
const isElectron = () => {
  // More robust check for Electron environment
  return typeof window !== 'undefined' && 
    ((window.process && window.process.type === 'renderer') || 
     (window.electron !== undefined));
};

// Fetch MCP Server Capabilities
export async function fetchMCPCapabilities(server: MCPServer): Promise<{ tools: MCPTool[], prompts: MCPPrompt[] }> {
  console.log(`[MCPStore] Fetching capabilities for server: ${server.name} (ID: ${server.id})`);
  
  // Update the server in the store to show it's loading
  mcpServers.update(servers => 
    servers.map(s => s.id === server.id ? { ...s, isLoading: true } : s)
  );
  
    try {
    // Create a serializable version of the config for IPC
    const simpleConfig = {
          command: server.command,
          args: server.args,
          serverId: server.id
    };
    
    console.log(`[MCPStore] Using ${window.electronAPI ? 'electronAPI' : 'electron'} to fetch capabilities for server: ${server.name}`);
    let result;
        
    // First try electronAPI.fetchMCPCapabilities if available
    if (window.electronAPI && typeof window.electronAPI.fetchMCPCapabilities === 'function') {
      try {
        console.log(`[MCPStore] Calling electronAPI.fetchMCPCapabilities with:`, simpleConfig);
        result = await window.electronAPI.fetchMCPCapabilities(simpleConfig);
        console.log(`[MCPStore] Received result from electronAPI for ${server.name}:`, result);
      } catch (apiError) {
        console.error(`[MCPStore] Error in electronAPI.fetchMCPCapabilities:`, apiError);
        throw apiError;
        }
    }
    // Fallback to electron.ipcRenderer
    else if (window.electron?.ipcRenderer) {
      try {
        console.log(`[MCPStore] Calling electron.ipcRenderer.invoke('mcp:fetchCapabilities') with:`, simpleConfig);
        result = await window.electron.ipcRenderer.invoke('mcp:fetchCapabilities', simpleConfig);
        console.log(`[MCPStore] Received result from ipcRenderer for ${server.name}:`, result);
      } catch (ipcError) {
        console.error(`[MCPStore] Error in electron.ipcRenderer.invoke:`, ipcError);
        throw ipcError;
      }
    } else {
      throw new Error('No IPC method available for fetching MCP capabilities');
    }
    
    // Handle possible error from IPC result
        if (result && result.error) {
      console.error(`[MCPStore] Error in capability fetch result:`, result.error);
      throw new Error(result.error.message || 'Unknown error fetching MCP capabilities');
        }
        
    // Ensure the result is properly structured, even if empty
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    const prompts = Array.isArray(result?.prompts) ? result.prompts : [];
          
    console.log(`[MCPStore] Successfully fetched capabilities via ${window.electronAPI ? 'electronAPI' : 'electron'} for ${server.name}: `, 
      { toolsCount: tools.length, promptsCount: prompts.length });
          
    // Update server with fetched capabilities
    const updatedServer = { 
      ...server, 
      tools, 
      prompts, 
      isLoading: false 
    };
    
    // Refreshed capabilities in the store
    mcpServers.update(servers => 
      servers.map(s => s.id === server.id ? updatedServer : s)
    );
    
    console.log(`[MCPStore] Refreshed capabilities:`, { tools, prompts });
    
    // Save the updated server back to the DB
    try {
      await db.saveMCPServer(updatedServer);
      console.log(`[MCPStore] Successfully refreshed and saved MCP capabilities`);
    } catch (dbError) {
      console.error(`[MCPStore] Error saving updated server capabilities to DB:`, dbError);
      // Continue anyway, as the in-memory store is updated
    }
    
    return { tools, prompts };
  } catch (error) {
    console.error(`[MCPStore] Error fetching MCP capabilities for server ${server.name}:`, error);
    
    // Update the server in the store to show it's no longer loading
    mcpServers.update(servers => 
      servers.map(s => s.id === server.id ? { ...s, isLoading: false } : s)
    );
    
    throw error;
  }
}

// Fetch capabilities using HTTP
async function fetchMCPCapabilitiesViaHttp(url: string): Promise<{ tools: MCPTool[], prompts: MCPPrompt[] }> {
  try {
    // Call tools/list RPC endpoint
    const toolsResponse = await fetch(`${url}/tools/list`);
    if (!toolsResponse.ok) throw new Error(`Failed to fetch tools: ${toolsResponse.statusText}`);
    const toolsData = await toolsResponse.json() as MCPCapabilitiesResponse;

    // Call prompts/list RPC endpoint
    const promptsResponse = await fetch(`${url}/prompts/list`);
    if (!promptsResponse.ok) throw new Error(`Failed to fetch prompts: ${promptsResponse.statusText}`);
    const promptsData = await promptsResponse.json() as MCPCapabilitiesResponse;

    // Convert the response to the expected format
    return { 
      tools: (toolsData.tools || []).map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      })),
      prompts: (promptsData.prompts || []).map(prompt => ({
        name: prompt.name,
        description: prompt.description || '',
        template: prompt.template || ''
      }))
    };
  } catch (error) {
    console.error('[MCPStore] Error fetching MCP capabilities via HTTP:', error);
    throw error;
  }
}

// Define a type for the expected error structure from the API
interface ApiErrorResponse {
  error?: {
    message?: string;
    // Add other potential error fields if needed
  };
}

// Improved cleanup function with more aggressive filtering
export async function cleanupMCPServers() {
  console.log('[MCPStore] Starting aggressive MCP server cleanup...');
  
  try {
    // Get all current servers from database
    const allServers = await db.getAllMCPServers();
    console.log(`[MCPStore] Retrieved ${allServers.length} servers from database for cleanup`);
    
    // Find unique servers by name - keep only the most recent valid one
    const serverMap = new Map<string, MCPServer>();
    
    // More aggressive filtering criteria
    const isValidServer = (server: any): boolean => {
      if (!server || typeof server.name !== 'string' || !Array.isArray(server.args)) {
        return false;
      }
      
      // Check if the name is valid (not containing logs, errors, debug info)
      const invalidPatterns = [
        '[ChatStore]', 'Error:', 'chatStore.ts', 'mcpStore.ts', 'Saved chat', 
        'Approve clicked', 'status:', 'handleApprove', 'bubble_event', 
        'window.fetch', '@', 'function', 'Cannot find module'
      ];
      
      for (const pattern of invalidPatterns) {
        if (server.name.includes(pattern)) {
          return false;
        }
      }
      
      // Name should be reasonably short for a valid server name
      if (server.name.length > 50) {
        return false;
      }
      
      // Command should be simple and reasonable
      if (typeof server.command !== 'string' || server.command.length > 50) {
        return false;
      }
      
      return true;
    };
    
    // // First - purge all servers completely
    // console.log('[MCPStore] Deleting all existing MCP servers from database...');
    // for (const server of allServers) {
    //   await db.deleteMCPServer(server.id);
    // }
    
    // Get only the valid servers
    const validServers = allServers.filter(isValidServer);
    console.log(`[MCPStore] Found ${validServers.length} valid servers out of ${allServers.length} total`);
    
    // Second pass - organize by name, keeping the most recent one
    validServers.forEach(server => {
      // If we already have this server name, only keep the newer one (by ID which is timestamp)
      if (serverMap.has(server.name)) {
        const existing = serverMap.get(server.name)!;
        const existingId = parseInt(existing.id) || 0;
        const newId = parseInt(server.id) || 0;
        
        if (newId > existingId) {
          serverMap.set(server.name, server);
        }
      } else {
        serverMap.set(server.name, server);
      }
    });
    
    // Get the clean list
    const cleanedServers = Array.from(serverMap.values());
    console.log(`[MCPStore] Cleanup completed: keeping ${cleanedServers.length} unique valid servers`);
    
    // Re-add only the clean servers
    for (const server of cleanedServers) {
      await db.saveMCPServer(server);
      console.log(`[MCPStore] Restored valid server: ${server.name}`);
    }
    
    // Update the store with clean servers
    mcpServers.set(cleanedServers);
    
    console.log('[MCPStore] MCP server aggressive cleanup completed successfully');
    return cleanedServers.length;
  } catch (error) {
    console.error('[MCPStore] Error during MCP server cleanup:', error);
    throw error;
  }
}

// Add a function to directly purge all MCP servers, which you can call manually if needed
export async function purgeAllMCPServers() {
  console.log('[MCPStore] PURGING ALL MCP SERVERS...');
  
  try {
    // Get all current servers from database
    const allServers = await db.getAllMCPServers();
    console.log(`[MCPStore] Retrieved ${allServers.length} servers to purge`);
    
    // Delete them all
    for (const server of allServers) {
      await db.deleteMCPServer(server.id);
    }
    
    // Clear the store
    mcpServers.set([]);
    
    console.log('[MCPStore] All MCP servers have been purged');
    return true;
  } catch (error) {
    console.error('[MCPStore] Error during MCP server purge:', error);
    throw error;
  }
}

// Modify loadMCPServers to filter out invalid entries
export async function loadMCPServers() {
  console.log('[MCPStore] Attempting to load MCP servers from DB...');
  
  // Use the db.ping method from the imported db object
  try {
    const dbReady = await db.ping().catch(() => false);
    if (!dbReady) {
      console.warn('[MCPStore] Database does not appear to be ready. Will retry in 500ms...');
      // Wait and retry once
      await new Promise(resolve => setTimeout(resolve, 500));
      const retryReady = await db.ping().catch(() => false);
      if (!retryReady) {
        console.error('[MCPStore] Database still not ready after retry');
      }
    }
  } catch (pingError) {
    console.warn('[MCPStore] Error checking DB readiness:', pingError);
  }
  
  try {
    const servers = await db.getAllMCPServers();
    
    // Filter out any invalid servers or error logs saved as servers
    const validServers = servers.filter(server => 
      server && 
      typeof server.name === 'string' && 
      !server.name.includes('[ChatStore]') && 
      !server.name.includes('Error:') &&
      Array.isArray(server.args)
    ).map(server => ({
      ...server,
      // Ensure each server has a tools array, default to a single tool with the server name
      tools: server.tools || [{
        name: server.name,
        description: `Default tool for ${server.name} server`
      }]
    }));
    
    console.log(`[MCPStore] Loaded ${validServers.length} valid MCP servers from DB (filtered out ${servers.length - validServers.length} invalid entries)`);
    
    // CRITICAL: Make a deep copy before setting store
    const serversCopy = validServers.map(s => ({...s}));
    mcpServers.set(serversCopy);
    console.log('[MCPStore] mcpServers store updated with valid data:', serversCopy);
    
    // Return for chainability and to allow checking success
    return validServers.length > 0;
  } catch (error) {
    console.error('[MCPStore] Error loading MCP servers:', error);
    mcpServers.set([]); // Set to empty on error
    return false;
  }
}

// Add a new MCP server
export async function addMCPServer(server: Omit<MCPServer, 'id'>) {
  let tools: MCPTool[] = [];
  let prompts: MCPPrompt[] = [];
  
  const newServer: MCPServer = {
    ...server,
    id: Date.now().toString(),
    tools: [],
    prompts: [],
    isLoading: true
  };
  
  // Add the server first so UI can show loading state
  console.log('[MCPStore] Adding new MCP server:', newServer);
  mcpServers.update(servers => [...servers, newServer]);
  
  try {
    // Try to fetch capabilities
    try {
      console.log('[MCPStore] Fetching capabilities for new server');
      const capabilities = await fetchMCPCapabilities(newServer);
      tools = capabilities.tools;
      prompts = capabilities.prompts;
      console.log('[MCPStore] Fetched capabilities:', { tools, prompts });
    } catch (error) {
      console.warn('[MCPStore] Failed to fetch capabilities:', error);
    }
    
    // Update the server with fetched capabilities
    const updatedServer: MCPServer = {
      ...newServer,
      tools: tools.length > 0 ? tools : [{
        name: server.name,
        description: `Default tool for ${server.name} server`
      }],
      prompts: prompts,
      isLoading: false
    };
    
    // Update the store
    mcpServers.update(servers => 
      servers.map(s => s.id === newServer.id ? updatedServer : s)
    );
    
    // Save to database
    console.log('[MCPStore] Saving new MCP server to DB...');
    await db.saveMCPServer(updatedServer);
    console.log('[MCPStore] New MCP server saved to DB.');
    
    return updatedServer;
  } catch (error) {
    console.error('[MCPStore] Error during MCP server addition:', error);
    
    // Update the server to show it's no longer loading but has no capabilities
    mcpServers.update(servers => 
      servers.map(s => s.id === newServer.id ? {
        ...newServer,
        isLoading: false,
        tools: [{
          name: server.name,
          description: `Default tool for ${server.name} server`
        }],
        prompts: []
      } : s)
    );
    
    throw error;
  }
}

// Refresh MCP server capabilities
export async function refreshMCPCapabilities(serverId: string): Promise<boolean> {
  console.log(`[MCPStore] Refreshing capabilities for server ID: ${serverId}`);
  
  // Find the server in the store
    const servers = get(mcpServers);
  const serverToRefresh = servers.find(s => s.id === serverId);
  
  if (!serverToRefresh) {
    console.error(`[MCPStore] Server with ID ${serverId} not found in store`);
    throw new Error(`Server with ID ${serverId} not found`);
  }
  
  try {
    // Use the fetchMCPCapabilities function to refresh
    await fetchMCPCapabilities(serverToRefresh);
    
    // Since fetchMCPCapabilities updates the store internally, we don't need to do it again
    console.log(`[MCPStore] Successfully refreshed capabilities for server ${serverToRefresh.name}`);
    return true;
  } catch (error) {
    console.error(`[MCPStore] Error refreshing capabilities for server ${serverToRefresh.name}:`, error);
    throw error;
  }
}

// Update an existing MCP server
export async function updateMCPServer(server: MCPServer) {
  console.log('[MCPStore] Updating MCP server:', server); // Log update
  mcpServers.update(servers => 
    servers.map(s => s.id === server.id ? server : s)
  );
  
  try {
    console.log('[MCPStore] Saving updated MCP server to DB...'); // Log DB save attempt
    await db.saveMCPServer(server); // Use save for add/update
    console.log('[MCPStore] Updated MCP server saved to DB.'); // Log success
  } catch (error) {
    console.error('[MCPStore] Error updating MCP server in DB:', error);
  }
}

// Delete an MCP server
export async function deleteMCPServer(id: string) {
  mcpServers.update(servers => servers.filter(s => s.id !== id));
  
  try {
    await db.deleteMCPServer(id);
  } catch (error) {
    console.error('Error deleting MCP server:', error);
  }
}

// Store MCP execution result
export function storeMCPResult(result: MCPServerResult) {
  mcpResults.update(results => [...results, result]);
}

// Execute MCP server
export async function executeMCPServer(serverName: string, args: string[] = []): Promise<any> {
  console.log(`[MCPStore] Attempting MCP execution for server "${serverName}" with args:`, args);
  
  try {
    // Get all servers first to ensure the store is filled
    let currentServers = get(mcpServers);
    
    // If the store is empty, try to load from DB directly
    if (currentServers.length === 0) {
      console.log(`[MCPStore] Store is empty, trying to load servers from DB directly`);
      try {
        await db.init(); // Ensure DB is initialized
        const dbServers = await db.getAllMCPServers();
        if (dbServers && dbServers.length > 0) {
          console.log(`[MCPStore] Found ${dbServers.length} servers in DB`);
          currentServers = dbServers;
          // Update the store with these servers
          mcpServers.set(dbServers);
        }
      } catch (dbError) {
        console.error(`[MCPStore] Error loading servers from DB:`, dbError);
      }
    }
    
    // Get the full server configuration from the store or the loaded DB data
    let serverConfig = currentServers.find(s => s.name === serverName && s.enabled);
    
    if (!serverConfig) {
      console.error(`[MCPStore] No enabled server found with name "${serverName}" in mcpStore. Available servers:`, 
        currentServers.map(s => ({ name: s.name, enabled: s.enabled })));
      throw new Error(`Enabled server configuration for "${serverName}" not found in mcpStore.`);
    }

    // Make a clean copy of the config to avoid circular references and non-serializable fields
    const cleanConfig = {
      id: serverConfig.id,
      name: serverConfig.name,
      command: serverConfig.command,
      args: serverConfig.args,
      enabled: serverConfig.enabled,
      tools: [], // Empty arrays to satisfy the type checker
      prompts: []
    } as MCPServer;

    // Validate the tool exists within the found server config (as a safety check)
    const toolName = args[0];
    
    // We still check if the tool exists in our server config as a safety precaution
    // But we don't send the entire tools array to the main process
    const toolExists = serverConfig.tools?.some(t => t.name === toolName);
    if (!toolExists) {
      console.warn(`[MCPStore] Tool "${toolName}" not found in configuration for server "${serverName}". Available tools:`, 
        serverConfig.tools?.map(t => t.name) || []);
      // Continue anyway - the main process might handle the tool even if it's not in our config
    }

    console.log(`[MCPStore] Using server config:`, cleanConfig);
    console.log(`[MCPStore] Sending execution request via IPC with args:`, args);

    // Execute via Electron IPC, passing the clean server config and the user args
    if (window.electronAPI && typeof window.electronAPI.executeMCP === 'function') {
      console.log(`[MCPStore] Executing via electronAPI.executeMCP`);
      try {
        // Pass clean server config and args
        const result = await window.electronAPI.executeMCP(cleanConfig, args);

        if (result && result.error) {
        console.error('[MCPStore] Error received from main process executeMCP:', result.error);
        throw new Error(result.error.message || 'Unknown error executing MCP via electronAPI');
      }

      console.log('[MCPStore] MCP execution successful via electronAPI. Result:', result);
      
        // Store result locally if needed
        if (result && result.output) {
      const resultEntry: MCPServerResult = {
        serverId: serverConfig.id,
            result: result.output,
        timestamp: new Date()
      };
      mcpResults.update(results => [resultEntry, ...results]);
        }

      return result; // Return the full result object from main
      } catch (execError) {
        console.error('[MCPStore] Error in electronAPI.executeMCP:', execError);
        throw execError;
      }
    }

    // Fallback to electron.ipcRenderer if available 
    if (window.electron?.ipcRenderer) {
      console.warn('[MCPStore] Using fallback electron.ipcRenderer.invoke for mcp:execute');
      try {
        // Correctly call invoke with clean config
        const result = await window.electron.ipcRenderer.invoke('mcp:execute', cleanConfig, args);

        if (result && result.error) {
          console.error('[MCPStore] Error received from main process mcp:execute (ipcRenderer):', result.error);
        throw new Error(result.error.message || 'Unknown error executing MCP via ipcRenderer');
      }
      
      console.log('[MCPStore] MCP execution successful via ipcRenderer. Result:', result);

      // Store result locally
        if (result && result.output) {
      const resultEntry: MCPServerResult = {
        serverId: serverConfig.id,
            result: result.output,
        timestamp: new Date()
      };
      mcpResults.update(results => [resultEntry, ...results]);
        }

      return result;
      } catch (execError) {
        console.error('[MCPStore] Error in electron.ipcRenderer.invoke:', execError);
        throw execError;
      }
    }

    throw new Error('No IPC method available to execute MCP. Check preload script and main process setup.');
  } catch (error) {
    console.error(`[MCPStore] Error during MCP server execution for "${serverName}":`, error);
    // Re-throw the error so the calling function (in chatStore) can handle it
    throw error;
  }
}

// Get system prompt for MCP servers
export function getMCPSystemPrompt(): string {
  const servers = get(mcpServers);
  let prompt = "Available MCP servers and their tools:\n\n";

  servers.forEach(server => {
    if (server.enabled && server.tools?.length) {
      prompt += `<mcp name="${server.name}">
       Command: ${server.command}
       Args: ${server.args.join(' ')}
       Tools:
       ${server.tools.map(tool => `        <tool name="${tool.name}">${tool.description || ''}</tool>`).join('\n      ')}
     </mcp>\n\n`;
    }
  });

  prompt += `
When a user's request requires using one of these tools:
1. I will respond with an XML tag indicating the tool to use:
   <mcp_call>
     <server>tool_name</server>
     <args>arg1 arg2 ...</args>
     <tool>tool name</tool>
   </mcp_call>

2. Wait for tool execution approval
3. After execution, I will process the result and provide a helpful response

If no tool is needed, I will respond directly without any XML tags.`;

  return prompt;
}

// Initialize the MCP store
async function initMCPStore() {
  console.log('[MCPStore] Initializing MCP store...');
  
  try {
    // Initialize the database first
    await db.init();
    
    // Load servers with a retry mechanism
    let loaded = false;
    let retries = 0;
    const maxRetries = 3;
    
    while (!loaded && retries < maxRetries) {
      try {
        console.log(`[MCPStore] Loading MCP servers (attempt ${retries + 1}/${maxRetries})...`);
        loaded = await loadMCPServers();
        
        if (loaded) {
          console.log('[MCPStore] Successfully loaded MCP servers');
        } else {
          console.warn(`[MCPStore] No servers loaded, will retry in 1s (attempt ${retries + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (loadError) {
        console.error(`[MCPStore] Error loading MCP servers (attempt ${retries + 1}/${maxRetries}):`, loadError);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      retries++;
    }
    
    if (!loaded) {
      console.warn('[MCPStore] Failed to load MCP servers after multiple attempts');
    }
  } catch (error) {
    console.error('[MCPStore] Error initializing MCP store:', error);
      }
}

// Auto-initialize when this module is imported
initMCPStore();