<!-- src/lib/components/chat/MCPModal.svelte -->
<script lang="ts">
  import { mcpServers, type MCPServer, addMCPServer, updateMCPServer, deleteMCPServer, refreshMCPCapabilities } from '$lib/stores/mcpStore';
  import { Trash2, Plus, RefreshCw } from 'lucide-svelte';

  export let show = false;

  let newServer: Omit<MCPServer, 'id'> = {
    name: '',
    command: '',
    args: [''],
    enabled: true
  };
  
  // Track refresh operations
  let refreshingServers = new Set<string>();
  let refreshErrors = new Map<string, string>();

  function closeModal() {
    show = false;
  }

  function handleSubmit() {
    if (newServer.name && newServer.command) {
      // Filter out empty args
      const cleanArgs = newServer.args.filter(arg => arg.trim() !== '');
      addMCPServer({ ...newServer, args: cleanArgs });
      
      // Reset form
      newServer = {
        name: '',
        command: '',
        args: [''],
        enabled: true
      };
    }
  }

  function addArgField() {
    newServer.args = [...newServer.args, ''];
  }

  function removeArgField(index: number) {
    newServer.args = newServer.args.filter((_, i) => i !== index);
  }

  function handleDeleteServer(server: MCPServer) {
    if (confirm(`Are you sure you want to delete the MCP server "${server.name}"?`)) {
      deleteMCPServer(server.id);
    }
  }

  function toggleServer(server: MCPServer) {
    updateMCPServer({
      ...server,
      enabled: !server.enabled
    });
  }
  
  async function handleRefreshServer(server: MCPServer) {
    // Clear any previous errors
    refreshErrors.delete(server.id);
    refreshErrors = refreshErrors;
    
    try {
      await refreshMCPCapabilities(server.id);
    } catch (error) {
      console.error(`Error refreshing server ${server.name}:`, error);
      refreshErrors.set(server.id, error.message || 'Failed to refresh server capabilities');
      refreshErrors = refreshErrors;
    }
  }
  
  function getToolsAndPromptsCount(server: MCPServer) {
    const toolCount = server.tools?.length || 0;
    const promptCount = server.prompts?.length || 0;
    return `${toolCount} tools, ${promptCount} prompts`;
  }
</script>

{#if show}
<div class="fixed inset-0 z-50 flex items-center justify-center">
  <!-- Backdrop -->
  <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" on:click={closeModal}></div>
  
  <!-- Modal content -->
  <div 
    class="relative w-full max-w-2xl bg-[#1a1a1a] rounded-lg shadow-2xl border border-zinc-800 overflow-hidden"
    on:click|stopPropagation
  >
    <!-- Header -->
    <div class="bg-[#222222] px-5 py-3 flex items-center justify-between border-b border-zinc-800">
      <h2 class="text-xs font-medium uppercase tracking-wider text-zinc-200">MCP Servers</h2>
      <button 
        class="p-1 hover:bg-zinc-700/50 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"
        on:click={closeModal}
      >✕</button>
    </div>
    
    <div class="p-5 space-y-5">
      <!-- Add New Server Form -->
      <div class="bg-[#222222] p-4 rounded-lg border border-zinc-800">
        <h3 class="text-xs font-medium uppercase tracking-wider text-zinc-400 mb-3">Add New Server</h3>
        
        <form on:submit|preventDefault={handleSubmit} class="space-y-4">
          <div class="space-y-2">
            <label class="block text-sm text-zinc-300">
              Name
              <input 
                type="text" 
                bind:value={newServer.name}
                placeholder="e.g. rust-docs"
                class="mt-1 w-full px-3 py-2 bg-[#1a1a1a] border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-accent-500 focus:border-accent-500"
                required
              />
            </label>
          </div>
          
          <div class="space-y-2">
            <label class="block text-sm text-zinc-300">
              Command
              <input 
                type="text" 
                bind:value={newServer.command}
                placeholder="e.g. node"
                class="mt-1 w-full px-3 py-2 bg-[#1a1a1a] border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-accent-500 focus:border-accent-500"
                required
              />
            </label>
          </div>
          
          <div class="space-y-2">
            <label class="block text-sm text-zinc-300">
              Arguments
              {#each newServer.args as arg, i}
                <div class="flex gap-2 mt-2">
                  <input 
                    type="text" 
                    bind:value={newServer.args[i]}
                    placeholder="e.g. /path/to/script.js"
                    class="flex-1 px-3 py-2 bg-[#1a1a1a] border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-accent-500 focus:border-accent-500"
                  />
                  <button 
                    type="button"
                    class="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
                    on:click={() => removeArgField(i)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              {/each}
            </label>
            
            <button 
              type="button"
              class="mt-2 px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors"
              on:click={addArgField}
            >
              <Plus size={16} />
              Add Argument
            </button>
          </div>
          
          <button 
            type="submit" 
            class="w-full px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-md transition-colors"
          >
            Add Server
          </button>
        </form>
      </div>
      
      <!-- Existing Servers List -->
      <div class="bg-[#222222] p-4 rounded-lg border border-zinc-800">
        <h3 class="text-xs font-medium uppercase tracking-wider text-zinc-400 mb-3">Configured Servers</h3>
        
        {#if $mcpServers.length === 0}
          <p class="text-sm text-zinc-500">No MCP servers configured yet.</p>
        {:else}
          <div class="space-y-3">
            {#each $mcpServers as server}
              <div class="p-3 bg-[#1a1a1a] rounded-lg border border-zinc-800">
                <div class="flex items-center justify-between">
                  <div class="flex-1">
                    <div class="flex items-center gap-2">
                      <h4 class="font-medium text-zinc-200">{server.name}</h4>
                      <span class="text-xs px-2 py-0.5 rounded-full {server.enabled ? 'bg-green-500/20 text-green-400' : 'bg-zinc-500/20 text-zinc-400'}">
                        {server.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {#if server.isLoading}
                        <span class="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 animate-pulse">
                          Loading...
                        </span>
                      {/if}
                    </div>
                    <p class="text-sm text-zinc-500 mt-1">
                      {server.command} {server.args.join(' ')}
                    </p>
                  </div>
                  
                  <div class="flex items-center gap-2">
                    <button 
                      class="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors {server.isLoading ? 'opacity-50 cursor-not-allowed' : ''}"
                      on:click={() => !server.isLoading && handleRefreshServer(server)}
                      disabled={server.isLoading}
                      title="Refresh server capabilities"
                    >
                      <RefreshCw size={16} class={server.isLoading ? 'animate-spin' : ''} />
                    </button>
                    
                    <button 
                      class="px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors {server.isLoading ? 'opacity-50 cursor-not-allowed' : ''}"
                      on:click={() => !server.isLoading && toggleServer(server)}
                      disabled={server.isLoading}
                    >
                      {server.enabled ? 'Disable' : 'Enable'}
                    </button>
                    
                    <button 
                      class="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-md transition-colors {server.isLoading ? 'opacity-50 cursor-not-allowed' : ''}"
                      on:click={() => !server.isLoading && handleDeleteServer(server)}
                      disabled={server.isLoading}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                
                <!-- Server capabilities info -->
                <div class="mt-2 text-sm">
                  <div class="flex justify-between items-center">
                    <span class="text-zinc-500">
                      {getToolsAndPromptsCount(server)}
                    </span>
                  </div>
                  
                  {#if refreshErrors.has(server.id)}
                    <div class="mt-1 text-xs text-red-400">
                      Error: {refreshErrors.get(server.id)}
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
{/if}

<style>
  /* Remove any existing styles */
</style> 