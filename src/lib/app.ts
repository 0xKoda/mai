import { db } from './db';
import { loadChats } from './stores/chatStore';
import { loadNotes } from './stores/notesStore';
import { loadMCPServers } from './stores/mcpStore';

let isInitialized = false;
let initPromise: Promise<void> | null = null; // Prevent race conditions

export async function initApp() {
  // Prevent re-entry while initialization is in progress
  if (initPromise) {
    console.log('App initialization already in progress, awaiting existing promise.');
    return initPromise;
  }
  if (isInitialized) {
    console.log('App already initialized.');
    return;
  }

  console.log('App initializing...');
  // Create a promise to track initialization
  initPromise = (async () => {
    try {
      console.log('[InitApp] Calling db.init()...');
      await db.init(); // Initialize database first
      console.log('[InitApp] db.init() completed.');

      // Load all data concurrently AFTER db is initialized
      console.log('[InitApp] Starting concurrent loading of chats, notes, mcp...');
      await Promise.all([
        (async () => {
            console.log('[InitApp] Calling loadChats...');
            await loadChats();
            console.log('[InitApp] loadChats completed.');
        })(),
        (async () => {
            console.log('[InitApp] Calling loadNotes...');
            await loadNotes();
            console.log('[InitApp] loadNotes completed.');
        })(),
        (async () => {
            console.log('[InitApp] Calling loadMCPServers...');
            await loadMCPServers(); // *** Ensure this call exists ***
            console.log('[InitApp] loadMCPServers completed.');
        })()
      ]);
      console.log('[InitApp] Concurrent loading finished. Chats, Notes, and MCP Servers should be loaded.');
      isInitialized = true; // Mark as initialized ONLY on success

    } catch (error) {
      console.error('[InitApp] CRITICAL Error during app initialization:', error);
      isInitialized = false; // Ensure we can retry if needed? Or handle failure state.
    } finally {
       initPromise = null; // Clear the promise tracker once done (success or fail)
    }
  })();

  return initPromise;
} 