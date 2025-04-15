import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Note } from './stores/notesStore';
import type { Chat } from './stores/chatStore';
import type { MCPServer } from './stores/mcpStore';

// Check if we're running in Electron production environment
const isElectronProduction = () => {
  return typeof window !== 'undefined' && 
         window.electronAPI && 
         typeof window.process === 'undefined';
};

interface LocalAIDB extends DBSchema {
  chats: {
    key: string;
    value: Chat;
    indexes: Record<string, never>;
  };
  knowledge: {
    key: string;
    value: any;
    indexes: Record<string, never>;
  };
  notes: {
    key: string;
    value: Note;
    indexes: Record<string, never>;
  };
  mcp: {
    key: string;
    value: MCPServer;
    indexes: { name: string };
  };
}

let dbInstance: IDBPDatabase<LocalAIDB> | null = null;
let dbInitPromise: Promise<IDBPDatabase<LocalAIDB> | null> | null = null;

export const db = {
  async init() {
    console.log('[DB] init() called');
    
    // Return existing promise if initialization is in progress
    if (dbInitPromise) {
      console.log('[DB] Returning existing init promise');
      return dbInitPromise;
    }
    
    // Return existing instance if already initialized
    if (dbInstance) {
      console.log('[DB] Database already initialized, returning instance');
      return dbInstance;
    }
    
    // Start initialization with a promise
    dbInitPromise = this._initDatabase();
    
    try {
      dbInstance = await dbInitPromise;
      dbInitPromise = null;
      console.log('[DB] Database initialized, dbInstance is now available');
      return dbInstance;
    } catch (error) {
      console.error('[DB] Error initializing database:', error);
      dbInitPromise = null;
      throw error;
    }
  },
  
  async _initDatabase() {
    console.log('[DB] Starting database initialization');
    
    // Log environment information
    console.log('[DB] Environment:', {
      isElectronProduction: isElectronProduction(),
      window: typeof window !== 'undefined',
      electronAPI: typeof window !== 'undefined' && !!window.electronAPI,
    });
    
    try {
      // Set up database name and options
      const dbName = 'localai';
      const dbVersion = 2;
      
      // Special handling for Electron production
      if (isElectronProduction() && window.electronAPI?.getUserDataPath) {
        // Get user data path from Electron
        try {
          const userDataPath = await window.electronAPI.getUserDataPath();
          console.log('[DB] Using Electron production data path:', userDataPath);
        } catch (pathError) {
          console.warn('[DB] Could not get user data path from Electron:', pathError);
        }
      }
      
      // Open the database with upgrade logic
      const db = await openDB<LocalAIDB>(dbName, dbVersion, {
        upgrade(db: IDBPDatabase<LocalAIDB>, oldVersion: number, newVersion: number | null) {
          console.log(`[DB] Upgrading database from version ${oldVersion} to ${newVersion}`);
          
          // Create stores if they don't exist
          if (!db.objectStoreNames.contains('chats')) {
            db.createObjectStore('chats', { keyPath: 'id' });
            console.log('[DB] Created chats object store');
          }
          if (!db.objectStoreNames.contains('knowledge')) {
            db.createObjectStore('knowledge', { keyPath: 'id' });
            console.log('[DB] Created knowledge object store');
          }
          if (!db.objectStoreNames.contains('notes')) {
            db.createObjectStore('notes', { keyPath: 'id' });
            console.log('[DB] Created notes object store');
          }
          if (!db.objectStoreNames.contains('mcp')) {
            const mcpStore = db.createObjectStore('mcp', { keyPath: 'id' });
            mcpStore.createIndex('name', 'name', { unique: false });
            console.log('[DB] Created mcp object store');
          }
        }
      });
      
      console.log('[DB] Database opened successfully');
      
      // Verify all stores are accessible
      const storeNames = Array.from(db.objectStoreNames);
      console.log('[DB] Available object stores:', storeNames);
      
      return db;
    } catch (error) {
      console.error('[DB] Error opening database:', error);
      throw error;
    }
  },

  // Add the ping function here, in the actual db object
  async ping(): Promise<boolean> {
    if (!dbInstance) {
      console.log('[DB] Ping failed: dbInstance is null');
      return false;
    }
    try {
      // Try to perform a simple operation to verify the connection
      const tx = dbInstance.transaction('mcp', 'readonly');
      const store = tx.objectStore('mcp');
      const count = await store.count();
      console.log(`[DB] Ping successful. Found ${count} MCP servers in DB.`);
      await tx.done;
      return true;
    } catch (error) {
      console.error('[DB] Ping failed:', error);
      return false;
    }
  },

  // Notes methods
  async getAllNotes(): Promise<Note[]> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      return await dbInstance.getAll('notes');
    } catch (error) {
      console.error('Error getting notes:', error);
      return [];
    }
  },

  async saveNote(note: Note): Promise<void> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      await dbInstance.put('notes', note);
    } catch (error) {
      console.error('Error saving note:', error);
      throw error;
    }
  },

  async deleteNote(id: string): Promise<void> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      await dbInstance.delete('notes', id);
    } catch (error) {
      console.error('Error deleting note:', error);
      throw error;
    }
  },

  // Chats methods
  async getAllChats(): Promise<Chat[]> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      return await dbInstance.getAll('chats');
    } catch (error) {
      console.error('Error getting chats:', error);
      return [];
    }
  },

  async saveChat(chat: Chat): Promise<void> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      await dbInstance.put('chats', chat);
    } catch (error) {
      console.error('Error saving chat:', error);
      throw error;
    }
  },

  async deleteChat(id: string): Promise<void> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      await dbInstance.delete('chats', id);
    } catch (error) {
      console.error('Error deleting chat:', error);
      throw error;
    }
  },

  // MCP server methods
  async getAllMCPServers(): Promise<MCPServer[]> {
    console.log('[DB] getAllMCPServers called');
    if (!dbInstance) {
      console.error('[DB] ERROR: getAllMCPServers called but dbInstance is null! Database might not be initialized yet.');
      throw new Error('Database not initialized');
    }
    try {
      const servers = await dbInstance.getAll('mcp');
      console.log(`[DB] getAllMCPServers retrieved ${servers.length} servers`);
      console.log('[DB] Retrieved server data:', servers); // Add more detailed logging
      return servers;
    } catch (error) {
      console.error('[DB] Error in getAllMCPServers:', error);
      throw error;
    }
  },

  async saveMCPServer(server: MCPServer): Promise<void> {
    console.log('[DB] saveMCPServer called with server:', server);
    if (!dbInstance) throw new Error('Database not initialized');
    try {
      await dbInstance.put('mcp', server);
      console.log(`[DB] saveMCPServer successfully saved/updated server ID: ${server.id}`);
    } catch (error) {
      console.error('[DB] Error in saveMCPServer:', error);
      throw error;
    }
  },

  async deleteMCPServer(id: string): Promise<void> {
    console.log(`[DB] deleteMCPServer called for ID: ${id}`);
    if (!dbInstance) throw new Error('Database not initialized');
    try {
      await dbInstance.delete('mcp', id);
      console.log(`[DB] deleteMCPServer successfully deleted server ID: ${id}`);
    } catch (error) {
      console.error('[DB] Error in deleteMCPServer:', error);
      throw error;
    }
  },

  // Clear methods
  async clearChats(): Promise<void> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      await dbInstance.clear('chats');
    } catch (error) {
      console.error('Error clearing chats:', error);
      throw error;
    }
  },

  async clearNotes(): Promise<void> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      await dbInstance.clear('notes');
    } catch (error) {
      console.error('Error clearing notes:', error);
      throw error;
    }
  },

  async clearKnowledge(): Promise<void> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      await dbInstance.clear('knowledge');
    } catch (error) {
      console.error('Error clearing knowledge:', error);
      throw error;
    }
  },

  async getAllKnowledge(): Promise<any[]> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      return await dbInstance.getAll('knowledge');
    } catch (error) {
      console.error('Error getting all knowledge:', error);
      throw error;
    }
  },

  async saveKnowledge(doc: any): Promise<void> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      await dbInstance.put('knowledge', doc);
    } catch (error) {
      console.error('Error saving knowledge:', error);
      throw error;
    }
  },

  async deleteKnowledge(id: string): Promise<void> {
    try {
      if (!dbInstance) throw new Error('Database not initialized');
      await dbInstance.delete('knowledge', id);
    } catch (error) {
      console.error('Error deleting knowledge:', error);
      throw error;
    }
  }
};
