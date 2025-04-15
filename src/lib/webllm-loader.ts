import { MLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';

// Initialize WebLLM
export function initializeWebLLM() {
    try {
        // Expose WebLLM to the window object
        (window as any).webllm = {
            MLCEngine,
            prebuiltAppConfig
        };
        
        console.log('WebLLM initialized successfully');
        return true;
    } catch (error) {
        console.error('Failed to initialize WebLLM:', error);
        return false;
    }
} 