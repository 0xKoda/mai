// src/lib/types.ts
export interface AIState {
    isLoading: boolean;
    loadingProgress: {
        progress: number;
        text: string;
    };
    engine: any; // TODO: Add proper type from WebLLM when available
    webllmReady: boolean;
    currentModel: string;
} 