import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { app } from 'electron';
import { Client, StdioClientTransport } from './mcp-types.js';

// Store for active MCP client connections (keyed by server ID)
const activeClients = new Map();
const activeProcesses = new Map();

// Helper to check if app is running in development mode
const isDev = !app.isPackaged;

// Helper function to resolve file paths for external MCP scripts
function resolveMCPPath(scriptPath) {
    console.log(`[MCP Bridge] Resolving MCP path: ${scriptPath}`);
    
    // Skip if not a string or empty
    if (!scriptPath || typeof scriptPath !== 'string') {
        console.log(`[MCP Bridge] Not a valid path, using as is: ${scriptPath}`);
        return scriptPath;
    }
    
    // If not a path, return as is (e.g., globally installed command)
    if (!scriptPath.includes('/') && !scriptPath.includes('\\')) {
        console.log(`[MCP Bridge] Not a path, using as is: ${scriptPath}`);
        return scriptPath;
    }
    
    // If absolute path, verify it exists
    if (path.isAbsolute(scriptPath)) {
        console.log(`[MCP Bridge] Checking absolute path: ${scriptPath}`);
        try {
            if (fs.existsSync(scriptPath)) {
                const stats = fs.statSync(scriptPath);
                if (stats.isFile()) {
                    console.log(`[MCP Bridge] Found file at absolute path: ${scriptPath}`);
                    return scriptPath;
                } else if (stats.isDirectory()) {
                    console.log(`[MCP Bridge] Warning: Path is a directory, not a file: ${scriptPath}`);
                }
            } else {
                console.log(`[MCP Bridge] Absolute path does not exist: ${scriptPath}`);
            }
        } catch (e) {
            console.error(`[MCP Bridge] Error checking absolute path: ${e.message}`);
        }
        
        // Even if we couldn't verify it, return the absolute path
        return scriptPath;
    }
    
    // For development mode
    if (isDev) {
        // Start with an array of potential locations
        const devPaths = [
            // Current working directory
            path.resolve(process.cwd(), scriptPath),
            // Project root
            path.resolve(process.cwd(), '..', scriptPath),
            // Relative to __dirname
            path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', scriptPath),
            // Home directory - for user scripts
            path.resolve(require('os').homedir(), scriptPath)
        ];
        
        console.log(`[MCP Bridge] Checking ${devPaths.length} possible dev paths`);
        
        // Find first existing file (not directory)
        for (const checkPath of devPaths) {
            try {
                if (fs.existsSync(checkPath)) {
                    const stats = fs.statSync(checkPath);
                    if (stats.isFile()) {
                        console.log(`[MCP Bridge] Found file in dev mode at: ${checkPath}`);
                        return checkPath;
                    } else if (stats.isDirectory()) {
                        console.log(`[MCP Bridge] Path is a directory, not a file: ${checkPath}`);
                    }
                }
            } catch (e) {
                console.log(`[MCP Bridge] Error checking dev path: ${e.message}`);
            }
        }
        
        // Return original path if we couldn't find the file
        console.log(`[MCP Bridge] Using original path in dev: ${scriptPath}`);
        return scriptPath;
    }
    
    // For production mode - check multiple locations with much more thorough logging
    console.log(`[MCP Bridge] Resolving path in production mode: ${scriptPath}`);
    
    // Get application paths
    const appPath = app.getAppPath();
    const resourcesPath = path.dirname(appPath);
    const userDataPath = app.getPath('userData');
    const homePath = require('os').homedir();
    
    console.log(`[MCP Bridge] App paths:`, {
        appPath,
        resourcesPath,
        userDataPath,
        homePath,
        cwd: process.cwd()
    });
    
    // List of potential locations to check
    const potentialPaths = [
        // User's home directory (most likely for user-defined scripts)
        path.resolve(homePath, scriptPath),
        // User data directory
        path.resolve(userDataPath, scriptPath),
        // Current working directory
        path.resolve(process.cwd(), scriptPath),
        // Resources directory (for bundled resources)
        path.resolve(resourcesPath, 'mcp', scriptPath),
        path.resolve(resourcesPath, scriptPath),
        // App directory
        path.resolve(appPath, scriptPath),
        // Extraresources directory
        path.resolve(resourcesPath, 'extraResources', scriptPath),
        path.resolve(resourcesPath, 'extraResources', 'mcp', scriptPath),
        // If path looks like a relative path with ./ or ../
        scriptPath.startsWith('./') ? path.resolve(process.cwd(), scriptPath) : scriptPath,
        scriptPath.startsWith('../') ? path.resolve(process.cwd(), scriptPath) : scriptPath,
        // As a last resort, try absolute from root
        path.resolve('/', scriptPath),
        // Original path as fallback
        scriptPath
    ];
    
    // Log all search locations
    console.log(`[MCP Bridge] Checking ${potentialPaths.length} potential locations in production`);
    potentialPaths.forEach((p, i) => console.log(`  Path ${i+1}: ${p}`));
    
    // Find first existing file (not directory)
    for (const checkPath of potentialPaths) {
        try {
            console.log(`[MCP Bridge] Checking if exists: ${checkPath}`);
            if (fs.existsSync(checkPath)) {
                const stats = fs.statSync(checkPath);
                if (stats.isFile()) {
                    console.log(`[MCP Bridge] Found file at: ${checkPath}`);
                    return checkPath;
                } else if (stats.isDirectory()) {
                    console.log(`[MCP Bridge] Path is a directory, not a file: ${checkPath}`);
                }
            } else {
                console.log(`[MCP Bridge] Path does not exist: ${checkPath}`);
            }
        } catch (e) {
            console.log(`[MCP Bridge] Error checking path: ${e.message}`);
        }
    }
    
    console.log(`[MCP Bridge] Could not find script in any location, using original: ${scriptPath}`);
    return scriptPath;
}

/**
 * Spawn a new MCP process with proper error handling
 */
export async function spawnMCPProcess(command, args = []) {
    console.log(`[MCP Bridge] Spawning MCP process: ${command} ${args.join(' ')}`);
    
    // Ensure command is valid
    if (!command) {
        throw new Error('No command specified for MCP process');
    }
    
    // For node commands in production, ensure we use the correct executable
    let execCommand = command;
    let useElectronAsNode = false;
    
    if (command === 'node' && !isDev) {
        try {
            // In production, we cannot rely on 'node' being in PATH
            // Use the Electron executable with ELECTRON_RUN_AS_NODE=1
            useElectronAsNode = true;
            execCommand = process.execPath; // Use Electron executable
            console.log(`[MCP Bridge] Using Electron as Node in production: ${execCommand}`);
            
            // Additional debugging info for node command in production
            console.log(`[MCP Bridge] Node execution details: 
                - Electron path: ${process.execPath}
                - cwd: ${process.cwd()}
                - app path: ${app.getAppPath()}
                - isDev: ${isDev}
                - ELECTRON_RUN_AS_NODE flag will be set to: ${useElectronAsNode ? '1' : '0'}
            `);
        } catch (e) {
            console.warn(`[MCP Bridge] Error finding node executable: ${e.message}`);
            // Still try with 'node' as a last resort
            execCommand = 'node';
        }
    }
    
    // Log all args before processing
    console.log(`[MCP Bridge] Original args before processing:`, args);
    
    // Resolve paths for all script arguments (first arg is usually the script path)
    const resolvedArgs = [];
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        // Skip undefined, null or empty args
        if (!arg) {
            resolvedArgs.push(arg);
            continue;
        }
        
        try {
            // Only try to resolve paths for the first argument or arguments that look like paths
            if (i === 0 || (typeof arg === 'string' && (arg.includes('/') || arg.includes('\\')))) {
                // Check if this looks like a script path
                const isLikelyScript = typeof arg === 'string' && (
                    arg.endsWith('.js') || 
                    arg.endsWith('.mjs') || 
                    arg.endsWith('.cjs') || 
                    arg.endsWith('.py') || 
                    arg.endsWith('.sh')
                );
                
                if (isLikelyScript) {
                    // Try to resolve the path
                    const resolvedPath = resolveMCPPath(arg);
                    console.log(`[MCP Bridge] Resolved arg ${i} from ${arg} to ${resolvedPath}`);
                    
                    // Verify the resolved path isn't a directory (to prevent ENOTDIR error)
                    try {
                        if (fs.existsSync(resolvedPath)) {
                            const stats = fs.statSync(resolvedPath);
                            if (stats.isDirectory()) {
                                console.error(`[MCP Bridge] Resolved path is a directory, not a file: ${resolvedPath}`);
                                throw new Error(`Resolved path is a directory, not a file: ${resolvedPath}`);
                            } else {
                                console.log(`[MCP Bridge] Verified ${resolvedPath} is a file`);
                            }
                        } else {
                            console.log(`[MCP Bridge] Path does not exist: ${resolvedPath}`);
                        }
                    } catch (statErr) {
                        // If we can't stat the file, log but continue
                        console.warn(`[MCP Bridge] Couldn't verify if path is file or dir: ${resolvedPath}`, statErr.message);
                    }
                    
                    resolvedArgs.push(resolvedPath);
                } else {
                    // Not a script, but looks like a path - still try to resolve
                    resolvedArgs.push(resolveMCPPath(arg));
                }
            } else {
                // Not a path - use as is
                resolvedArgs.push(arg);
            }
        } catch (e) {
            console.error(`[MCP Bridge] Error resolving arg ${i}: ${e.message}`);
            // Use original arg if resolution fails
            resolvedArgs.push(arg);
        }
    }
    
    console.log(`[MCP Bridge] Spawning with command: ${execCommand}, resolved args:`, resolvedArgs);
    
    // Set up process environment with helpful variables
    const env = {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        // This is critical for using Electron as Node
        ELECTRON_RUN_AS_NODE: useElectronAsNode ? '1' : '0',
        MCP_APP_PATH: app.getAppPath(),
        MCP_USER_DATA_PATH: app.getPath('userData'),
        MCP_IS_PRODUCTION: !isDev,
        // Add paths to help Node find modules
        NODE_PATH: process.env.NODE_PATH ? 
            `${process.env.NODE_PATH}:${app.getAppPath()}/node_modules` : 
            `${app.getAppPath()}/node_modules`
    };
    
    // Create the process
    try {
        // Use cwd that makes sense for the user's script
        let cwd = isDev ? process.cwd() : app.getAppPath();
        
        // If the first arg is a path, use its directory as cwd
        if (resolvedArgs.length > 0 && typeof resolvedArgs[0] === 'string' && 
            (resolvedArgs[0].includes('/') || resolvedArgs[0].includes('\\'))) {
            try {
                const scriptDir = path.dirname(resolvedArgs[0]);
                if (fs.existsSync(scriptDir) && fs.statSync(scriptDir).isDirectory()) {
                    cwd = scriptDir;
                    console.log(`[MCP Bridge] Using script directory as cwd: ${cwd}`);
                }
            } catch (e) {
                console.warn(`[MCP Bridge] Error using script dir as cwd: ${e.message}`);
            }
        }
        
        // Print complete command that will be executed
        const cmdDescription = `${execCommand} ${resolvedArgs.join(' ')}`;
        console.log(`[MCP Bridge] Executing command: ${cmdDescription}`);
        
        // When using Electron as Node, we can skip shell on macOS/Linux
        const useShell = (process.platform === 'win32') || (!useElectronAsNode);
        
        // Spawn with more descriptive options
        console.log(`[MCP Bridge] Spawn options:`, {
            cwd,
            useShell,
            env: {
                ELECTRON_RUN_AS_NODE: env.ELECTRON_RUN_AS_NODE,
                NODE_PATH: env.NODE_PATH 
            }
        });
        
        const mcpProcess = spawn(execCommand, resolvedArgs, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
            cwd,
            shell: useShell // Use shell only on Windows or if not using Electron as Node
        });
        
        return new Promise((resolve, reject) => {
            let startupErrorReceived = false;
            
            // Set up error handler
            mcpProcess.on('error', (err) => {
                startupErrorReceived = true;
                console.error(`[MCP Bridge] Process spawn error: ${err.message}`);
                reject(err);
            });
            
            // Set up exit handler - reject if process exits too quickly
            mcpProcess.on('exit', (code, signal) => {
                if (code !== 0 && code !== null) {
                    console.error(`[MCP Bridge] Process exited with code ${code}`);
                    if (!startupErrorReceived) {
                        reject(new Error(`Process exited with code ${code}`));
                        startupErrorReceived = true;
                    }
                } else {
                    console.log(`[MCP Bridge] Process exited (code: ${code}, signal: ${signal})`);
                }
            });
            
            // Log stdout for debugging
            let stdoutBuffer = '';
            mcpProcess.stdout.on('data', (data) => {
                const output = data.toString();
                stdoutBuffer += output;
                if (output.length > 500) {
                    console.log(`[MCP Bridge] Process stdout: ${output.substring(0, 500)}...`);
                } else {
                    console.log(`[MCP Bridge] Process stdout: ${output}`);
                }
            });
            
            // Log stderr for debugging - important for detecting issues
            let stderrBuffer = '';
            mcpProcess.stderr.on('data', (data) => {
                const output = data.toString();
                stderrBuffer += output;
                console.error(`[MCP Bridge] Process stderr: ${output}`);
                
                // Check for common error messages that would indicate a problem
                if (output.includes('ENOENT') || 
                    output.includes('command not found') || 
                    output.includes('Error: Cannot find module')) {
                    if (!startupErrorReceived) {
                        reject(new Error(`Process startup error: ${output.trim()}`));
                        startupErrorReceived = true;
                    }
                }
            });
            
            // Resolve with the process after a short delay to allow for startup
            setTimeout(() => {
                if (mcpProcess.killed) {
                    reject(new Error('Process was killed during startup'));
                } else if (startupErrorReceived) {
                    // Already rejected, don't resolve
                } else {
                    console.log(`[MCP Bridge] Process started successfully`);
                    resolve(mcpProcess);
                }
            }, 500); // Increased startup delay for more stability
        });
    } catch (err) {
        console.error(`[MCP Bridge] Failed to spawn process: ${err.message}`);
        throw err;
    }
}

/**
 * Get or create a persistent client connection for a given MCP server
 * 
 * @param {string} serverCommand - The command to run (executable like 'node', 'python', 'npx')
 * @param {string[]} serverArgs - The arguments for the command (script path and additional args)
 * @param {string} serverId - Unique identifier for the server
 */
export async function getOrCreateClient(serverCommand, serverArgs = [], serverId = serverCommand) {
    const clientKey = serverId || serverCommand;
    
    console.log(`[MCP Bridge] getOrCreateClient called with:`, { 
        command: serverCommand,
        args: Array.isArray(serverArgs) ? serverArgs.join(' ') : serverArgs,
        serverId: clientKey
    });
    
    if (activeClients.has(clientKey)) {
        console.log(`[MCP Bridge] Reusing existing client for server ID: ${clientKey}`);
        return activeClients.get(clientKey);
    }

    console.log(`[MCP Bridge] Creating new MCP client`);
    
    // Ensure serverArgs is always an array
    const argsArray = Array.isArray(serverArgs) ? serverArgs : 
                     (serverArgs ? [serverArgs] : []);
    
    console.log(`[MCP Bridge] Using command: ${serverCommand} with args:`, argsArray);
    
    // Create or reuse process
    let processToUse;
    
    try {
        if (activeProcesses.has(clientKey)) {
            processToUse = activeProcesses.get(clientKey);
            console.log(`[MCP Bridge] Reusing existing process for ${clientKey}`);
        } else {
            processToUse = await spawnMCPProcess(serverCommand, argsArray);
            activeProcesses.set(clientKey, processToUse);
            console.log(`[MCP Bridge] Created new process for ${clientKey}`);
        }
    } catch (processError) {
        console.error(`[MCP Bridge] Error creating process: ${processError.message}`);
        throw new Error(`Failed to create MCP process: ${processError.message}`);
    }
    
    // Create transport with proper error handling
    let transport;
    try {
        transport = new StdioClientTransport({
            process: processToUse,
            command: serverCommand,
            args: argsArray,
            env: { ...process.env, NODE_NO_WARNINGS: '1' }
        });
    } catch (transportError) {
        console.error(`[MCP Bridge] Error creating transport:`, transportError);
        throw new Error(`Failed to create MCP transport: ${transportError.message}`);
    }

    // Create client with unique ID
    const client = new Client({
        name: `mcp-client-${clientKey}`,
        version: "1.0.0",
        capabilities: {}
    });

    try {
        console.log(`[MCP Bridge] Connecting client for server ID: ${clientKey}`);
        await client.connect(transport);
        console.log(`[MCP Bridge] Client connected successfully for server ID: ${clientKey}`);
        
        // Store the connected client and transport
        const connection = { client, transport };
        activeClients.set(clientKey, connection);

        return connection;
    } catch (error) {
        console.error(`[MCP Bridge] Failed to connect client for server ID: ${clientKey}`, error);
        try {
            await transport.close();
        } catch (closeError) {
            console.error(`[MCP Bridge] Error closing transport after failure:`, closeError);
        }
        throw error;
    }
}

// Function to clean up clients on exit
export async function cleanupClients() {
    console.log('[MCP Bridge] Cleaning up active MCP clients...');
    for (const [serverId, connection] of activeClients.entries()) {
        console.log(`[MCP Bridge] Closing transport for server ID: ${serverId}`);
        try {
            await connection.transport.close();
        } catch (err) {
            console.error(`[MCP Bridge] Error closing transport for server ID: ${serverId}:`, err);
        }
    }
    activeClients.clear();
    
    // Also clean up any remaining processes
    for (const [serverId, process] of activeProcesses.entries()) {
        console.log(`[MCP Bridge] Terminating process for server ID: ${serverId}`);
        try {
            if (process && !process.killed) {
                process.kill();
            }
        } catch (err) {
            console.error(`[MCP Bridge] Error killing process for server ID: ${serverId}:`, err);
        }
    }
    activeProcesses.clear();
    
    console.log('[MCP Bridge] Client cleanup complete.');
} 