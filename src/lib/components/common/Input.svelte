<script lang="ts">
  export let type: 'text' | 'password' | 'email' | 'number' = 'text';
  export let placeholder = '';
  export let value = '';
  export let disabled = false;
  export let className = '';
</script>

<input
  {type}
  {placeholder}
  {disabled}
  bind:value
  class="input {className}"
  on:input
  on:change
  on:focus
  on:blur
/>

<style>
  input {
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  
  input::placeholder {
    color: theme('colors.primary.400');
    opacity: 1;
  }
  
  input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
