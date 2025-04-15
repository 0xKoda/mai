<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { researchMode } from '$lib/stores/appStore';
  import { deepResearchDepth, deepResearchBreadth } from '$lib/stores/chatStore';
  
  let inputValue = '';
  const dispatch = createEventDispatcher();
  
  function handleSubmit() {
    if (inputValue.trim()) {
      let message = inputValue;
      
      // If research mode is enabled, prefix the message with "Deep Research:" 
      // to trigger the deep research functionality
      if ($researchMode) {
        message = `Deep Research: ${inputValue}`;
      }
      
      dispatch('submit', message);
      inputValue = '';
    }
  }
  
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }
</script>

<div class="flex-1">
  <textarea
    bind:value={inputValue}
    on:keydown={handleKeyDown}
    placeholder={$researchMode ? "Type your research query..." : "Type your message..."}
    class="w-full h-10 px-4 py-2 rounded-md border border-primary-300 dark:border-primary-700 bg-white dark:bg-primary-900 focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
  ></textarea>
  
  {#if $researchMode}
    <div class="text-xs text-primary-500 mt-1 flex justify-between">
      <span>Deep Research Mode Active</span>
      <div>
        <label class="mr-2">Depth: 
          <input 
            type="number" 
            bind:value={$deepResearchDepth} 
            min="1" 
            max="3" 
            class="w-8 text-center bg-white dark:bg-primary-800 border border-primary-300 dark:border-primary-700 rounded"
          />
        </label>
        <label>Breadth: 
          <input 
            type="number" 
            bind:value={$deepResearchBreadth} 
            min="1" 
            max="5" 
            class="w-8 text-center bg-white dark:bg-primary-800 border border-primary-300 dark:border-primary-700 rounded"
          />
        </label>
      </div>
    </div>
  {/if}
</div>
