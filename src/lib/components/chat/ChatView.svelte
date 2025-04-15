<script lang="ts">
  import { activeChat, addMessage, toggleResearchMode, approveMCPExecution, denyMCPExecution, extractMCPInfo } from '$lib/stores/chatStore';
  import { Search, Paperclip, Send, Terminal } from 'lucide-svelte';
  import Button from '$lib/components/common/Button.svelte';
  import ProgressBar from '$lib/components/common/ProgressBar.svelte';
  import MCPModal from './MCPModal.svelte';
  import { selectedModel, researchMode, aiLoading, aiLoadingProgress, researchDepth, researchBreadth } from '$lib/stores/appStore';
  import { AVAILABLE_MODELS, ai } from '$lib/ai';
  import MCPApprovalCard from './MCPApprovalCard.svelte';
  import MCPResultCard from './MCPResultCard.svelte';
  import { onMount } from 'svelte';
  
  // Available models with display names
  const models = [
    { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Qwen 1.5B Instruct (Default)" },
    { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", name: "Qwen 0.5B Instruct" },
    { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", name: "Llama 3.2 3B Instruct" },
    { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", name: "Qwen 3B Instruct" },
    { id: "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC", name: "Qwen Coder 0.5B" },
    { id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC", name: "Qwen Coder 1.5B" },
    { id: "Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC", name: "Qwen Math 1.5B" },
    { id: "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC", name: "Qwen Coder 7B" },
    { id: "DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC", name: "DeepSeek Llama 8B" }
  ];
  
  // Add MCP modal state
  let showMCPModal = false;
  
  async function handleModelChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const modelId = select.value;
    
    if (modelId !== $selectedModel) {
      console.log('Loading model:', modelId);
      try {
        // Initialize the model
        await ai.init(modelId);
        console.log('Model loaded successfully:', modelId);
      } catch (error) {
        console.error('Failed to load model:', error);
        // Revert to previous model in case of error
        select.value = $selectedModel;
      }
    }
  }
  
  function handleSubmit(event: CustomEvent<string>) {
    if ($activeChat) {
      addMessage(event.detail, 'user');
    }
  }
  
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const target = event.target as HTMLInputElement;
      if (target && target.value.trim()) {
        handleSubmit(new CustomEvent('submit', { detail: target.value }));
        target.value = '';
      }
    }
  }
  
  // Update research depth
  function updateResearchDepth(event: Event) {
    const value = parseInt((event.target as HTMLInputElement).value);
    researchDepth.set(value);
    console.log(`Research depth updated to: ${value}`);
  }
  
  // Update research breadth
  function updateResearchBreadth(event: Event) {
    const value = parseInt((event.target as HTMLInputElement).value);
    researchBreadth.set(value);
    console.log(`Research breadth updated to: ${value}`);
  }

  // Function to process message content for display
  function processMessageContent(message: any) {
    try {
      if (!message || !message.content) {
        console.log('[ChatView] Invalid message in processMessageContent');
        return {
          displayContent: message?.content || '',
          message,
          showApproval: false
        };
      }

      // If message already has pendingMCP and is approved/denied, don't reprocess
      if (message.pendingMCP && message.pendingMCP.status !== 'pending') {
        return {
          displayContent: message.content,
          message,
          showApproval: false
        };
      }

      if (message.role === 'assistant') {
        const mcpInfo = extractMCPInfo(message.content);
        if (mcpInfo) {
          console.log('[ChatView] Processing message with MCP info:', mcpInfo);
          
          // Only update pendingMCP if it doesn't exist or is pending
          if (!message.pendingMCP || message.pendingMCP.status === 'pending') {
            const updatedMessage = {
              ...message,
              pendingMCP: {
                serverName: mcpInfo.serverName,
                tool: mcpInfo.tool,
                args: mcpInfo.args,
                status: 'pending'
              }
            };

            // Update the message in the active chat - but only if needed
            if (!message.pendingMCP) {
              activeChat.update(chat => {
                if (!chat) return null;
                const messages = [...chat.messages];
                const index = messages.findIndex(m => m.id === message.id);
                if (index !== -1) {
                  messages[index] = updatedMessage;
                }
                return { ...chat, messages };
              });
            }

            return {
              displayContent: mcpInfo.remainingContent || '',
              message: updatedMessage,
              showApproval: true,
              mcpInfo
            };
          }
        }
      }

      return {
        displayContent: message.content,
        message,
        showApproval: false
      };
    } catch (error) {
      console.error('[ChatView] Error in processMessageContent:', error);
      return {
        displayContent: message?.content || '',
        message,
        showApproval: false
      };
    }
  }

  // Enhanced approve handler
  async function handleApproveClick(messageId: string) {
    console.log('[ChatView] Approve clicked for message:', messageId);
    
    const chat = $activeChat;
    if (!chat) return;
    
    const message = chat.messages.find(m => m.id === messageId);
    if (!message) return;

    // Use rawContent if available, otherwise fall back to content
    const contentToCheck = message.rawContent || message.content;
    
    const mcpInfo = extractMCPInfo(contentToCheck);
    if (!mcpInfo) {
      console.error('[ChatView] Could not extract MCP info from approved message using content:', contentToCheck);
      return;
    }

    console.log('[ChatView] Executing MCP with:', mcpInfo);
    
    try {
      // Call the store's approve function with the extracted info
      await approveMCPExecution(messageId);
    } catch (error) {
      console.error('[ChatView] Error during MCP execution:', error);
    }
  }

  function handleDenyClick(messageId: string) {
    console.log('[ChatView] Deny clicked for message:', messageId);
    denyMCPExecution(messageId);
  }
</script>

<div class="flex flex-col h-full">
  <!-- Main scrollable container with proper padding to account for fixed drawer -->
  <div class="flex-1 overflow-y-auto p-4 pb-64"> <!-- Added significant bottom padding to ensure content isn't hidden -->
    <!-- Message container with spacing between messages -->
    <div class="w-full max-w-3xl mx-auto space-y-10"> <!-- Increased spacing between messages -->
      {#if $activeChat && $activeChat.messages}
        {#each $activeChat.messages.filter(m => m.role !== 'system') as message (message.id)}
          {@const processedMessage = processMessageContent(message)}
          <div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'} my-3">
            <div 
              class="max-w-3/4 rounded-lg p-4 shadow-sm {message.role === 'user' 
                ? 'bg-accent-500 text-white' 
                : 'bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100'}"
            >
              <!-- Regular message content -->
              <div class="prose dark:prose-invert prose-headings:mt-4 prose-headings:mb-2 !max-w-none">
                {#if message.role === 'assistant' && message.content.includes('MCP Server') && message.content.includes('execution result')}
                  <MCPResultCard 
                    result={message.content}
                    isLoading={false}
                    serverName={message.content.split('"')[1]} 
                  />
                {:else}
                  {@html processedMessage.displayContent}
                {/if}
              </div>
              
              <!-- Show MCP Approval Card if needed -->
              {#if processedMessage.showApproval || (message.role === 'assistant' && message.pendingMCP?.status === 'pending')}
                <MCPApprovalCard 
                  serverName={processedMessage.message.pendingMCP.serverName}
                  messageId={message.id}
                  onApprove={handleApproveClick}
                  onDeny={handleDenyClick}
                />
                
                <!-- Optional: Show raw XML in collapsible section -->
                <details class="mt-2 text-xs">
                  <summary class="cursor-pointer text-gray-500">Show raw MCP request</summary>
                  <pre class="whitespace-pre-wrap mt-2 bg-gray-100 dark:bg-gray-700 p-2 rounded">{message.rawContent || message.content}</pre>
                </details>
              {/if}

              <!-- Message timestamp -->
              <div class="text-xs mt-2 opacity-70 text-right">
                {new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.timestamp))}
              </div>
            </div>
          </div>
        {/each}
      {:else}
        <div class="flex items-center justify-center h-full">
          <p class="text-primary-500 dark:text-primary-400">Select a chat or create a new one</p>
        </div>
      {/if}
    </div>
  </div>
  
  <!-- Chat input drawer that appears at the bottom of the screen -->
  <div class="fixed bottom-0 left-0 right-0 z-40"> <!-- Fixed positioning at bottom -->
    <!-- Main chat input container with curved top edges - centered to match content -->
    <div class="max-w-3xl mx-auto px-4">
      <!-- The actual drawer with curved top edges - changes color based on dark/light mode -->
      <div class="bg-white dark:bg-[#222222] rounded-t-xl shadow-xl overflow-hidden border border-gray-200 dark:border-transparent">
        <!-- Input area with placeholder -->
        <div class="p-4">
          <div class="flex items-center">
            <input
              type="text"
              placeholder="Ask anything"
              class="w-full bg-transparent border-none text-gray-800 dark:text-white focus:ring-0 focus:outline-none text-base"
              on:keydown={handleKeyDown}
              disabled={$aiLoading}
            />
            {#if $aiLoading}
              <span class="ml-2 text-xs text-primary-500 dark:text-primary-400">Thinking...</span>
            {/if}
          </div>
        </div>
        
        <!-- Action buttons row - simplified with just attach and search -->
        <div class="flex items-center px-4 pb-4 space-x-2">
          <!-- Attach button -->
          <button class="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white rounded-full" aria-label="Attach file">
            <Paperclip size={20} />
          </button>
          
          <!-- MCP button -->
          <button 
            class="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white rounded-full" 
            aria-label="Configure MCP"
            on:click={() => showMCPModal = true}
          >
            <Terminal size={20} />
          </button>
          
          <!-- Search button -->
          <button 
            class="flex items-center px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white rounded-full border border-gray-300 dark:border-gray-600" 
            aria-label="Search"
            on:click={toggleResearchMode}
          >
            <Search size={16} class="mr-1 {$researchMode ? 'text-accent-500' : ''}" />
            <span class="text-sm">Search</span>
          </button>
          
          <!-- Research depth controls (only visible when research mode is active) -->
          {#if $researchMode}
            <div class="flex flex-col space-y-2 ml-2 w-full max-w-xs">
              <div class="flex flex-col">
                <div class="flex justify-between items-center">
                  <span class="text-xs text-gray-500 dark:text-gray-400">Depth: {$researchDepth}</span>
                  <span class="text-xs text-gray-400 dark:text-gray-500">(Higher = deeper search)</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="5" 
                  step="1" 
                  bind:value={$researchDepth}
                  on:input={updateResearchDepth}
                  class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
                />
                <div class="flex justify-between text-xs mt-0.5 text-gray-400 dark:text-gray-500">
                  <span>Faster</span>
                  <span>Deeper</span>
                </div>
              </div>
              
              <div class="flex flex-col">
                <div class="flex justify-between items-center">
                  <span class="text-xs text-gray-500 dark:text-gray-400">Breadth: {$researchBreadth}</span>
                  <span class="text-xs text-gray-400 dark:text-gray-500">(Higher = more sources)</span>
                </div>
                <input 
                  type="range" 
                  min="2" 
                  max="6" 
                  step="1" 
                  bind:value={$researchBreadth}
                  on:input={updateResearchBreadth}
                  class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
                />
                <div class="flex justify-between text-xs mt-0.5 text-gray-400 dark:text-gray-500">
                  <span>Focused</span>
                  <span>Broad</span>
                </div>
              </div>
            </div>
          {/if}
          
          <!-- Spacer to push buttons to the left -->
          <div class="ml-auto"></div>
        </div>
        
        <!-- Model selector with standard HTML select -->
        <div class="px-4 py-2 border-t border-gray-200 dark:border-gray-700 flex flex-col items-center">
          {#if $aiLoading}
            <div class="w-full max-w-xs mb-2">
              <ProgressBar progress={$aiLoadingProgress.progress} text={$aiLoadingProgress.text} />
            </div>
          {/if}
          
          <div class="relative inline-block">
            <select 
              class="appearance-none bg-transparent text-xs text-gray-600 dark:text-gray-400 pr-6 focus:outline-none cursor-pointer"
              on:change={handleModelChange}
              value={$selectedModel}
              disabled={$aiLoading}
            >
              {#each models as model}
                <option value={model.id}>{model.name}</option>
              {/each}
            </select>
            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-500 dark:text-gray-400">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>
        
        <!-- Disclaimer text -->
        <div class="px-4 py-2 text-center text-xs text-gray-500 dark:text-gray-500">
          AI can make mistakes. Check important info.
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Add MCP Modal -->
<MCPModal bind:show={showMCPModal} />
