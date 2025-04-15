// ==== DEPRECATED FILE - DO NOT USE ====
// This file is kept for compatibility reasons only.
// All functionality has been moved to main.mjs.
// Please update any imports to use main.mjs instead.
// ======================================

console.warn('[DEPRECATED] main.cjs is deprecated and should not be used. Please use main.mjs instead.');

// Import app from electron but don't do anything with it
import { app } from 'electron';

// Export empty functions for compatibility if needed
export async function handleMCPExecute() {
  console.error('[DEPRECATED] handleMCPExecute in main.cjs called, but this file is deprecated. Use main.mjs instead.');
  return {
    error: {
      message: 'This function is deprecated. Please use main.mjs handlers instead.'
    }
  };
}

// No IPC handlers registered here - all handlers should be in main.mjs 