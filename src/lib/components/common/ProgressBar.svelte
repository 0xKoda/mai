<script lang="ts">
  export let progress = 0;
  export let text = '';
  export let showText = true;
  export let height = 'h-1.5';
  export let bgColor = 'bg-primary-200 dark:bg-primary-800';
  export let progressColor = 'bg-primary-700 dark:bg-primary-400';
</script>

<div class="w-full">
  {#if showText && text}
    <div class="text-xs text-primary-600 dark:text-primary-400 mb-1">{text}</div>
  {/if}
  <div class="w-full {height} {bgColor} rounded-full overflow-hidden">
    <div 
      class="{progressColor} h-full transition-all duration-300 ease-in-out" 
      style="width: {Math.max(2, Math.min(100, progress * 100))}%"
    ></div>
  </div>
</div>
