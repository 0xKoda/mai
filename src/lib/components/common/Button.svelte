<script lang="ts">
  export let variant: 'primary' | 'secondary' | 'outline' | 'icon' = 'primary';
  export let type: 'button' | 'submit' | 'reset' = 'button';
  export let disabled = false;
  export let className = '';
  export let ariaLabel = '';
</script>

<button
  {type}
  {disabled}
  class="btn {variant === 'primary' 
    ? 'btn-primary' 
    : variant === 'secondary' 
    ? 'btn-secondary' 
    : variant === 'outline' 
    ? 'btn-outline' 
    : 'btn-icon'} {className}"
  on:click
  aria-label={ariaLabel}
>
  <slot />
</button>

<style>
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
</style>
