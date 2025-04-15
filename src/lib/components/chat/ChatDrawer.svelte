<script lang="ts">
  import { onMount } from 'svelte';
  import { activeChat, addMessage } from '$lib/stores/chatStore';
  import Button from '$lib/components/common/Button.svelte';
  import { Settings, X, Cpu } from 'lucide-svelte';
  
  export let onClose = () => {};
  
  let isOpen = false;
  let isLoading = false;
  let selectedModel = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
  let prompt = '';
  let modelOptions = [
    { 
      id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 
      name: 'Qwen 1.5B Instruct (Default)', 
      description: 'Fast, lightweight model for general use'
    },
    { 
      id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', 
      name: 'Qwen 0.5B Instruct', 
      description: 'Ultra-lightweight model for quick responses'
    },
    { 
      id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', 
      name: 'Llama 3.2 3B Instruct', 
      description: 'Balanced performance and quality'
    },
    { 
      id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', 
      name: 'Qwen 3B Instruct', 
      description: 'Better quality responses with reasonable speed'
    },
    { 
      id: 'Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC', 
      name: 'Qwen Coder 0.5B', 
      description: 'Specialized for coding tasks (small)'
    },
    { 
      id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', 
      name: 'Qwen Coder 1.5B', 
      description: 'Specialized for coding tasks (medium)'
    },
    { 
      id: 'Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC', 
      name: 'Qwen Math 1.5B', 
      description: 'Specialized for mathematical reasoning'
    },
    { 
      id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC', 
      name: 'Qwen Coder 7B', 
      description: 'Advanced coding capabilities (large)'
    },
    { 
      id: 'DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC', 
      name: 'DeepSeek Llama 8B', 
      description: 'Powerful general-purpose model'
    }
  ];
  
  // Mock function for model loading and inference
  // In a real implementation, this would use transformers.js
  async function runInference() {
    if (!prompt.trim() || !$activeChat) return;
    
    isLoading = true;
    
    // Add user message to chat
    addMessage(prompt, 'user');
    
    // Simulate model inference
    setTimeout(() => {
      addMessage(`This is a simulated response to: "${prompt}"\n\nIn a real implementation, this would use transformers.js to run the ${selectedModel} model locally in the browser.`, 'assistant');
      
      prompt = '';
      isLoading = false;
      onClose();
    }, 1500);
  }
  
  function toggleDrawer() {
    isOpen = !isOpen;
    if (!isOpen) {
      onClose();
    }
  }
  
  function handleSettingsClick() {
    // Handle settings click
    console.log('Advanced settings clicked');
  }
  
  onMount(() => {
    isOpen = true;
  });
</script>

<!-- Chat drawer that appears at the bottom of the screen -->
<div class="fixed bottom-0 left-0 right-0 z-50">
  <!-- Main chat input container with curved top edges -->
  <div class="max-w-3xl mx-auto mb-4 px-4">
    <!-- The actual drawer with curved top edges -->
    <div class="bg-[#222222] rounded-t-2xl shadow-xl overflow-hidden border border-gray-700 transform transition-transform duration-300 {isOpen ? 'translate-y-0' : 'translate-y-full'}">
      <!-- Input area with placeholder -->
      <div class="p-4">
        <div class="flex items-center">
          <input
            type="text"
            bind:value={prompt}
            placeholder="Ask anything"
            class="w-full bg-transparent border-none text-white focus:ring-0 focus:outline-none text-base"
          />
        </div>
      </div>
      
      <!-- Action buttons row -->
      <div class="flex items-center px-4 pb-4 space-x-2">
        <!-- Search button -->
        <button class="flex items-center px-3 py-1.5 text-gray-400 hover:text-white rounded-full border border-gray-600" aria-label="Search">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <span class="text-sm">Search</span>
        </button>
      </div>

      <!-- Disclaimer text -->
      <div class="px-4 py-2 text-center text-xs text-gray-500">
        AI can make mistakes. Check important info.
      </div>
    </div>
  </div>
</div>

<!-- Toggle button to open/close the drawer -->
<button 
  class="fixed bottom-4 right-4 p-3 bg-primary-600 hover:bg-primary-500 text-white rounded-full shadow-lg transition-colors z-50"
  on:click={toggleDrawer}
  aria-label="{isOpen ? 'Close chat' : 'Open chat'}"
>
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    {#if isOpen}
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    {:else}
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    {/if}
  </svg>
</button>
