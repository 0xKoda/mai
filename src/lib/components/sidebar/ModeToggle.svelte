<script lang="ts">
  import { appMode } from '$lib/stores/appStore';
  import Toggle from '$lib/components/common/Toggle.svelte';
  import { MessageSquare, FileText } from 'lucide-svelte';
  
  // Define options with proper typing
  const options = [
    { value: 'notes', label: 'Notes', icon: FileText },
    { value: 'chat', label: 'Chat', icon: MessageSquare }
  ];
</script>

<div class="flex items-center">
  <Toggle
    options={options}
    bind:value={$appMode}
    className="text-sm"
  />
</div>
