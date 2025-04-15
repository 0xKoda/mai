<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { Trash2, Brain } from 'lucide-svelte';
  
  export let title = 'Untitled';
  export let active = false;
  export let id = '';
  export let isInKnowledgeBase = false;
  export let showKnowledgeToggle = false;
  
  const dispatch = createEventDispatcher();
  
  function handleDelete(event: MouseEvent) {
    event.stopPropagation(); // Prevent triggering the parent click event
    dispatch('delete', { id });
  }
  
  function handleKnowledgeToggle(event: MouseEvent) {
    event.stopPropagation(); // Prevent triggering the parent click event
    dispatch('toggleKnowledge', { id });
  }
</script>

<div 
  class="sidebar-item {active ? 'sidebar-item-active' : ''} mx-2 mb-1 flex items-center justify-between group"
  on:click
  on:keydown={(e) => e.key === 'Enter' && e.currentTarget.click()}
  tabindex="0"
  role="button"
  aria-pressed={active}
>
  <span class="truncate">{title}</span>
  <div class="flex">
    {#if showKnowledgeToggle}
      <button 
        class="text-gray-400 hover:text-primary-500 p-1 {isInKnowledgeBase ? 'knowledge-active opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-200"
        on:click={handleKnowledgeToggle}
        aria-label={isInKnowledgeBase ? "Remove from knowledge base" : "Add to knowledge base"}
        title={isInKnowledgeBase ? "Remove from knowledge base" : "Add to knowledge base"}
      >
        <Brain size={16} />
      </button>
    {/if}
    <button 
      class="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1"
      on:click={handleDelete}
      aria-label="Delete item"
    >
      <Trash2 size={16} />
    </button>
  </div>
</div>

<style>
  /* Control icon visibility through opacity */
  .sidebar-item .knowledge-active {
    color: #4299e1; /* A bright blue color to indicate active state */
    opacity: 1 !important;
  }
</style>
