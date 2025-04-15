<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Search from 'lucide-svelte/icons/search';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import ChevronUp from 'lucide-svelte/icons/chevron-up';
  import Brain from 'lucide-svelte/icons/brain';
  import { selectedModel, researchMode, aiLoading, notesDrawerVisible, researchDepth, researchBreadth, ragMode } from '$lib/stores/appStore';
  import { searchService } from '$lib/search';
  import { vectorStore } from '$lib/vectorStore';
  import { ai } from '$lib/ai';
  import { get } from 'svelte/store';
  import { fade, slide } from 'svelte/transition';
  import { onMount } from 'svelte';
  
  const dispatch = createEventDispatcher();
  let prompt = '';
  
  // Available models
  const models = [
    { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Qwen 1.5B Instruct (Default)" },
    { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", name: "Qwen 0.5B Instruct" },
    { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", name: "Llama 3.2 3B Instruct" },
    { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", name: "Qwen 3B Instruct" },
    { id: "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC", name: "Qwen Coder 0.5B" },
    { id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC", name: "Qwen Coder 1.5B" },
    { id: "Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC", name: "Qwen Math 1.5B" },
    { id: "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC", name: "Qwen Coder 7B" },
    { id: "DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC", name: "DeepSeek Llama 8B" }
  ];
  
  function handleModelChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const modelId = select.value;
    $selectedModel = modelId;
    console.log('Model changed to:', modelId);
  }
  
  // Toggle research mode function for notes
  function toggleNotesResearchMode() {
    researchMode.update(value => !value);
    console.log('Research mode toggled:', get(researchMode));
  }
  
  // Update research depth
  function updateResearchDepth(event: Event) {
    const value = parseInt((event.target as HTMLInputElement).value);
    researchDepth.set(value);
    console.log(`Research depth updated to: ${value}`);
  }
  
  // Update research breadth
  function updateResearchBreadth(event: Event) {
    const value = parseInt((event.target as HTMLInputElement).value);
    researchBreadth.set(value);
    console.log(`Research breadth updated to: ${value}`);
  }
  
  // Toggle RAG mode function
  function toggleRagMode() {
    ragMode.update(value => !value);
    console.log('RAG mode toggled:', get(ragMode));
  }
  
  // Gather context for research mode in notes
  async function gatherResearchContext(query: string): Promise<string> {
    try {
      console.log(`[Notes] Gathering research context for: ${query}`);
      
      // First, search in vector store
      const vectorResults = await vectorStore.search(query);
      
      let context = '';
      let sourcesUsed: string[] = [];
      
      // Add vector store results if available
      if (vectorResults) {
        console.log(`[Notes Research] Found vector store results for: ${query}`);
        context += '--- Knowledge Base Results ---\n\n';
        context += vectorResults;
        context += '\n\n';
      }
      
      // Get depth and breadth settings from the store
      let depth = 2;
      let breadth = 3;
      
      // Get values from the imported stores
      researchDepth.subscribe(value => { depth = value; })();
      researchBreadth.subscribe(value => { breadth = value; })();
      
      console.log(`[Notes Research] Using depth=${depth}, breadth=${breadth} for query: ${query}`);
      
      // Perform web search
      const webResults = await searchService.search(query);
      
      // Add web search results if available
      if (webResults.success && webResults.results && webResults.results.length > 0) {
        console.log(`[Notes Research] Found ${webResults.results.length} web results for: ${query}`);
        
        // Fetch content from the search results based on depth
        const { content, sources } = await searchService.fetchContentFromResults(webResults.results, depth);
        
        // Add the content to the context
        context += '--- Web Search Results ---\n\n';
        context += content;
        
        // Store the sources for citation
        sourcesUsed = sources;
        console.log(`[Notes Research] Processed ${sources.length} sources for content`);
        
        // Log the context length that will be sent to the LLM
        console.log(`[Notes Research] Total context length: ${context.length} characters`);
      } else {
        console.log(`[Notes Research] No web results found for: ${query}`);
      }
      
      // Add sources at the end of the context
      if (sourcesUsed.length > 0) {
        context += '\n\n--- Sources ---\n\n';
        sourcesUsed.forEach((source, index) => {
          context += `[${index + 1}] ${source}\n`;
        });
      }
      
      return context || 'No relevant context found.';
    } catch (error) {
      console.error('Error gathering research context for notes:', error);
      return `Error gathering research context: ${(error as Error).message}`;
    }
  }

  async function handleSubmit() {
    if (prompt.trim()) {
      try {
        let finalPrompt = prompt.trim();
        let context = '';

        // If RAG mode is active, get vector store results
        if (get(ragMode)) {
          console.log('RAG mode is active, gathering context from vector store for:', prompt);
          const vectorResults = await vectorStore.search(prompt.trim());
          if (vectorResults) {
            context = '--- Knowledge Base Context ---\n\n' + vectorResults + '\n\n';
            console.log('Vector store context gathered');
          }
        }

        // If in research mode, gather web search context
        if (get(researchMode)) {
          console.log('Research mode is active, gathering context for:', prompt);
          const researchContext = await gatherResearchContext(prompt.trim());
          context += researchContext;
        }

        // Add context to prompt if any was gathered
        if (context) {
          finalPrompt = `${prompt.trim()}\n\nContext:\n${context}`;
        }

        // Dispatch the final prompt
        dispatch('promptSubmit', finalPrompt);
        
        // Clear the prompt input
        const currentPrompt = prompt;
        prompt = '';
        
        console.log('Submitted prompt:', currentPrompt);
        
        // Auto-close the drawer after submission
        setTimeout(() => {
          notesDrawerVisible.set(false);
        }, 300);
      } catch (error) {
        console.error('Error submitting prompt:', error);
      }
    }
  }
  
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  // Reference to input element
  let inputElement: HTMLInputElement;

  onMount(() => {
    // Add global keyboard shortcut listener
    const handleKeydown = (event: KeyboardEvent) => {
      // Check for cmd+p (Mac) or ctrl+p (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === 'p') {
        event.preventDefault(); // Prevent default browser behavior
        notesDrawerVisible.set(true);
        // Focus input after a short delay to ensure drawer is visible
        setTimeout(() => {
          if (inputElement) {
            inputElement.focus();
          }
        }, 50);
      }
    };

    document.addEventListener('keydown', handleKeydown);

    return () => {
      document.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<!-- Chat input drawer that appears at the bottom of the screen -->
<div class="fixed bottom-0 left-0 right-0 z-50">
  <!-- Centered container to match content width -->
  <div class="max-w-3xl mx-auto px-4 relative">
    <!-- Toggle button for drawer visibility - only shown when drawer is hidden -->
    {#if !$notesDrawerVisible}
      <div class="flex justify-center mb-1" transition:fade={{ duration: 150 }}>
        <button 
          class="bg-white dark:bg-[#222222] rounded-t-lg px-4 py-1 shadow-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white transition-all duration-200 flex items-center gap-1 transform hover:-translate-y-0.5"
          on:click={() => notesDrawerVisible.set(true)}
          aria-label="Show AI assistant"
        >
          <ChevronUp size={16} />
          <span class="text-xs font-medium">AI Assistant</span>
          <span class="text-xs text-gray-400 dark:text-gray-500 ml-1">(⌘P)</span>
        </button>
      </div>
    {/if}
    
    <!-- The actual drawer with curved top edges - changes color based on dark/light mode -->
    {#if $notesDrawerVisible}
      <div 
        class="bg-white dark:bg-[#222222] rounded-t-xl shadow-xl overflow-hidden border border-gray-200 dark:border-gray-700 relative w-full"
        transition:slide={{ duration: 250, easing: (t) => t * (2 - t) }}
      >
        <!-- Close button at the top right -->
        <button 
          class="absolute top-2 right-2 p-1 rounded-full text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          on:click={() => notesDrawerVisible.set(false)}
          aria-label="Close assistant"
        >
          <ChevronDown size={16} />
        </button>
      <!-- Input area with placeholder -->
      <div class="p-4 pt-5">
        <div class="flex items-center">
          <input
            type="text"
            bind:value={prompt}
            bind:this={inputElement}
            placeholder="Ask anything"
            class="w-full bg-transparent border-none text-gray-800 dark:text-white focus:ring-0 focus:outline-none text-base"
            on:keydown={handleKeyDown}
          />
        </div>
      </div>
      
      <!-- Action buttons row -->
      <div class="flex items-center px-4 pb-4 space-x-2">
        <!-- RAG mode toggle -->
        <button 
          class="p-2 {$ragMode ? 'text-accent-500' : 'text-gray-500 dark:text-gray-400'} hover:text-gray-700 dark:hover:text-white rounded-full"
          aria-label="Toggle knowledge base search"
          on:click={toggleRagMode}
          title="Use knowledge base for context"
        >
          <Brain size={20} />
        </button>
        
        <!-- Search button -->
        <button 
          class="flex items-center px-3 py-1.5 {$researchMode ? 'bg-accent-500 text-white border-accent-500' : 'text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600'} hover:text-gray-800 dark:hover:text-white rounded-full border" 
          aria-label="Search"
          on:click={toggleNotesResearchMode}
        >
          <Search size={16} class="mr-1" />
          <span class="text-sm">Search</span>
        </button>
        
        <!-- Research depth controls (only visible when research mode is active) -->
        {#if $researchMode}
          <div class="flex flex-col space-y-2 ml-2 w-full max-w-xs">
            <div class="flex flex-col">
              <div class="flex justify-between items-center">
                <span class="text-xs text-gray-500 dark:text-gray-400">Depth: {$researchDepth}</span>
                <span class="text-xs text-gray-400 dark:text-gray-500">(Higher = deeper search)</span>
              </div>
              <input 
                type="range" 
                min="1" 
                max="5" 
                step="1" 
                bind:value={$researchDepth}
                on:input={updateResearchDepth}
                class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
              />
              <div class="flex justify-between text-xs mt-0.5 text-gray-400 dark:text-gray-500">
                <span>Faster</span>
                <span>Deeper</span>
              </div>
            </div>
            
            <div class="flex flex-col">
              <div class="flex justify-between items-center">
                <span class="text-xs text-gray-500 dark:text-gray-400">Breadth: {$researchBreadth}</span>
                <span class="text-xs text-gray-400 dark:text-gray-500">(Higher = more sources)</span>
              </div>
              <input 
                type="range" 
                min="2" 
                max="6" 
                step="1" 
                bind:value={$researchBreadth}
                on:input={updateResearchBreadth}
                class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
              />
              <div class="flex justify-between text-xs mt-0.5 text-gray-400 dark:text-gray-500">
                <span>Focused</span>
                <span>Broad</span>
              </div>
            </div>
          </div>
        {/if}
      </div>
      
      <!-- Model selector with standard HTML select -->
      <div class="px-4 py-2 border-t border-gray-200 dark:border-gray-700 flex justify-center">
        <div class="relative inline-block">
          <select 
            class="appearance-none bg-transparent text-xs text-gray-600 dark:text-gray-400 pr-6 focus:outline-none cursor-pointer"
            on:change={handleModelChange}
            value={$selectedModel}
            disabled={$aiLoading}
          >
            {#each models as model}
              <option value={model.id}>{model.name}</option>
            {/each}
          </select>
          <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-500 dark:text-gray-400">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
        </div>
      </div>
      
      <!-- Disclaimer text -->
      <div class="px-4 py-2 text-center text-xs text-gray-500 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800">
        AI can make mistakes. Check important info.
      </div>
    </div>
    {/if}
  </div>
</div>
