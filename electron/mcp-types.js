// MCP Protocol implementation
// We're implementing the JSON-RPC protocol directly instead of using the SDK
// This ensures we have full control over the communication and can debug issues more easily

// Import path and other required modules
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

// Define our own server config type
export const ServerConfig = {
  // Just a placeholder for TypeScript compatibility
};

// Reproduce Client and ClientTransport classes from MCP SDK for direct access
class Client {
    constructor(clientInfo, capabilities) {
        this.clientInfo = clientInfo;
        this.capabilities = capabilities || {};
        this.isConnected = false;
        this.transport = null;
    }

    async connect(transport) {
        this.transport = transport;
        this.isConnected = true;
        return true;
    }

    async disconnect() {
        if (this.transport) {
            await this.transport.close();
        }
        this.isConnected = false;
    }

    async callTool(options) {
        if (!this.isConnected || !this.transport) {
            throw new Error('Client not connected');
        }
        
        return this.request({
            method: "tools/call",
            params: {
                name: options.name,
                arguments: options.arguments,
                _meta: {
                    progressToken: Date.now().toString()
                }
            }
        });
    }

    async request(requestObj) {
        if (!this.isConnected || !this.transport) {
            throw new Error('Client not connected');
        }
        
        const result = await this.transport.sendRequest(requestObj);
        return result;
    }

}

class StdioClientTransport {
    constructor(options) {
        this.process = options.process;
        this.command = options.command;
        this.args = options.args || [];
        this.env = options.env || process.env;
        
        // If process was not provided, create it
        if (!this.process && this.command) {
            console.log(`[MCP Types] Creating new process for ${this.command} ${this.args.join(' ')}`);
            
            // Check if we're running node in Electron and need to adjust
            const isNodeCommand = this.command === 'node';
            const isElectron = process.versions.hasOwnProperty('electron');
            const needsElectronAsNode = isNodeCommand && isElectron && !process.env.ELECTRON_RUN_AS_NODE;
            
            let execCommand = this.command;
            let execArgs = [...this.args];
            let execOptions = {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...this.env }
            };
            
            // If this is a node command in Electron, use Electron as Node
            if (needsElectronAsNode) {
                console.log('[MCP Types] Using Electron as Node for child process');
                execCommand = process.execPath;
                execOptions.env.ELECTRON_RUN_AS_NODE = '1';
            }
            
            console.log(`[MCP Types] Spawning process: ${execCommand} ${execArgs.join(' ')}`);
            
            try {
                this.process = spawn(execCommand, execArgs, execOptions);
                
                // Set up basic error handling
                this.process.on('error', (err) => {
                    console.error(`[MCP Types] Process spawn error: ${err.message}`);
                });
            } catch (err) {
                console.error(`[MCP Types] Failed to spawn process: ${err.message}`);
                throw new Error(`Failed to create process: ${err.message}`);
            }
        }
        
        this.responseHandlers = new Map();
        this.lastRequestId = 0;
        
        if (this.process) {
            // Set up stdout handler
            this.process.stdout.on('data', (data) => this._handleProcessOutput(data));
            
            // Log stderr for debugging
            this.process.stderr.on('data', (data) => {
                console.error(`[MCP Types] Process stderr: ${data.toString()}`);
            });
            
            this.process.on('error', (err) => {
                console.error(`[MCP Types] Process error: ${err.message}`);
            });
            
            this.process.on('close', (code) => {
                console.log(`[MCP Types] Process closed with code ${code}`);
            });
        } else {
            throw new Error('No process available for MCP transport');
        }
    }
    
    async sendRequest(requestObj) {
        if (!this.process || this.process.killed) {
            throw new Error('Process not available');
        }
        
        const requestId = requestObj.id || ++this.lastRequestId;
        const request = {
            ...requestObj,
            id: requestId,
            jsonrpc: "2.0"
        };
        
        return new Promise((resolve, reject) => {
            // Set up handler for this request
            this.responseHandlers.set(requestId, { resolve, reject });
            
            // Send the request
            const requestString = JSON.stringify(request) + '\n';
            this.process.stdin.write(requestString, (err) => {
                if (err) {
                    this.responseHandlers.delete(requestId);
                    reject(new Error(`Failed to write to process: ${err.message}`));
                }
            });
            
            // Set a timeout
            setTimeout(() => {
                if (this.responseHandlers.has(requestId)) {
                    this.responseHandlers.delete(requestId);
                    reject(new Error(`Request timed out after 30 seconds`));
                }
            }, 30000);
        });
    }
    
    _handleProcessOutput(data) {
        const outputStr = data.toString();
        console.log(`[MCP Types] Process output: ${outputStr.substring(0, 200)}${outputStr.length > 200 ? '...' : ''}`);
        
        try {
            // Parse JSON responses (may be multiple)
            const responses = this._parseJsonResponses(outputStr);
            
            for (const response of responses) {
                if (response.id && this.responseHandlers.has(response.id)) {
                    const { resolve, reject } = this.responseHandlers.get(response.id);
                    this.responseHandlers.delete(response.id);
                    
                    if (response.error) {
                        reject(new Error(response.error.message || 'Unknown error'));
                    } else {
                        resolve(response.result);
                    }
                }
            }
        } catch (err) {
            console.error(`[MCP Types] Error parsing response: ${err.message}`);
        }
    }
    
    _parseJsonResponses(text) {
        const responses = [];
        let remaining = text.trim();
        
        while (remaining.length > 0) {
            try {
                // Try to parse the entire string
                const parsedObj = JSON.parse(remaining);
                responses.push(parsedObj);
                break;
            } catch (err) {
                // Find the position of the first complete JSON object
                let openBrackets = 0;
                let closeBrackets = 0;
                let endPos = -1;
                
                for (let i = 0; i < remaining.length; i++) {
                    if (remaining[i] === '{') openBrackets++;
                    if (remaining[i] === '}') {
                        closeBrackets++;
                        if (openBrackets === closeBrackets) {
                            endPos = i + 1;
                            break;
                        }
                    }
                }
                
                if (endPos === -1) {
                    // No complete JSON object found
                    break;
                }
                
                try {
                    const jsonStr = remaining.substring(0, endPos);
                    const parsedObj = JSON.parse(jsonStr);
                    responses.push(parsedObj);
                    remaining = remaining.substring(endPos).trim();
                } catch (parseErr) {
                    // If we can't parse, just skip this attempt
                    remaining = remaining.substring(1).trim();
                }
            }
        }
        
        return responses;
    }
    
    async close() {
        if (this.process && !this.process.killed) {
            this.process.kill();
        }
    }
}

// Helper function to create JSONRPC 2.0 requests
function createJsonRpcRequest(method, params, id) {
    return {
        jsonrpc: "2.0",
        method,
        params,
        id
    };
}

// Helper function to parse JSONRPC 2.0 responses from potentially incomplete or concatenated messages
function parseJsonRpcResponse(text) {
    const responses = [];
    let remaining = text.trim();
    
    // Function to find balanced JSON objects in a string
    const findJsonObjects = (str) => {
        const objects = [];
        let depth = 0;
        let start = -1;
        
        for (let i = 0; i < str.length; i++) {
            if (str[i] === '{') {
                if (depth === 0) {
                    start = i;
                }
                depth++;
            } else if (str[i] === '}') {
                depth--;
                if (depth === 0 && start !== -1) {
                    const jsonCandidate = str.substring(start, i + 1);
                    try {
                        const parsed = JSON.parse(jsonCandidate);
                        objects.push(parsed);
                    } catch (e) {
                        // Not valid JSON, continue
                    }
                    start = -1;
                }
            }
        }
        
        return objects;
    };
    
    // Try to find all valid JSON objects in the text
    const possibleObjects = findJsonObjects(remaining);
    
    // Filter for valid JSONRPC responses
    for (const obj of possibleObjects) {
        if (obj && (obj.jsonrpc === "2.0" || obj.id !== undefined || obj.result !== undefined || obj.error !== undefined)) {
            responses.push(obj);
        }
    }
    
    return responses;
}

export { Client, StdioClientTransport, createJsonRpcRequest, parseJsonRpcResponse };