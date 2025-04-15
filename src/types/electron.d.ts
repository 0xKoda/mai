export interface ElectronAPI {
  executeMCP: (serverConfig: MCPServer, args: string[]) => Promise<any>;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  fetchMCPCapabilities: (options: { server: MCPServer }) => Promise<{ capabilities: any[] }>;
  getUserDataPath: () => Promise<string>;
} 