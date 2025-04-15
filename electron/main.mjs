import { app, BrowserWindow, ipcMain, session, protocol } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createJsonRpcRequest, parseJsonRpcResponse } from './mcp-types.js';
import url from 'url';
import fs from 'fs';
import os from 'os';

// STARTUP FLAG - This helps identify which main file is being executed
console.log('===== STARTING ELECTRON APP USING main.mjs =====');
console.log('If you see this message, electron is correctly using main.mjs and not main.cjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fix isDev detection - use environment variable if set, otherwise check if app is packaged
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Get the path to the favicon
const iconPath = isDev 
  ? path.join(process.cwd(), 'static', 'favicon.png')
  : path.join(process.resourcesPath, 'static', 'favicon.png');

// Register file scheme as privileged to allow access to APIs like localStorage
// This needs to be done BEFORE app is ready
protocol.registerSchemesAsPrivileged([
	{ scheme: 'file', privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true } }
]);

// --- Helper function to decode HTML entities ---
function decodeHTMLEntities(text) {
  if (typeof text !== 'string') return '';
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    // Add more entities if needed based on observed DDG results
  };
  // Strip common HTML tags found in snippets and decode entities
  return text.replace(/<b>|<\/b>/g, '').replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, match => entities[match] || match);
}

// --- Helper function to convert HTML to plain text ---
function htmlToText(html) {
  // Simple HTML to text conversion similar to the one in search.ts
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// --- Helper function to fetch web content using BrowserWindow ---
async function fetchWebContent(targetUrl) {
  console.log(`[Main Process] Fetching web content from: ${targetUrl}`);
  
  return new Promise((resolve, reject) => {
    // Create an invisible browser window to load the content
    const offscreenWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        offscreen: true,
        javascript: true,
        images: false, // Don't load images to speed up loading
        webgl: false,
        paintWhenInitiallyHidden: true,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Set a timeout in case loading takes too long
    const timeoutId = setTimeout(() => {
      if (!offscreenWindow.isDestroyed()) {
        offscreenWindow.destroy();
      }
      reject(new Error(`Timeout loading: ${targetUrl}`));
    }, 30000); // 30 second timeout

    // Set user agent to a mobile device to get mobile-friendly content
    offscreenWindow.webContents.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
    );

    // Listen for page load to complete
    offscreenWindow.webContents.on('did-finish-load', async () => {
      try {
        // Get the HTML content of the page with a more reliable method
        const html = await offscreenWindow.webContents.executeJavaScript(`
          document.documentElement.outerHTML;
        `);
        
        // Extract meaningful content from the HTML - focus on main content areas
        const extractedContent = await offscreenWindow.webContents.executeJavaScript(`
          // Try to extract main content with common selectors
          const mainContent = document.querySelector('main') || 
                          document.querySelector('article') || 
                          document.querySelector('#content') ||
                          document.querySelector('.content') ||
                          document.querySelector('#main') ||
                          document.body;
          
          // Get text content - prioritize innerText over textContent for more readable results
          mainContent ? mainContent.innerText : document.body.innerText;
        `);
        
        // Use the extracted content if available, otherwise fall back to full HTML conversion
        let textContent;
        if (extractedContent && extractedContent.length > 100) {
          // Clean up the extracted content, similar to defuddle
          textContent = extractedContent
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100000); // Limit to 100KB max
          
          console.log(`[Main Process] Using extracted text content (${textContent.length} chars)`);
        } else {
          // Convert full HTML to text as fallback
          textContent = htmlToText(html).slice(0, 100000); // Limit to 100KB max
          console.log(`[Main Process] Using full HTML conversion (${textContent.length} chars)`);
        }
        
        // Make sure the content isn't too huge (LLM context limits)
        if (textContent.length > 16000) {
          console.log(`[Main Process] Truncating long content from ${textContent.length} to 16000 chars`);
          textContent = textContent.slice(0, 16000) + "... [Content truncated due to length]";
        }
        
        // Clean up
        clearTimeout(timeoutId);
        offscreenWindow.destroy();
        
        console.log(`[Main Process] Successfully fetched content from ${targetUrl} (${textContent.length} chars)`);
        resolve({
          content: textContent,
          error: null,
          url: targetUrl
        });
      } catch (error) {
        clearTimeout(timeoutId);
        if (!offscreenWindow.isDestroyed()) {
          offscreenWindow.destroy();
        }
        console.error(`[Main Process] Error extracting content from ${targetUrl}:`, error);
        reject(error);
      }
    });

    // Handle page load failure
    offscreenWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      clearTimeout(timeoutId);
      if (!offscreenWindow.isDestroyed()) {
        offscreenWindow.destroy();
      }
      console.error(`[Main Process] Failed to load ${targetUrl}: ${errorDescription} (${errorCode})`);
      reject(new Error(`Failed to load page: ${errorDescription} (${errorCode})`));
    });

    // Start loading the URL
    offscreenWindow.loadURL(targetUrl).catch(error => {
      clearTimeout(timeoutId);
      if (!offscreenWindow.isDestroyed()) {
        offscreenWindow.destroy();
      }
      console.error(`[Main Process] Error loading ${targetUrl}:`, error);
      reject(error);
    });
  });
}

// --- Helper function to perform DuckDuckGo search ---
async function performDuckDuckGoSearch(query) {
  console.log(`[Main Process] Performing DDG search for: ${query}`);
  if (!query) {
    // Return structure similar to the original API
    return { results: [], query, error: 'Query parameter is required' };
  }

  try {
    const searchUrl = new URL('https://duckduckgo.com/html');
    searchUrl.searchParams.append('q', query);
    searchUrl.searchParams.append('kl', 'wt-wt'); // Keep region neutral

    // Use global fetch available in Electron main process
    const response = await fetch(searchUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      signal: AbortSignal.timeout(10000) // Add timeout
    });

    if (!response.ok) {
      console.error(`[Main Process] DDG request failed: ${response.status} ${response.statusText}`);
      throw new Error(`DuckDuckGo request failed with status ${response.status}`);
    }

    const html = await response.text();

    // Use the regex from the original API file
    const resultRegex = /<h2 class="result__title">.*?<a rel="nofollow" class="result__a" href="(.*?)".*?>(.*?)<\/a>.*?<a class="result__snippet".*?>(.*?)<\/a>/gs;

    const results = [];
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 4) { // Limit results
      const rawUrl = match[1];
      const rawTitle = match[2];
      const rawSnippet = match[3];

      // Filter out DDG's own JS links or potentially problematic URLs
      if (!rawUrl.startsWith('https://duckduckgo.com/y.js')) {
         let actualUrl = rawUrl;
         try {
             // Attempt to extract the real URL from DDG's redirect links
             const parsedUrl = new URL(rawUrl);
             if ((parsedUrl.hostname === 'duckduckgo.com' || parsedUrl.hostname === 'www.duckduckgo.com') && parsedUrl.pathname === '/l/') {
                 actualUrl = parsedUrl.searchParams.get('uddg') || rawUrl;
             }
         } catch (e) { /* Ignore invalid URLs during parsing */ }

         // Only add if URL looks somewhat valid (basic check)
         if (actualUrl && (actualUrl.startsWith('http:') || actualUrl.startsWith('https:'))) {
            results.push({
                title: decodeHTMLEntities(rawTitle.trim()),
                url: actualUrl,
                description: decodeHTMLEntities(rawSnippet.trim())
            });
         }
       }
    }

    console.log(`[Main Process] DDG search successful, found ${results.length} results.`);
    return { results, query, error: null }; // Match API response structure
  } catch (error) {
    console.error('[Main Process] DDG search error:', error);
    // Match API error structure
    return { results: [], query, error: `Failed to perform search: ${error.message}` };
  }
}

// Store for active MCP server processes (keyed by server ID or a unique identifier if needed)
// We no longer need the mcpServers Map here, config comes from renderer.
const serverProcesses = new Map();

// Function to spawn an MCP server process
async function spawnMCPServer(serverConfig, serverId) { // Pass full config
    const uniqueKey = serverId || serverConfig.name; // Use ID if available, else name
    
    // If server is already running, return existing process
    if (serverProcesses.has(uniqueKey)) {
        console.log(`[Main Process] MCP server ${uniqueKey} already running`);
        return serverProcesses.get(uniqueKey); // Return existing process
    }

    console.log(`[Main Process] Spawning MCP server: ${serverConfig.name} with command: ${serverConfig.command} ${serverConfig.args.join(' ')}`);
    console.log(`[Main Process] Current app directory: ${app.getAppPath()}`);
    console.log(`[Main Process] Current __dirname: ${__dirname}`);
    console.log(`[Main Process] Is development mode: ${isDev}`);
    console.log(`[Main Process] User data directory: ${app.getPath('userData')}`);
    
    try {
        // Import the MCP bridge functionality for spawning processes
        // This ensures we use the same code path for both capabilities fetch and execution
        const { spawnMCPProcess } = await import('./mcp-bridge.mjs');
        
        console.log(`[Main Process] Using bridge's spawnMCPProcess to ensure consistent Node handling`);
        
        // Use the bridge function to handle all the path resolution and Node/Electron logic
        const serverProcess = await spawnMCPProcess(serverConfig.command, serverConfig.args);
        
        // Store the process
        serverProcesses.set(uniqueKey, serverProcess);

        // Log server output
        serverProcess.stdout.on('data', (data) => {
            const dataStr = data.toString().trim();
            console.log(`[${serverConfig.name}] stdout: ${dataStr}`);
        });

        serverProcess.stderr.on('data', (data) => {
            const dataStr = data.toString().trim();
            console.error(`[${serverConfig.name}] stderr: ${dataStr}`);
        });

        serverProcess.on('error', (error) => {
            console.error(`[${serverConfig.name}] process error:`, error);
        });

        serverProcess.on('exit', (code, signal) => {
            console.log(`[${serverConfig.name}] process exited with code ${code} and signal ${signal}`);
            serverProcesses.delete(uniqueKey);
        });

        return serverProcess;
    } catch (error) {
        console.error(`[Main Process] Failed to spawn MCP server ${serverConfig.name}:`, error);
        throw error;
    }
}

// Keep a global reference of the window object to prevent garbage collection
let mainWindow = null;

async function loadApp(win, attempt = 1) {
    const maxAttempts = 5;
    
    try {
        if (isDev) {
            // Development - load from dev server
            console.log('[Electron] Loading development server...');
            await win.loadURL('http://localhost:5173');
            win.webContents.openDevTools();
            console.log('[Electron] Dev server loaded successfully');
        } else {
            // Production - load from built files with better path handling
            console.log(`[Electron] Loading app in production mode (attempt ${attempt}/${maxAttempts})`);
            
            // Construct the path to index.html relative to the app's root when packaged
            const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath();
            const indexPath = path.join(basePath, 'app', 'build', 'index.html'); // Standard electron-builder structure

            console.log(`[Electron] Attempting to load index.html from: ${indexPath}`);

            if (!fs.existsSync(indexPath)) {
                 console.error(`[Electron] index.html not found at ${indexPath}. Trying alternative paths...`);
                 const possiblePaths = [
                     path.join(app.getAppPath(), 'build', 'index.html'), // Older structure?
                     path.join(app.getAppPath(), 'index.html'),
                     path.join(process.resourcesPath, 'app.asar', 'build', 'index.html'),
                     path.join(__dirname, '..', 'build', 'index.html')
                 ];
                 let found = false;
                 for(const p of possiblePaths) {
                     if(fs.existsSync(p)) {
                         indexPath = p;
                         found = true;
                         console.log(`[Electron] Found index.html at fallback path: ${indexPath}`);
                         break;
                     }
                 }
                 if(!found) {
                     console.error('[Electron] Could not find index.html in any expected location.');
                      // Try listing common directories for clues
                     const dirsToList = [
                         path.join(basePath, 'app'),
                         path.join(basePath, 'app', 'build'),
                         path.join(app.getAppPath(), 'build'),
                         process.resourcesPath,
                         app.getAppPath()
                     ].filter(dir => fs.existsSync(dir));

                     for (const dir of dirsToList) {
                        try {
                            const files = fs.readdirSync(dir);
                            console.log(`[Electron Debug] Contents of ${dir}:`, files.join(', '));
                        } catch (e) { console.log(`[Electron Debug] Cannot read ${dir}: ${e.message}`); }
                     }
                     throw new Error(`Failed to find index.html. Check build output and path: ${indexPath}`);
                 }
            }
            
            win.webContents.openDevTools(); // Keep DevTools open for debugging prod issues
            console.log(`[Electron] Loading file: ${indexPath}`);
            await win.loadFile(indexPath);
            console.log('[Electron] Production build loaded successfully');
        }
    } catch (err) {
        console.error(`[Electron] Failed to load app (attempt ${attempt}/${maxAttempts}):`, err);
        // Keep DevTools open on failure
        if (!win.webContents.isDevToolsOpened()) {
            win.webContents.openDevTools();
        }
        
        if (attempt < maxAttempts) {
            // Wait 1 second before retrying
            console.log(`[Electron] Retrying in 1 second (attempt ${attempt}/${maxAttempts})...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return loadApp(win, attempt + 1);
        } else {
            console.error('[Electron] Max load attempts reached, giving up');
            throw err;
        }
    }
}

// Function to handle MCP execution - Refactored to use SDK Client
async function handleMCPExecute(event, serverConfig, userArgs) { // Receive full serverConfig
    const serverName = serverConfig.name;
    const serverId = serverConfig.id;
    let client;

    try {
        console.log(`[Main Process] MCP Execute request received for server: ${serverName}`, { 
            serverConfig: JSON.stringify({
                id: serverConfig.id,
                name: serverConfig.name,
                command: serverConfig.command,
                args: serverConfig.args,
            }), 
            userArgs 
        });
        
        if (!serverConfig || !serverConfig.command) {
            throw new Error(`Invalid server configuration received for server: ${serverName}`);
        }

        // Additional validation for args
        if (!serverConfig.args || !Array.isArray(serverConfig.args)) {
            console.warn(`[Main Process] Server args is not an array, fixing:`, serverConfig.args);
            serverConfig.args = serverConfig.args ? [serverConfig.args] : [];
        }

        console.log(`[Main Process] MCP Execute validated config:`, {
            id: serverId,
            name: serverName,
            command: serverConfig.command,
            args: serverConfig.args.join(' ')
        });

        // Instead of managing the process ourselves, use getOrCreateClient from mcp-bridge
        // This ensures consistent handling of node/electron across both execution and capabilities
        try {
            // Import the bridge functions
            const { getOrCreateClient } = await import('./mcp-bridge.mjs');
            
            console.log(`[Main Process] Using getOrCreateClient for MCP execution - same as capabilities`);
            const connection = await getOrCreateClient(serverConfig.command, serverConfig.args, serverId);
            client = connection.client;
            
            console.log(`[Main Process] Successfully connected to MCP server`);
        } catch (connectionError) {
            console.error(`[Main Process] Error connecting to MCP server:`, connectionError);
            throw new Error(`Failed to connect to MCP server: ${connectionError.message}`);
        }

        // 4. Prepare Tool Call arguments
        const toolName = userArgs[0]; 
        const toolArgs = userArgs.slice(1);
        let argumentsForServer = {}; // Default to empty object
        
        // Properly format arguments based on tool requirements
        if (toolArgs.length > 0) {
            console.log(`[Main Process] Formatting arguments for tool ${toolName}:`, toolArgs);
            
            // For Ethereum tools, most take a single address parameter
            if (toolName === 'mcp_eth_getCode' || toolName === 'mcp_eth_getBalance') {
                argumentsForServer = { address: toolArgs[0] };
                if (toolArgs.length > 1) {
                    argumentsForServer.blockParameter = toolArgs[1];
                }
            } else if (toolName === 'mcp_eth_gasPrice') {
                // eth_gasPrice doesn't take arguments
                argumentsForServer = { random_string: "dummy" };
            } else if (toolName === 'mcp_rust_docs_lookup_crate_docs') {
                // Rust docs tool takes a crateName parameter
                argumentsForServer = { crateName: toolArgs.join(' ').replace(/^with\s+/, '') };
            } else if (toolArgs.length === 1) {
                // For single-argument tools, try to parse as JSON if possible
                try {
                    const parsed = JSON.parse(toolArgs[0]);
                    argumentsForServer = parsed;
                } catch (e) {
                    // Not JSON, use directly
                    argumentsForServer = toolArgs[0];
                }
            } else {
                // For multiple arguments, use an array
                argumentsForServer = { args: toolArgs }; 
            }
        } 
        
        console.log(`[Main Process] Calling tool '${toolName}' via SDK client with args:`, argumentsForServer);
        
        // 5. Call Tool using the client - use request method directly, similar to capabilities
        let result;
        try {
            // Call the tool using the same request pattern as handleFetchMCPCapabilities
            result = await client.request({
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: argumentsForServer,
                    _meta: {
                        progressToken: Date.now().toString()
                    }
                }
            });
            
            console.log(`[Main Process] Tool call successful:`, result);
        } catch (toolCallError) {
            console.error(`[Main Process] Error calling tool ${toolName}:`, toolCallError);
            throw new Error(`Tool execution error: ${toolCallError.message}`);
        }

        // 7. Format and return result
        // Handle different result formats
        let formattedResult;
        if (typeof result === 'object' && result !== null) {
            if (result.content) {
                // Standard MCP format
                formattedResult = { 
                    output: [{ text: result.content, type: 'text' }],
                    error: null,
                    serverId
                };
            } else {
                // Handle raw result object
                formattedResult = {
                    output: [{ text: JSON.stringify(result), type: 'text' }],
                    error: null,
                    serverId
                };
            }
        } else {
            // Handle primitive result types
            formattedResult = {
                output: [{ text: String(result), type: 'text' }],
                error: null,
                serverId
            };
        }

        console.log(`[Main Process] Formatted result for renderer:`, formattedResult);
        return formattedResult;
    } catch (error) {
        console.error(`[Main Process] MCP execution error for server ${serverName}:`, error);
        return {
            output: null,
            error: {
                message: error?.message || 'Unknown error during MCP execution via SDK Client',
                stack: error?.stack
            },
            serverId 
        };
    }
}

// Clean up function for server processes
async function cleanupServers() {
    console.log('[Main Process] Cleaning up MCP server processes...');
    for (const [key, process] of serverProcesses.entries()) {
        console.log(`[Main Process] Terminating server process: ${key}`);
        if (!process.killed) {
           process.kill();
        }
    }
    serverProcesses.clear();
}

// Function to handle fetching MCP capabilities
async function handleFetchMCPCapabilities(event, { command, args, serverId }) {
    let tempProcess = null;
    
    try {
        console.log(`[Main Process] Fetch MCP Capabilities request received:`, { command, args, serverId });
        
        if (!command) {
            throw new Error('Command is required to fetch MCP capabilities');
        }
        
        // Ensure args is always an array
        if (!args) {
            args = [];
            console.warn(`[Main Process] Args missing, using empty array`);
        } else if (!Array.isArray(args)) {
            args = [args];
            console.warn(`[Main Process] Args is not an array, converting to: ${args}`);
        }
        
        // Create a unique session ID for this request
        const sessionId = `session-${serverId}-${Date.now()}`;
        console.log(`[Main Process] Created session ID: ${sessionId}`);
        
        // More verbose logging for production debugging
        console.log(`[Main Process] Current app directory: ${app.getAppPath()}`);
        console.log(`[Main Process] Current __dirname: ${__dirname}`);
        console.log(`[Main Process] Is development mode: ${isDev}`);
        console.log(`[Main Process] User data directory: ${app.getPath('userData')}`);
        console.log(`[Main Process] Original command: ${command}`);
        console.log(`[Main Process] Original args: ${JSON.stringify(args)}`);
        
        // Instead of directly using spawn here, leverage our MCP bridge for consistency
        try {
            // Import the bridge functions more directly to ensure they're available
            const { getOrCreateClient } = await import('./mcp-bridge.mjs');
            
            console.log(`[Main Process] Using MCP bridge for capabilities fetch`);
            const connection = await getOrCreateClient(command, args, serverId);
            const client = connection.client;
            
            console.log(`[Main Process] Successfully connected to MCP server, fetching tools`);
            
            // Use the client to fetch tools and prompts
            let tools = [];
            try {
                const toolsResponse = await client.request({
                    method: "tools/list",
                    params: {}
                });
                
                console.log(`[Main Process] Tools response:`, toolsResponse);
                
                // Handle different response formats
                if (toolsResponse) {
                    if (Array.isArray(toolsResponse)) {
                        tools = toolsResponse;
                    } else if (Array.isArray(toolsResponse.tools)) {
                        tools = toolsResponse.tools;
                    } else if (typeof toolsResponse === 'object') {
                        // Extract tools from any object structure
                        const possibleToolsArray = Object.values(toolsResponse).find(val => Array.isArray(val));
                        if (possibleToolsArray) {
                            tools = possibleToolsArray;
                        }
                    }
                }
                
                console.log(`[Main Process] Tools fetched (${tools.length}):`, tools);
            } catch (toolError) {
                console.error(`[Main Process] Error fetching tools:`, toolError);
                // Continue with empty tools array
            }
            
            // Fetch prompts
            let prompts = [];
            try {
                const promptsResponse = await client.request({
                    method: "prompts/list",
                    params: {}
                });
                
                console.log(`[Main Process] Prompts response:`, promptsResponse);
                
                if (promptsResponse) {
                    if (Array.isArray(promptsResponse)) {
                        prompts = promptsResponse;
                    } else if (Array.isArray(promptsResponse.prompts)) {
                        prompts = promptsResponse.prompts;
                    } else if (typeof promptsResponse === 'object') {
                        const possiblePromptsArray = Object.values(promptsResponse).find(val => Array.isArray(val));
                        if (possiblePromptsArray) {
                            prompts = possiblePromptsArray;
                        }
                    }
                }
                
                console.log(`[Main Process] Prompts fetched (${prompts.length}):`, prompts);
            } catch (promptError) {
                console.error(`[Main Process] Error fetching prompts:`, promptError);
            }
            
            // We don't disconnect because we want to reuse the connection later
            
            return {
                tools: tools || [],
                prompts: prompts || [],
                error: null,
                serverId
            };
            
        } catch (bridgeError) {
            console.error(`[Main Process] Error using MCP bridge:`, bridgeError);
            throw bridgeError;
        }
    } catch (error) {
        console.error(`[Main Process] Error fetching MCP capabilities:`, error);
        
        // Clean up resources in case of error
        if (tempProcess && !tempProcess.killed) {
            tempProcess.kill();
        }
        
        return {
            tools: [],
            prompts: [],
            error: {
                message: error?.message || 'Unknown error',
                stack: error?.stack,
                serverId
            }
        };
    }
}

// Implement a function similar to search.ts fetchContentFromResults
async function fetchContentFromResults(results, depth = 2) {
  console.log(`[Main Process] Fetching content from ${results.length} results with depth=${depth}`);
  const sources = [];
  let combinedContent = '';
  let totalContentLength = 0;
  const MAX_CONTENT_LENGTH = 4000; // Same as in search.ts
  
  // Limit the number of results to process based on depth
  const resultsToProcess = results.slice(0, depth);
  console.log(`[Main Process] Processing ${resultsToProcess.length} results for content fetching`);
  
  for (const result of resultsToProcess) {
    try {
      console.log(`[Main Process] Fetching content from: ${result.url}`);
      sources.push(`[${result.title}](${result.url})`);
      
      // Fetch the content using our BrowserWindow-based function
      const contentResult = await fetchWebContent(result.url);
      const content = contentResult.content || '';
      
      // Truncate content if needed to stay within context window limits
      let processedContent = content;
      if (totalContentLength + content.length > MAX_CONTENT_LENGTH) {
        const remainingSpace = Math.max(0, MAX_CONTENT_LENGTH - totalContentLength);
        processedContent = content.substring(0, remainingSpace) + '... [Content truncated due to length]';
        console.log(`[Main Process] Content truncated to ${remainingSpace} chars to fit context window`);
      }
      
      totalContentLength += processedContent.length;
      
      // Log a preview of the content
      const contentPreview = processedContent.length > 200 ? processedContent.substring(0, 200) + '...' : processedContent;
      console.log(`[Main Process] Content fetched (${processedContent.length}/${content.length} chars): ${contentPreview}`);
      
      // Add the content to the combined result - EXACTLY as in search.ts
      combinedContent += `### Source: [${result.title}](${result.url})\n\n${processedContent}\n\n---\n\n`;
      
      // Stop processing if we've reached the maximum content length
      if (totalContentLength >= MAX_CONTENT_LENGTH) {
        console.log(`[Main Process] Reached maximum content length (${MAX_CONTENT_LENGTH}), stopping further processing`);
        break;
      }
    } catch (error) {
      console.error(`[Main Process] Error fetching content from ${result.url}:`, error);
      combinedContent += `### Source: [${result.title}](${result.url})\n\nError fetching content: ${error.message}\n\n---\n\n`;
    }
  }
  
  console.log(`[Main Process] Total content length: ${totalContentLength} chars`);
  // Log the full combined content for debugging (important for the user's request)
  console.log(`[Main Process] Full combined content for LLM:\n${combinedContent}`);
  return { content: combinedContent, sources };
}

// Register IPC handlers when the app is ready
app.whenReady().then(async () => {
    // Diagnostic - log the startup environment
    console.log('[Main Process] App starting up', {
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        execPath: process.execPath,
        cwd: process.cwd(),
        argv: process.argv,
        env: {
            NODE_ENV: process.env.NODE_ENV,
            isDev
        }
    });
    
    // --- Set up protocol handler for file:// requests (BEFORE loading app) ---
    console.log('[Main Process] Registering file protocol handler...');
    protocol.handle('file', async (request) => {
        const requestedUrl = new URL(request.url);
        const requestedPath = requestedUrl.pathname; // e.g., /api/search or /assets/index-....js or /C:/path/to/index.html

        console.log(`[Main Process] protocol.handle: Intercepted file request for: ${requestedUrl.href}`);

        // --- Handle the search API route ---
        if (requestedPath.endsWith('/api/search')) {
            console.log('[Main Process] protocol.handle: Matched /api/search route');
            const query = requestedUrl.searchParams.get('q');
            try {
                const searchResult = await performDuckDuckGoSearch(query);
                
                // Log the search result for debugging
                console.log(`[Main Process] Search results for "${query}":`, JSON.stringify(searchResult.results.map(r => r.title)));
                
                const jsonResponse = JSON.stringify(searchResult);
                return new Response(jsonResponse, {
                    status: searchResult.error ? 500 : 200, // Use 500 if search function reported an error
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (error) {
                console.error('[Main Process] protocol.handle: Uncaught error during search handling:', error);
                return new Response(JSON.stringify({ error: 'Internal server error during search' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        } 
        // --- Handle the proxy API route for fetching content ---
        else if (requestedPath.endsWith('/api/proxy')) {
            console.log('[Main Process] protocol.handle: Matched /api/proxy route');
            const targetUrl = requestedUrl.searchParams.get('url');
            
            if (!targetUrl) {
                console.error('[Main Process] protocol.handle: Missing url parameter for proxy');
                return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
                    status: 400, 
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            try {
                console.log(`[Main Process] protocol.handle: Fetching content from ${targetUrl}`);
                const contentResult = await fetchWebContent(targetUrl);
                
                // Make sure content exists and isn't empty
                if (!contentResult.content || contentResult.content.trim().length === 0) {
                    console.warn(`[Main Process] Empty content from ${targetUrl}, returning error`);
                    
                    // Log to browser console
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.executeJavaScript(`
                            console.log("[Main Process → Browser] Empty content from ${targetUrl.substring(0, 30)}...");
                        `).catch(err => console.error('[Main Process] Error logging to browser console:', err));
                    }
                    
                    return new Response(JSON.stringify({ 
                        error: 'No content could be extracted from the page',
                        url: targetUrl,
                        content: '',
                        fallback: true
                    }), {
                        status: 200, // Return 200 with empty content and fallback flag
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                
                // Return the content as JSON response - exactly matching the format expected by search.ts
                const jsonResponse = JSON.stringify({
                    content: contentResult.content,
                    url: targetUrl,
                    error: null,
                    fallback: false
                });
                
                console.log(`[Main Process] Returning proxy content, length: ${contentResult.content.length} chars`);
                
                // Log to browser console for debugging
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.executeJavaScript(`
                        console.log("[Main Process → Browser] Proxy content for ${targetUrl.substring(0, 30)}...", ${JSON.stringify(contentResult.content.substring(0, 200) + '...')});
                    `).catch(err => console.error('[Main Process] Error logging to browser console:', err));
                }
                
                return new Response(jsonResponse, {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (error) {
                console.error(`[Main Process] protocol.handle: Error fetching content from ${targetUrl}:`, error);
                
                // Log error to browser console
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.executeJavaScript(`
                        console.error("[Main Process → Browser] Error fetching proxy content:", ${JSON.stringify(error.message)});
                    `).catch(err => console.error('[Main Process] Error logging to browser console:', err));
                }
                
                return new Response(JSON.stringify({ 
                    error: `Failed to fetch content: ${error.message}`,
                    url: targetUrl,
                    content: '',
                    fallback: true
                }), {
                    status: 200, // Use 200 with error flag instead of 500 to avoid fetch failing
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }
        // --- Handle the content API route for direct content fetching ---
        else if (requestedPath.endsWith('/api/content')) {
            console.log('[Main Process] protocol.handle: Matched /api/content route');
            const targetUrl = requestedUrl.searchParams.get('url');
            
            if (!targetUrl) {
                console.error('[Main Process] protocol.handle: Missing url parameter for content');
                return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
                    status: 400, 
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            try {
                console.log(`[Main Process] protocol.handle: Fetching content from ${targetUrl}`);
                const contentResult = await fetchWebContent(targetUrl);
                
                // Make sure content exists and isn't empty
                if (!contentResult.content || contentResult.content.trim().length === 0) {
                    console.warn(`[Main Process] Empty content from ${targetUrl}, returning error`);
                    return new Response(JSON.stringify({ 
                        error: 'No content could be extracted from the page',
                        url: targetUrl,
                        content: '',
                        fallback: true
                    }), {
                        status: 200, // Return 200 with empty content and fallback flag
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                
                // Return the content as JSON response - exactly matching the format expected by search.ts
                const jsonResponse = JSON.stringify({
                    content: contentResult.content,
                    url: targetUrl,
                    error: null,
                    fallback: false
                });
                
                console.log(`[Main Process] Returning content, length: ${contentResult.content.length} chars`);
                
                // Critical: Log content to browser console via mainWindow's webContents
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.executeJavaScript(`
                        console.log("[Main Process → Browser] Content for ${targetUrl.substring(0, 30)}...", 
                        ${JSON.stringify(contentResult.content.substring(0, 200) + '...')});
                    `).catch(err => console.error('[Main Process] Error logging to browser console:', err));
                }
                
                return new Response(jsonResponse, {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (error) {
                console.error(`[Main Process] protocol.handle: Error fetching content from ${targetUrl}:`, error);
                return new Response(JSON.stringify({ 
                    error: `Failed to fetch content: ${error.message}`,
                    url: targetUrl,
                    content: '',
                    fallback: true
                }), {
                    status: 200, // Use 200 with error flag instead of 500 to avoid fetch failing
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }
        // --- Handle additional endpoint for deep research context ---
        else if (requestedPath.endsWith('/api/research')) {
            console.log('[Main Process] protocol.handle: Matched /api/research route');
            const query = requestedUrl.searchParams.get('q');
            const depthParam = requestedUrl.searchParams.get('depth') || '2';
            const breadthParam = requestedUrl.searchParams.get('breadth') || '3';
            
            const depth = parseInt(depthParam, 10);
            const breadth = parseInt(breadthParam, 10);
            
            if (!query) {
                console.error('[Main Process] protocol.handle: Missing query parameter for research');
                return new Response(JSON.stringify({ error: 'Query parameter is required' }), {
                    status: 400, 
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            try {
                console.log(`[Main Process] Research request: "${query}" with depth=${depth}, breadth=${breadth}`);
                
                // First, get search results
                const searchResults = await performDuckDuckGoSearch(query);
                
                if (!searchResults.results || searchResults.results.length === 0) {
                    console.log(`[Main Process] No search results found for research query: ${query}`);
                    // Critical: Log to browser console
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.executeJavaScript(`
                            console.log("[Research] No web results found for: ${query}");
                        `).catch(err => console.error('[Main Process] Error logging to browser console:', err));
                    }
                    
                    // Format response to match chatStore.ts expectation
                    return new Response(JSON.stringify({ 
                        context: `No search results found for: ${query}`,
                        sources: [], 
                        query 
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                
                // Log found results
                console.log(`[Main Process] Found ${searchResults.results.length} web results for: ${query}`);
                
                // Fetch content from the search results
                const { content, sources } = await fetchContentFromResults(searchResults.results, breadth);
                
                // Important: Format response to match chatStore's gatherResearchContext return type
                const responseObject = {
                    context: content,
                    sources: searchResults.results.slice(0, breadth),
                    query
                };
                
                // Important: Log the final research context that will be sent to the LLM
                console.log(`[Main Process] Research context generation complete, total length: ${content.length}`);
                console.log(`[Main Process] Sources for LLM context: ${sources.join(', ')}`);
                
                // Critical: Log the EXACT final prompt that will be sent to the LLM
                const finalLLMPrompt = `User Query: ${query}\n\nWeb Search Results:\n\n${content}`;
                console.log(`[Main Process] ====== FINAL LLM PROMPT ======\n${finalLLMPrompt}\n==============================`);
                
                // Critical: Log to browser console via mainWindow's webContents
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.executeJavaScript(`
                        console.log("[Research] Web context generation complete, total length: ${content.length}");
                        console.log("[Research] Sources:", ${JSON.stringify(sources)});
                        console.log("[Research] ====== FINAL LLM PROMPT ======");
                        console.log(${JSON.stringify(finalLLMPrompt)});
                        console.log("==============================");
                    `).catch(err => console.error('[Main Process] Error logging to browser console:', err));
                }
                
                // Return the formatted response
                return new Response(JSON.stringify(responseObject), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (error) {
                console.error('[Main Process] protocol.handle: Error during research processing:', error);
                return new Response(JSON.stringify({ 
                    context: `Research failed: ${error.message}`,
                    sources: [],
                    query
                }), {
                    status: 200, // Use 200 with error flag
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }
        else {
            // --- Fallback: Serve static files from the expected production build directory ---
            console.log(`[Main Process] protocol.handle: Serving as static file: ${requestedPath}`);
            try {
                // Determine the correct file path based on the URL
                // fileURLToPath handles platform differences (e.g., leading slash on Windows)
                let filePath = url.fileURLToPath(requestedUrl.href);

                // Security: Ensure the path doesn't try to escape the app's directory
                // Determine the root directory of the built app files
                const appBuildRoot = app.isPackaged
                    ? path.join(process.resourcesPath, 'app', 'build')
                    : path.join(__dirname, '..', 'build'); // Adjust dev path if needed

                 // Construct the expected path relative to the build root
                 // fileURLToPath might return something like /C:/.../app/build/index.html
                 // Or it might return just /assets/....js if the request URL was relative
                 // Let's try to normalize relative paths against the build root
                 if (!path.isAbsolute(filePath) || requestedPath.startsWith('/assets/')) {
                    // Assume relative path requested from index.html, resolve against build root
                    filePath = path.join(appBuildRoot, requestedPath);
                 }

                // Basic path traversal check (more robust checks might be needed)
                if (!filePath.startsWith(appBuildRoot) && !filePath.startsWith(app.getAppPath())) {
                    console.warn(`[Main Process] protocol.handle: Denying access to file outside build directory: ${filePath}`);
                    return new Response('Forbidden', { status: 403 });
                }

                console.log(`[Main Process] protocol.handle: Attempting to read file: ${filePath}`);
                const fileContents = await fs.promises.readFile(filePath);

                // Basic MIME type detection
                let mimeType = 'application/octet-stream';
                const ext = path.extname(filePath).toLowerCase();
                if (ext === '.html' || ext === '.htm') mimeType = 'text/html';
                else if (ext === '.js' || ext === '.mjs') mimeType = 'application/javascript';
                else if (ext === '.css') mimeType = 'text/css';
                else if (ext === '.json') mimeType = 'application/json';
                else if (ext === '.png') mimeType = 'image/png';
                else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
                else if (ext === '.gif') mimeType = 'image/gif';
                else if (ext === '.svg') mimeType = 'image/svg+xml';
                else if (ext === '.woff2') mimeType = 'font/woff2';
                // Add more common types

                console.log(`[Main Process] protocol.handle: Serving ${filePath} with MIME type ${mimeType}`);
                return new Response(fileContents, {
                    status: 200,
                    headers: { 'Content-Type': mimeType }
                });

            } catch (error) {
                console.error(`[Main Process] protocol.handle: Error serving file ${requestedUrl.href} (Resolved: ${filePath}):`, error);
                if (error.code === 'ENOENT') {
                    return new Response('Not Found', { status: 404 });
                } else {
                    return new Response('Internal Server Error', { status: 500 });
                }
            }
        }
    });
    console.log('[Main Process] File protocol handler registered.');

    // Set up file protocol for accessing database files in production
    if (!isDev) {
        // In production, we need to ensure the IndexedDB files are accessible
        // Note: The 'localai-db' protocol might not be necessary if IndexedDB works correctly with the default setup.
        // Keeping it here for now as it was added previously.
        protocol.registerFileProtocol('localai-db', (request, callback) => {
            const urlPath = request.url.substring(11); // Remove 'localai-db://'
            const filePath = path.join(app.getPath('userData'), 'databases', urlPath);
            console.log(`[Main Process] Accessing database file via localai-db: ${filePath}`);
            // Ensure the callback provides an absolute path
            callback({ path: path.resolve(filePath) });
        });

        console.log(`[Main Process] Registered localai-db protocol for database access in production`);
        console.log(`[Main Process] User data directory: ${app.getPath('userData')}`);
        
        // Create necessary directories for database in production
        const dbDir = path.join(app.getPath('userData'), 'databases');
        
        if (!fs.existsSync(dbDir)) {
            console.log(`[Main Process] Creating database directory: ${dbDir}`);
            fs.mkdirSync(dbDir, { recursive: true });
        } else {
            console.log(`[Main Process] Database directory exists: ${dbDir}`);
            // List contents for debugging
            try {
                const files = fs.readdirSync(dbDir);
                console.log(`[Main Process] Database directory contents: ${files.join(', ') || 'empty'}`);
            } catch (err) {
                console.error(`[Main Process] Error reading database directory:`, err);
            }
        }
    }
    
    // Set up appropriate Content Security Policy for both dev and production
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    // Adjusted CSP: Allow fetch from 'file:' for our handled protocol
                    "default-src 'self' file: 'unsafe-inline' 'unsafe-eval' data: blob:;",
                    // Allow MLC/CDN scripts etc.
                    "script-src 'self' file: https://esm.run https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval' blob: 'wasm-unsafe-eval';",
                     // Allow connect-src for DDG, MLC, localhost (dev), file (our handler)
                    "connect-src 'self' file: http://localhost:* https://duckduckgo.com https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.jsdelivr.net wss: blob: data:;",
                    "img-src 'self' file: data: blob: https:;", // Allow file: for images if needed
                    "style-src 'self' file: 'unsafe-inline' https:;", // Allow file: for styles
                    "font-src 'self' file: data: https:;", // Allow file: for fonts
                    "worker-src 'self' file: blob:;", // Allow file: for workers
                    "child-src 'self' blob:;"
                ].join(' ')
            }
        });
    });
    
    // Add handler for database directory access
    ipcMain.handle('db:get-user-data-path', () => {
        return app.getPath('userData');
    });
    
    // Set up the IPC handlers for MCP
    ipcMain.handle('mcp:execute', handleMCPExecute);
    ipcMain.handle('mcp:fetchCapabilities', handleFetchMCPCapabilities);
    
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
            // webSecurity: true, // webSecurity must be false to load file:// resources in some cases without protocol handler, but our handler should bypass this need. Let's keep it true for safety.
            webSecurity: true, // Keep true for security
             // Ensure protocol handlers work correctly by disabling sandbox if necessary, though ideally it should work with sandbox enabled. Test this.
             // sandbox: false, // Temporarily disable sandbox if protocol handler fails; re-enable if possible. Let's keep default (true) first.
             sandbox: true, // Let's try keeping the sandbox enabled. Protocol handlers *should* work.
            webgl: true,     // Ensure WebGL is enabled for vector operations
            additionalArguments: ['--enable-features=WebAssembly,WebAssemblyThreads'],
            backgroundThrottling: false,
            icon: iconPath
        }
    });

    // Load the app using the original loadApp function
    try {
        await loadApp(mainWindow);
    } catch (err) {
        console.error('[Electron] Fatal error loading app:', err);
        app.quit();
    }
    
    app.on('activate', async () => {
        if (mainWindow === null) {
            mainWindow = new BrowserWindow({
                width: 1200,
                height: 800,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: path.join(__dirname, 'preload.cjs'),
                    webSecurity: true, // Keep true
                    sandbox: true, // Keep true
                    webgl: true,
                    additionalArguments: ['--enable-features=WebAssembly,WebAssemblyThreads'],
                    backgroundThrottling: false,
                    icon: iconPath
                }
            });
            
            try {
                await loadApp(mainWindow);
            } catch (err) {
                console.error('[Electron] Fatal error reloading app:', err);
                app.quit();
            }
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        cleanupServers().finally(() => app.quit());
    }
});

// Ensure protocol handlers are unregistered before quitting
app.on('before-quit', () => {
    console.log('[Main Process] Unregistering protocol handlers...');
    protocol.unhandle('file');
    // protocol.uninterceptProtocol('file'); // If intercept was used instead
    protocol.unregisterProtocol('localai-db'); // Unregister custom db protocol
    console.log('[Main Process] Protocol handlers unregistered.');
});

app.on('will-quit', async (event) => {
    // Note: before-quit is typically better for cleanup before windows close.
    // will-quit runs after windows are closed.
    event.preventDefault(); // Prevent default exit until cleanup is done
    try {
        await cleanupServers();
    } catch(e) {
        console.error("Error during server cleanup:", e);
    } finally {
        app.exit(); // Manually exit after cleanup
    }
}); 