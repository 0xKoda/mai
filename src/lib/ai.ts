import type { MLCEngine } from '@mlc-ai/web-llm';
import { writable, get } from 'svelte/store';

// Default models for different device types
export const DEFAULT_MODELS = {
    desktop: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    mobile: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'
};

// All available models
export const AVAILABLE_MODELS = [
    // Default models
    'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    // Additional models
    'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    'Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC',
    'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
    'Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC',
    'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC',
    'DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC'
];

// Get models appropriate for the device type
export function getAvailableModels(isMobile: boolean = false): string[] {
    return AVAILABLE_MODELS.filter(model => {
        // Filter out larger models for mobile devices
        if (isMobile && (
            model.includes('3B') || 
            model.includes('7B') || 
            model.includes('8B') || 
            model.includes('14b')
        )) {
            return false;
        }
        return true;
    });
}

import { aiLoading, aiLoadingProgress, selectedModel } from './stores/appStore';

// App state for loading and managing the AI engine
export const aiState = writable({
    isLoading: false,
    loadingProgress: {
        progress: 0,
        text: ''
    },
    engine: null as any,
    webllmReady: false,
    currentModel: DEFAULT_MODELS.desktop
});

declare global {
    interface Window {
        webllm: any;
    }
}

interface ChatOptions {
    max_tokens?: number;
    temperature?: number;
}

class AIEngine {
    private engine: any = null;
    private abortController: AbortController | null = null;
    public isInitialized = false;

    async init(model: string) {
        try {
            // Check if WebLLM is loaded
            if (!window.webllm) {
                throw new Error('WebLLM not loaded');
            }

            // Update loading state
            aiState.update(s => ({
                ...s,
                isLoading: true,
                loadingProgress: {
                    progress: 0,
                    text: 'Initializing AI engine...'
                }
            }));
            
            // Update app state
            aiLoading.set(true);
            aiLoadingProgress.set({
                progress: 0,
                text: 'Initializing AI engine...'
            });

            // Create the engine instance using the MLCEngine constructor from window.webllm
            // This matches how it's exposed by the webllm-loader module
            this.engine = new window.webllm.MLCEngine({
                initProgressCallback: (progress: any) => {
                    aiState.update(s => ({
                        ...s,
                        isLoading: true,
                        loadingProgress: {
                            progress: progress.progress,
                            text: progress.text
                        }
                    }));
                    
                    // Update app state
                    aiLoadingProgress.set({
                        progress: progress.progress,
                        text: progress.text
                    });
                },
                appConfig: window.webllm.prebuiltAppConfig
            });

            await this.engine.reload(model);
            
            // Update state after successful initialization
            aiState.update(s => ({
                ...s,
                isLoading: false,
                engine: this.engine,
                currentModel: model
            }));
            
            // Update app state
            aiLoading.set(false);
            selectedModel.set(model);

            console.log('AI Model loaded successfully:', model);
            this.isInitialized = true;
            return true;
        } catch (error) {
            console.error('Model initialization failed:', error);
            this.isInitialized = false;
            aiState.update(s => ({
                ...s,
                isLoading: false
            }));
            
            // Update app state
            aiLoading.set(false);
            throw new Error('AI Model failed to load: ' + (error as Error).message);
        }
    }

    async chat(messages: Array<{ role: string; content: string; }>, options?: ChatOptions) {
        if (!this.engine) {
            throw new Error('AI not initialized');
        }

        this.abortController = new AbortController();

        return this.engine.chat.completions.create({
            messages,
            stream: true,
            signal: this.abortController.signal,
            ...options
        });
    }

    abort(): void {
        this.abortController?.abort();
        this.abortController = null;
    }
}

export const ai = new AIEngine();

// Initialize the AI as soon as this module is loaded
console.log('Auto-initializing AI with default model');
setTimeout(() => {
    ai.init(DEFAULT_MODELS.desktop).catch(error => {
        console.error('Error during auto-initialization:', error);
    });
}, 1000); // Short delay to ensure WebLLM is ready
