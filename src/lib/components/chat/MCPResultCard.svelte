<script lang="ts">
  import { CheckCircle, ChevronDown, ChevronUp } from 'lucide-svelte';
  
  export let result: string;
  export let isLoading: boolean = false;
  export let serverName: string = '';
  
  // State for collapse/expand
  let isCollapsed = true;
  
  function toggleCollapse() {
    isCollapsed = !isCollapsed;
  }
</script>

<div class="mt-3 mb-1 mcp-result-card">
  <div class="rounded-md border border-primary-200 dark:border-primary-700 overflow-hidden">
    <!-- Header section -->
    <div class="bg-primary-50 dark:bg-primary-800 py-2 px-3 flex items-center justify-between">
      <div class="flex items-center">
        <span class="text-xs font-medium text-primary-900 dark:text-primary-100">MCP execution complete</span>
        <span class="ml-2 flex items-center">
          <CheckCircle size={14} class="text-primary-600 dark:text-primary-400" />
        </span>
      </div>
      <button
        class="p-0.5 rounded hover:bg-primary-100 dark:hover:bg-primary-700 flex items-center text-primary-500 dark:text-primary-400"
        on:click={toggleCollapse}
      >
        {#if isCollapsed}
          <ChevronDown size={14} />
        {:else}
          <ChevronUp size={14} />
        {/if}
      </button>
    </div>
    
    <!-- Content section -->
    {#if !isCollapsed}
      <div class="p-3 bg-white dark:bg-primary-900 max-h-96 overflow-y-auto text-xs font-mono border-t border-primary-200 dark:border-primary-700">
        {@html result}
      </div>
    {/if}
  </div>
</div> 