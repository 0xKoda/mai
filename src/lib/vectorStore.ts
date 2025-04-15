import { writable } from 'svelte/store';
import type { Note } from './stores/notesStore';
import { db } from './db';

interface StoredDocument {
    id: string;
    text: string;
    vector?: number[];
    metadata: {
        filename: string;
        timestamp: number;
        chunkIndex: number;
        totalChunks: number;
        classification?: string;
        summary?: string;
        isNote?: boolean; // Flag to indicate this is from a note
        noteId?: string;  // ID of the source note
    };
}

class VectorStore {
    private documents: StoredDocument[] = [];
    private initialized = false;
    private initializing = false;
    private initPromise: Promise<void> | null = null;
    private store = writable<StoredDocument[]>([]);
    private isElectronProduction = typeof window !== 'undefined' && 
                                   window.electronAPI && 
                                   typeof window.process === 'undefined';

    constructor() {
        // Attempt to initialize early but don't block construction
        setTimeout(() => this.ensureInitialized(), 100);
    }

    private async ensureInitialized() {
        // Return existing promise if initialization is in progress
        if (this.initPromise) {
            console.log('[VectorStore] Already initializing, waiting for completion');
            await this.initPromise;
            return;
        }
        
        // If already initialized, return immediately
        if (this.initialized) {
            console.log('[VectorStore] Already initialized');
            return;
        }
        
        // Start initialization
        if (!this.initializing) {
            console.log('[VectorStore] Starting initialization process');
            this.initializing = true;
            this.initPromise = this._initialize();
            
            try {
                await this.initPromise;
                console.log('[VectorStore] Initialization completed successfully');
            } catch (error) {
                console.error('[VectorStore] Initialization failed with error:', error);
            } finally {
                this.initializing = false;
                this.initPromise = null;
            }
        }
    }

    private async _initialize() {
        try {
            console.log('[VectorStore] Initializing...');
            console.log('[VectorStore] Environment:', { 
                isElectronProduction: this.isElectronProduction,
                window: typeof window !== 'undefined',
                electronAPI: typeof window !== 'undefined' && !!window.electronAPI
            });
            
            // Make sure DB is initialized first
            const dbInstance = await db.init();
            if (!dbInstance) {
                throw new Error('Database initialization failed - no instance returned');
            }
            
            // Load documents from IndexedDB
            const storedDocs = await db.getAllKnowledge();
            
            // Log more details about the loaded documents
            console.log(`[VectorStore] Retrieved ${storedDocs?.length || 0} documents from storage`);
            
            if (storedDocs && storedDocs.length > 0) {
                // Log sample of document IDs for debugging
                const sampleIds = storedDocs.slice(0, 3).map(doc => doc.id);
                console.log(`[VectorStore] Sample document IDs: ${sampleIds.join(', ')}`);
                
                // Check that vectors were loaded properly
                const docsWithVectors = storedDocs.filter(doc => 
                    Array.isArray(doc.vector) && doc.vector.length > 0
                );
                
                console.log(`[VectorStore] Documents with valid vectors: ${docsWithVectors.length}/${storedDocs.length}`);
                
                if (docsWithVectors.length < storedDocs.length) {
                    console.warn('[VectorStore] Some documents are missing vectors');
                }
                
                this.documents = storedDocs;
            } else {
                console.log('[VectorStore] No documents found in storage');
                this.documents = [];
            }
            
            this.initialized = true;
            this.store.set(this.documents);
            console.log(`[VectorStore] Initialized with ${this.documents.length} documents`);
        } catch (error) {
            console.error('[VectorStore] Initialization failed:', error);
            this.initialized = false; // Reset flag to allow retry
            throw error;
        }
    }

    async initialize() {
        return this.ensureInitialized();
    }

    async addNote(note: Note) {
        try {
            await this.ensureInitialized();
            
            console.log('[VectorStore] Processing note:', note.title);
            
            // Split large notes into sections that fit context window
            const maxTokens = 3000;
            const sections = this.splitIntoSections(note.content, maxTokens);
            console.log(`[VectorStore] Split note into ${sections.length} sections`);
            
            // Remove any existing sections for this note from memory and storage
            await this.removeNote(note.id);
            
            for (let i = 0; i < sections.length; i++) {
                const vector = this.generateVector(sections[i]);
                
                const doc: StoredDocument = {
                    id: `note_${note.id}_${i}`,
                    text: sections[i],
                    vector: vector,
                    metadata: {
                        filename: note.title,
                        timestamp: note.updatedAt.getTime(),
                        chunkIndex: i,
                        totalChunks: sections.length,
                        isNote: true,
                        noteId: note.id
                    }
                };
                
                // Store in memory
                this.documents.push(doc);
                
                // Store in IndexedDB
                await db.saveKnowledge(doc);
                
                console.log(`[VectorStore] Stored section ${i + 1}/${sections.length} for note ${note.id}`);
            }
            
            // Update the store
            this.store.set(this.documents);
            
            console.log('[VectorStore] Note processed and stored successfully');
            console.log(`[VectorStore] Total documents in store: ${this.documents.length}`);
            return true;
        } catch (error) {
            console.error('[VectorStore] Failed to add note:', error);
            throw error;
        }
    }

    // Split content into chunks that fit context window
    private splitIntoSections(text: string, maxTokens: number = 3000): string[] {
        // Very rough token estimation: ~1.3 tokens per word
        const tokensPerWord = 1.3;
        const words = text.trim().split(/\s+/);
        const maxWords = Math.floor(maxTokens / tokensPerWord);
        
        // If text is small enough, return it as a single section
        if (words.length <= maxWords) {
            return [text];
        }
        
        // Split into sections
        const sections: string[] = [];
        let start = 0;
        
        while (start < words.length) {
            const end = Math.min(start + maxWords, words.length);
            sections.push(words.slice(start, end).join(' '));
            start = end;
        }
        
        return sections;
    }

    private generateVector(text: string): number[] {
        // Generate a TF-IDF style vector
        const words = text.toLowerCase()
            .split(/\W+/)
            .filter(word => word.length > 2); // Filter out very short words
        
        const vector: number[] = new Array(128).fill(0);
        const wordFreq: { [key: string]: number } = {};
        
        // Calculate term frequency
        words.forEach(word => {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        });
        
        // Generate vector using word frequencies and hash function
        Object.entries(wordFreq).forEach(([word, freq]) => {
            const hash = this.simpleHash(word);
            const idx = hash % vector.length;
            // Log-scale the frequency and normalize by document length
            vector[idx] += Math.log1p(freq) / Math.log1p(words.length);
        });
        
        // Normalize the vector
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        return vector.map(val => magnitude ? val / magnitude : 0);
    }
    
    private simpleHash(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    async search(query: string, limit: number = 3): Promise<string> {
        try {
            await this.ensureInitialized();

            if (this.documents.length === 0) {
                console.log('[VectorStore] No documents available for search');
                return '';
            }

            console.log(`[VectorStore] Searching through ${this.documents.length} documents for: "${query}"`);

            // Generate query vector
            const queryVector = this.generateVector(query);

            // Make sure all documents have vectors
            const validDocuments = this.documents.filter(doc => 
                doc && doc.vector && Array.isArray(doc.vector) && doc.vector.length > 0
            );
            
            if (validDocuments.length === 0) {
                console.log('[VectorStore] No documents with valid vectors found');
                return '';
            }
            
            console.log(`[VectorStore] Found ${validDocuments.length} documents with valid vectors`);

            // Vector similarity search with more detailed logging
            const similarities = validDocuments.map(doc => ({
                ...doc,
                similarity: this.cosineSimilarity(queryVector, doc.vector!)
            }));
            
            // Log the similarity distribution to help with threshold tuning
            if (similarities.length > 0) {
                const sortedSims = [...similarities]
                    .sort((a, b) => b.similarity - a.similarity)
                    .map(r => r.similarity);
                
                console.log('[VectorStore] Similarity distribution:', {
                    max: sortedSims[0].toFixed(4),
                    p90: sortedSims[Math.floor(sortedSims.length * 0.1)].toFixed(4),
                    median: sortedSims[Math.floor(sortedSims.length * 0.5)].toFixed(4),
                    min: sortedSims[sortedSims.length - 1].toFixed(4)
                });
            }
            
            // Use a lower threshold for production to ensure matches are found
            const similarityThreshold = this.isElectronProduction ? 0.05 : 0.1;
            console.log(`[VectorStore] Using similarity threshold: ${similarityThreshold}`);
            
            const results = similarities
                .sort((a, b) => b.similarity - a.similarity)
                .filter(r => r.similarity > similarityThreshold)
                .slice(0, limit);

            console.log('[VectorStore] Search results:', 
                results.map(r => ({
                    id: r.id,
                    similarity: r.similarity.toFixed(3),
                    preview: r.text.substring(0, 50) + '...'
                }))
            );

            if (results.length === 0) {
                console.log('[VectorStore] No relevant matches found above threshold');
                return '';
            }

            // Format results for context
            const formattedResults = results.map(result => {
                const source = result.metadata.isNote ? 
                    `Note: ${result.metadata.filename}` : 
                    `Document: ${result.metadata.filename}`;
                
                return `[Source: ${source}, Relevance: ${(result.similarity * 100).toFixed(1)}%]\n\n${result.text}\n\n`;
            }).join('---\n\n');

            return formattedResults;
        } catch (error) {
            console.error('[VectorStore] Search failed:', error);
            return '';
        }
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (!vecA || !vecB) {
            console.warn('[VectorStore] Missing vectors in similarity calculation');
            return 0;
        }
        
        if (vecA.length !== vecB.length) {
            console.warn(`[VectorStore] Vector length mismatch: ${vecA.length} vs ${vecB.length}`);
            return 0;
        }
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        
        // Extra check for zero vectors
        if (normA === 0) {
            console.warn('[VectorStore] First vector has zero magnitude');
            return 0;
        }
        
        if (normB === 0) {
            console.warn('[VectorStore] Second vector has zero magnitude');
            return 0;
        }
        
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    async removeNote(noteId: string) {
        try {
            await this.ensureInitialized();
            
            console.log('[VectorStore] Removing note:', noteId);
            
            // Get all document IDs for this note
            const docIds = this.documents
                .filter(doc => doc.metadata.isNote && doc.metadata.noteId === noteId)
                .map(doc => doc.id);
            
            console.log(`[VectorStore] Found ${docIds.length} documents to remove for note ${noteId}`);
            
            // Remove from memory
            this.documents = this.documents.filter(doc => 
                !(doc.metadata.isNote && doc.metadata.noteId === noteId)
            );
            
            // Remove from storage
            for (const docId of docIds) {
                await db.deleteKnowledge(docId);
                console.log(`[VectorStore] Removed document ${docId} from storage`);
            }
            
            // Update the store
            this.store.set(this.documents);
            
            console.log('[VectorStore] Note removed successfully');
            console.log(`[VectorStore] Total documents in store: ${this.documents.length}`);
            return true;
        } catch (error) {
            console.error('[VectorStore] Failed to remove note:', error);
            throw error;
        }
    }
}

export const vectorStore = new VectorStore();
