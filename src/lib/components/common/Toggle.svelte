<script lang="ts">
  // Accept any component type for icon
  type ToggleOption = {
    value: string;
    label: string;
    icon?: any; // Using any to accommodate Lucide icons
  };

  export let options: ToggleOption[] = [];
  export let value = '';
  export let className = '';
</script>

<div class="flex rounded-md border border-primary-200 dark:border-primary-700 text-sm {className}">
  {#each options as option, index}
    <button
      class="px-3 py-1.5 transition-all duration-150 flex items-center justify-center {
        value === option.value
          ? 'bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 font-medium'
          : 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-800/70'
      } {index > 0 ? 'border-l border-primary-200 dark:border-primary-700' : ''}"
      on:click={() => (value = option.value)}
    >
      {#if option.icon}
        <svelte:component this={option.icon} size={16} class="mr-1.5" />
      {/if}
      {option.label}
    </button>
  {/each}
</div>

<style>
  button:first-child {
    border-top-left-radius: 0.25rem;
    border-bottom-left-radius: 0.25rem;
  }
  
  button:last-child {
    border-top-right-radius: 0.25rem;
    border-bottom-right-radius: 0.25rem;
  }
</style>
