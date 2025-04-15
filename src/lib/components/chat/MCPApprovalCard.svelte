<script lang="ts">
  import Button from '$lib/components/common/Button.svelte';
  import { Terminal, Check, X } from 'lucide-svelte'; // Import icons

  export let serverName: string;
  export let messageId: string;
  export let onApprove: (id: string) => void;
  export let onDeny: (id: string) => void;

  const handleApprove = () => {
    onApprove(messageId);
  };

  const handleDeny = () => {
    onDeny(messageId);
  };
</script>

<div class="mt-3 pt-3 border-t border-primary-200 dark:border-primary-700">
  <div class="bg-primary-50 dark:bg-primary-900 rounded-md p-4 shadow-sm border border-primary-200 dark:border-primary-700">
    
    <!-- Header -->
    <div class="flex justify-between items-center mb-3 text-xs text-primary-500 dark:text-primary-400">
      <span>MCP Action Required</span>
      <span class="flex items-center">
        <Terminal size={12} class="mr-1" />
        {serverName}
      </span>
    </div>

    <!-- Main Content -->
    <div class="flex items-center mb-4">
      <div class="ml-1">
        <div class="text-sm font-medium text-primary-900 dark:text-primary-100">
          Execute {serverName}?
        </div>
        <div class="text-xs text-primary-600 dark:text-primary-400 flex items-center mt-1">
           <span class="relative flex h-2 w-2 mr-1.5">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-400 dark:bg-primary-500 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-primary-500 dark:bg-primary-400"></span>
           </span>
          Pending User Approval
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="grid grid-cols-2 gap-3">
       <!-- Deny Button -->
       <Button 
         variant="outline" 
         className="w-full text-xs py-1 flex items-center justify-center !border-primary-300 dark:!border-primary-700"
         on:click={handleDeny}
         ariaLabel="Deny MCP execution"
       >
         <X size={14} class="mr-1"/> Deny
       </Button>
       
       <!-- Approve Button -->
       <Button 
         variant="primary" 
         className="w-full text-xs py-1 flex items-center justify-center"
         on:click={handleApprove}
         ariaLabel="Approve MCP execution"
       >
         <Check size={14} class="mr-1"/> Approve
       </Button>
    </div>
  </div>
</div> 