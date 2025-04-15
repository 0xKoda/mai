<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  
  export let content = '';
  
  const dispatch = createEventDispatcher();
  
  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    content = target.value;
    dispatch('change', content);
  }
  
  // Auto-resize textarea
  let textarea: HTMLTextAreaElement;
  
  function adjustHeight() {
    if (!textarea) return;
    
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    // Set the height to the scrollHeight
    textarea.style.height = `${textarea.scrollHeight}px`;
  }
  
  onMount(() => {
    adjustHeight();
  });
</script>

<div class="p-4">
  <textarea
    bind:this={textarea}
    bind:value={content}
    on:input={(e) => {
      handleInput(e);
      adjustHeight();
    }}
    class="w-full min-h-[calc(100vh-10rem)] p-4 font-serif text-lg leading-relaxed text-primary-900 dark:text-primary-100 bg-white dark:bg-primary-950 border-none focus:outline-none resize-none"
    placeholder="Start writing..."
  ></textarea>
</div>
