const { contextBridge, ipcRenderer } = require('electron');

// Improved logging to debug MCP issues
console.log('[Preload] Starting preload script');
console.log('[Preload] This preload script works with main.mjs - main.cjs is deprecated');

// List of valid IPC channels for MCP
const validMCPChannels = [
    'mcp:execute', 
    'mcp:list-servers', 
    'mcp:fetchCapabilities',
    'mcp:register-server',
    'db:get-user-data-path'
];

// Helper to log API calls for debugging
const createLoggingProxy = (name, obj) => {
    return new Proxy(obj, {
        get: (target, prop) => {
            const original = target[prop];
            if (typeof original === 'function') {
                return (...args) => {
                    // Safely stringify arguments to prevent circular references
                    try {
                        console.log(`[Preload] ${name}.${prop} called with:`, 
                            JSON.stringify(args, (key, value) => {
                                if (key === 'tools' || key === 'prompts') {
                                    return `[${Array.isArray(value) ? value.length : 0} items]`;
                                }
                                return value;
                            }).slice(0, 200)
                        );
                    } catch (e) {
                        console.log(`[Preload] ${name}.${prop} called (args not serializable)`);
                    }

                    return original.apply(target, args).then(result => {
                        try {
                            const resultStr = JSON.stringify(result, null, 2);
                            console.log(`[Preload] ${name}.${prop} returned:`, 
                                resultStr.length > 200 ? resultStr.slice(0, 200) + '...' : resultStr);
                        } catch (e) {
                            console.log(`[Preload] ${name}.${prop} returned (result not serializable)`);
                        }
                        return result;
                    }).catch(err => {
                        console.error(`[Preload] ${name}.${prop} error:`, err);
                        throw err;
                    });
                };
            }
            return original;
        }
    });
};

// Safe version of executeMCP that ensures serializable data
function safeExecuteMCP(serverConfig, args) {
    console.log('[Preload] executeMCP called with server:', serverConfig?.name || serverConfig);
    
    // Validate server config
    if (!serverConfig) {
        console.error('[Preload] No server config provided to executeMCP');
        return Promise.reject(new Error('No server configuration provided'));
    }
    
    // Create a serializable version of the server config
    const safeConfig = {
        id: serverConfig.id || String(Date.now()),
        name: serverConfig.name || 'Unnamed MCP Server',
        command: serverConfig.command,
        args: Array.isArray(serverConfig.args) ? serverConfig.args : 
              (serverConfig.args ? [serverConfig.args] : []),
        enabled: serverConfig.enabled !== false // Default to enabled
        // Intentionally omitting complex objects like tools and prompts
        // They're not needed by the main process execution
    };
    
    // Validate required fields
    if (!safeConfig.command) {
        console.error('[Preload] No command specified in server config');
        return Promise.reject(new Error('No command specified in server configuration'));
    }
    
    // Ensure args parameter is an array
    let safeArgs = args;
    if (!Array.isArray(args)) {
        if (args === undefined || args === null) {
            safeArgs = [];
        } else {
            safeArgs = [args];
        }
        console.log('[Preload] Converting args to array:', safeArgs);
    }
    
    console.log('[Preload] Executing MCP with validated config:', {
        name: safeConfig.name,
        command: safeConfig.command,
        args: safeConfig.args,
        userArgs: safeArgs
    });
    
    return ipcRenderer.invoke('mcp:execute', safeConfig, safeArgs);
}

// Expose protected APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Generic invoke function for all IPC channels
    invoke: (channel, data) => {
        if (validMCPChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, data);
        } else {
            console.error(`[Preload] Invalid channel requested: ${channel}`);
            return Promise.reject(new Error(`Invalid channel: ${channel}`));
        }
    },

    // Expose the executeMCP function specifically
    executeMCP: safeExecuteMCP,

    // Specific function for MCP capabilities
    fetchMCPServerCapabilities: (config) => {
        console.log('[Preload] fetchMCPServerCapabilities called with:', config?.name || config);
        
        // Validate config
        if (!config) {
            console.error('[Preload] Invalid config provided to fetchMCPServerCapabilities');
            return Promise.reject(new Error('Invalid server configuration'));
        }
        
        // Ensure config has the necessary fields
        const safeConfig = {
            id: config.id || String(Date.now()),
            name: config.name || 'Unnamed MCP Server',
            command: config.command,
            args: Array.isArray(config.args) ? config.args : (config.args ? [config.args] : []),
            serverId: config.id || String(Date.now())
        };
        
        if (!safeConfig.command) {
            console.error('[Preload] No command specified in config');
            return Promise.reject(new Error('No command specified in server configuration'));
        }
        
        console.log('[Preload] Validated config:', safeConfig);
        
        // Ensure the channel name matches the handler in main.mjs
        return ipcRenderer.invoke('mcp:fetchCapabilities', safeConfig);
    },

    // Alias for backward compatibility
    fetchMCPCapabilities: (options) => {
        console.log('[Preload] fetchMCPCapabilities called with:', options?.command || options);
        
        // Handle string or object parameter formats
        let safeOptions;
        if (typeof options === 'string') {
            // Legacy format: just the command string
            safeOptions = {
                command: options,
                args: [],
                serverId: String(Date.now())
            };
        } else if (options && typeof options === 'object') {
            // New format: object with command, args, serverId
            safeOptions = {
                command: options.command,
                args: Array.isArray(options.args) ? options.args : (options.args ? [options.args] : []),
                serverId: options.serverId || options.id || String(Date.now()),
                id: options.id || options.serverId || String(Date.now()),
                name: options.name || 'Unnamed MCP Server'
            };
        } else {
            console.error('[Preload] Invalid options provided to fetchMCPCapabilities');
            return Promise.reject(new Error('Invalid MCP server options'));
        }
        
        if (!safeOptions.command) {
            console.error('[Preload] No command specified in options');
            return Promise.reject(new Error('No command specified in MCP options'));
        }
        
        console.log('[Preload] Validated MCP options:', safeOptions);
        return ipcRenderer.invoke('mcp:fetchCapabilities', safeOptions);
    },

    // Server management functions
    registerMCPServer: (server) => {
        console.log('[Preload] registerMCPServer called with:', server?.name);
        return ipcRenderer.invoke('mcp:register-server', server);
    },
    
    listMCPServers: () => {
        console.log('[Preload] listMCPServers called');
        return ipcRenderer.invoke('mcp:list-servers');
    },

    // Add database helper functions
    getUserDataPath: () => {
        console.log('[Preload] getUserDataPath called');
        return ipcRenderer.invoke('db:get-user-data-path');
    }
});

console.log('[Preload] electronAPI exposed');

// Also expose the original electron interface for backward compatibility
contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        invoke: (channel, ...args) => {
            if (validMCPChannels.includes(channel)) {
                return ipcRenderer.invoke(channel, ...args);
            } else {
                console.error(`[Preload] Invalid channel requested via window.electron: ${channel}`);
                return Promise.reject(new Error(`Invalid channel: ${channel}`));
            }
        }
    }
});

console.log('[Preload] electron.ipcRenderer exposed');
console.log('[Preload] Preload script completed'); 