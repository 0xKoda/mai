import { writable, get } from 'svelte/store';
import { ai, DEFAULT_MODELS } from '$lib/ai';
import { vectorStore } from '$lib/vectorStore';
import { searchService } from '$lib/search';
import { selectedModel, researchMode, researchDepth, researchBreadth } from '$lib/stores/appStore';
import { mcpServers, getMCPSystemPrompt, type MCPServer, type MCPTool, executeMCPServer, refreshMCPCapabilities } from '$lib/stores/mcpStore';
import { db } from '$lib/db';
import { marked } from 'marked';
import type { SearchResult } from '$lib/search';

// Message types
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string; // Parsed content for display
  rawContent?: string; // Raw content, especially for assistant messages with MCP
  timestamp: Date;
  context?: string;
  sources?: SearchResult[];
  pendingMCP?: { 
    serverName: string;
    tool: string;
    args: string[];
    status: 'pending' | 'approved' | 'denied';
    executionState?: 'executing' | 'complete' | 'error';
  };
}



// Chat type
export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  model: string;
}

// Default chat to use if no chats are found in the database
const defaultChats: Chat[] = [
  {
    id: '1',
    title: 'First Chat',
    messages: [
      {
        id: '1',
        role: 'system',
        content: 'You are a helpful assistant.',
        timestamp: new Date()
      },
      {
        id: '2',
        role: 'user',
        content: 'Hello, how can you help me?',
        timestamp: new Date()
      },
      {
        id: '3',
        role: 'assistant',
        content: 'I can help you with a variety of tasks including answering questions, providing information, assisting with writing, and more. What would you like help with today?',
        timestamp: new Date()
      }
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    model: 'default'
  }
];

// Create the chats store with empty initial state
export const chats = writable<Chat[]>([]);

// Currently active chat
export const activeChat = writable<Chat | null>(null);

// Load chats from database
export async function loadChats() {
  try {
    const storedChats = await db.getAllChats();
    
    // If no chats found in database, use default chats
    if (storedChats.length === 0) {
      chats.set(defaultChats);
      // Save default chats to database
      for (const chat of defaultChats) {
        await db.saveChat(chat);
      }
    } else {
      chats.set(storedChats);
    }
    
    // Set the first chat as active if none is active
    const currentChats = get(chats);
    if (currentChats.length > 0 && !get(activeChat)) {
      activeChat.set(currentChats[0]);
    }
  } catch (error) {
    console.error('Error loading chats from database:', error);
    chats.set(defaultChats);
  }
}

// Research mode and selected model are imported from appStore

// Create a new chat
export function createChat() {
  const isResearchMode = get(researchMode);
  
  // Different system prompts for research mode vs normal mode
  let systemPrompt;
  if (isResearchMode) {
    systemPrompt = `You are a research assistant with access to web search results. Your task is to:
1. Analyze the web content provided with each query
2. Synthesize information from multiple sources
3. Provide accurate, well-reasoned answers
4. Always cite your sources when making specific claims
5. If the search results don't contain enough information, say so

When responding:
- Focus on the search results provided
- Be concise but thorough
- Include relevant quotes when helpful
- Maintain a professional tone
- Acknowledge any limitations in the search results`;
  } else {
    // Normal MCP mode
    const basePrompt = "You are a helpful assistant with access to MCP (Model Context Protocol) servers.\n\n";
    const mcpServersPrompt = getMCPSystemPrompt();
    systemPrompt = basePrompt + mcpServersPrompt;
  }

  // Log the constructed system prompt
  console.log('[ChatStore] New chat created with system prompt:', systemPrompt);

  const newChat: Chat = {
    id: Date.now().toString(),
    title: 'New Chat',
    messages: [
      {
        id: Date.now().toString(),
        role: 'system',
        content: systemPrompt,
        timestamp: new Date()
      }
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    model: ''
  };
  
  // Set the model from the selectedModel store
  let modelValue = '';
  selectedModel.subscribe(value => { modelValue = value; })();
  newChat.model = modelValue;

  chats.update((currentChats) => {
    return [newChat, ...currentChats];
  });

  activeChat.set(newChat);
  
  // Save to database
  db.saveChat(newChat).catch(error => {
    console.error('Error saving new chat to database:', error);
  });
  
  return newChat;
}

// Create a message with string content
function createMessage(content: string, role: 'user' | 'assistant' | 'system'): Message {
  return {
    id: Date.now().toString(),
    role,
    content,
    timestamp: new Date()
  };
}

// Update chat with a new message
function updateChatWithMessage(chat: Chat, message: Message, messageRole: 'user' | 'assistant' | 'system', content: string): Chat {
  return {
    ...chat,
    messages: [...chat.messages, message],
    updatedAt: new Date(),
    title: chat.messages.length === 1 && chat.messages[0].role === 'system' && messageRole === 'user'
      ? content.substring(0, 30) + (content.length > 30 ? '...' : '')
      : chat.title
  };
}

// Individual tag patterns for MCP detection
const MCP_CALL_REGEX = /<mcp_call>\s*<server>([^<]+)<\/server>\s*<args>([^<]*)<\/args>\s*<tool>([^<]+)<\/tool>\s*<\/mcp_call>/;

// Helper to extract MCP info from content
export function extractMCPInfo(content: string) {
  try {
    // Return null immediately if in research mode
    const isResearchMode = get(researchMode);
    if (isResearchMode) {
      console.log('[ChatStore] Skipping MCP extraction - research mode active');
      return null;
    }

    if (!content) {
      console.log('[ChatStore] No content provided to extractMCPInfo');
      return null;
    }

    const mcpMatch = content.match(MCP_CALL_REGEX);
    if (!mcpMatch) {
      console.log('[ChatStore] No valid MCP call found in content');
      return null;
    }

    const [fullXml, serverName, argsStr, toolName] = mcpMatch;
    console.log('[ChatStore] Found MCP block:', { serverName, toolName, argsStr });

    // Parse args properly - handle both comma-separated and newline-separated args
    const args = argsStr.trim()
      ? argsStr.split(/[,\n]/).map(arg => arg.trim()).filter(arg => arg.length > 0)
      : [];

    // For tool execution, the tool name should be the first arg
    const result = {
      serverName: serverName.trim(),
      tool: toolName.trim(),
      args: [toolName.trim(), ...args],
      fullXml,
      remainingContent: content.replace(fullXml, '').trim()
    };

    console.log('[ChatStore] Extracted MCP info:', result);
    return result;
  } catch (error) {
    console.error('[ChatStore] Error extracting MCP info:', error);
    return null;
  }
}

// Helper to validate MCP tool exists
async function validateMCPTool(serverName: string, toolName: string): Promise<{ server: MCPServer, tool: MCPTool } | null> {
  console.log(`[ChatStore] Validating MCP tool: server='${serverName}', tool='${toolName}'`);
  
  const availableServers = get(mcpServers);
  console.log(`[ChatStore] Available servers:`, availableServers.map(s => ({ name: s.name, enabled: s.enabled, toolCount: s.tools?.length || 0 })));
  
  // Find the server by name (case-insensitive)
  const server = availableServers.find(s => 
    s.name.toLowerCase() === serverName.trim().toLowerCase() && s.enabled
  );
  
  if (!server) {
    console.error(`[ChatStore] Server not found or not enabled: '${serverName}'`);
    return null;
  }
  
  console.log(`[ChatStore] Found server: ${server.name}, tools:`, server.tools);
  
  // If server has no tools, try to refresh capabilities
  if (!server.tools || server.tools.length === 0) {
    console.log(`[ChatStore] Server has no tools, attempting to refresh capabilities`);
    try {
      await refreshMCPCapabilities(server.id);
      // Get updated server after refresh
      const updatedServers = get(mcpServers);
      const updatedServer = updatedServers.find(s => s.id === server.id);
      if (updatedServer && updatedServer.tools && updatedServer.tools.length > 0) {
        console.log(`[ChatStore] Successfully refreshed tools for ${updatedServer.name}:`, updatedServer.tools);
      } else {
        console.error(`[ChatStore] Failed to refresh tools for ${server.name}`);
      }
    } catch (error) {
      console.error(`[ChatStore] Error refreshing capabilities:`, error);
    }
  }
  
  // Find the tool by name (case-insensitive)
  const tool = server.tools?.find(t => 
    t.name.toLowerCase() === toolName.trim().toLowerCase()
  );
  
  if (!tool) {
    console.error(`[ChatStore] Tool not found: '${toolName}' in server '${server.name}'`);
    console.log(`[ChatStore] Available tools:`, server.tools);
    return null;
  }
  
  console.log(`[ChatStore] Found tool: ${tool.name} in server ${server.name}`);
  return { server, tool };
}

// Add message to the active chat - Simplified, primarily for user messages now
export async function addMessage(content: string | Promise<string>, messageRole: 'user' | 'assistant' | 'system') {
  const chat = get(activeChat);
  if (!chat) {
    console.error('[ChatStore] Cannot add message, no active chat');
    return;
  }

  const resolvedContent = await Promise.resolve(content);
  console.log(`[ChatStore] Processing message (role: ${messageRole}):`, resolvedContent.substring(0, 100) + (resolvedContent.length > 100 ? '...' : ''));
  
  // Create base message
  let message = createMessage(resolvedContent, messageRole);

  // Add research context and sources if needed for user messages
  if (messageRole === 'user') {
    const isResearchMode = get(researchMode);
    if (isResearchMode) {
      console.log('[ChatStore] Gathering research context for user message');
      // Update gatherResearchContext call to expect an object
      const contextResult = await gatherResearchContext(resolvedContent);
      if (contextResult) {
        message.context = contextResult.context; // Store context string
        message.sources = contextResult.sources; // Store sources array
      }
    }
  }

  // Update chat with new message
  const updatedChat = updateChatWithMessage(chat, message, messageRole, resolvedContent);
  activeChat.set(updatedChat);
  chats.update(currentChats => currentChats.map(c => c.id === updatedChat.id ? updatedChat : c));

  // Save to database
  try {
    await db.saveChat(updatedChat);
    console.log(`[ChatStore] Saved chat after adding message ID: ${message.id}`);
  } catch (error) {
    console.error('Error saving chat to database:', error);;
  }

  // Trigger AI response for user messages, but NOT for assistant messages showing results
  if (messageRole === 'user') {
    console.log('[ChatStore] User message added, triggering AI response generation');
    // Ensure any previous AI generation is stopped if needed (or let it finish)
    // Add a slight delay to ensure state updates settle before generating
    setTimeout(() => generateAIResponse(), 50); 
  } else {
     console.log(`[ChatStore] Assistant/System message added (ID: ${message.id}), NOT triggering AI response.`);
  }

  return message;
}


// Handle MCP approval
export async function handleMCPApproval(messageId: string, approved: boolean) {
  const chat = get(activeChat);
  if (!chat) return;

  const message = chat.messages.find(m => m.id === messageId);
  if (!message?.pendingMCP) return;

  message.pendingMCP.status = approved ? 'approved' : 'denied';
  activeChat.set(chat);

  if (approved && message.pendingMCP) {
    const { serverName, tool, args } = message.pendingMCP;
    console.log(`[ChatStore] Executing MCP call: server="${serverName}", tool="${tool}", Args:`, args);
    try {
      const result = await executeMCPServer(serverName, args);
      await addMessage(`MCP Server '${serverName}' execution result:\n\n${JSON.stringify(result, null, 2)}`, 'assistant');
    } catch (error: unknown) {
      console.error('[ChatStore] Error executing MCP server:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await addMessage(`Error executing MCP server '${serverName}': ${errorMessage}`, 'assistant');
    }
  }
}
// Delete a chat
export function deleteChat(id: string) {
  chats.update((currentChats) => {
    return currentChats.filter((chat) => chat.id !== id);
  });

  // If the active chat was deleted, set the first chat as active
  activeChat.update((current) => {
    if (current && current.id === id) {
      return null;
    }
    return current;
  });
  
  // Delete from database
  db.deleteChat(id).catch(error => {
    console.error('Error deleting chat from database:', error);
  });
}

// Set active chat
export function setActiveChat(id: string) {
  chats.subscribe((currentChats) => {
    const chat = currentChats.find((chat) => chat.id === id);
    if (chat) {
      activeChat.set(chat);
    }
  })();
}

// Toggle research mode
export function toggleResearchMode() {
  researchMode.update((mode) => !mode);
  
  // Get the current chat
  const chat = get(activeChat);
  if (!chat) return;
  
  // Update the system prompt based on the new mode
  const newMode = get(researchMode);
  let newSystemPrompt;
  
  if (newMode) {
    // Research mode system prompt
    newSystemPrompt = `You are a research assistant with access to web search results. Your task is to:
1. Analyze the web content provided with each query
2. Synthesize information from multiple sources
3. Provide accurate, well-reasoned answers
4. Always cite your sources when making specific claims
5. If the search results don't contain enough information, say so

When responding:
- Focus on the search results provided
- Be concise but thorough
- Include relevant quotes when helpful
- Maintain a professional tone
- Acknowledge any limitations in the search results`;
  } else {
    // Normal MCP mode
    const basePrompt = "You are a helpful assistant with access to MCP (Model Context Protocol) servers.\n\n";
    const mcpServersPrompt = getMCPSystemPrompt();
    newSystemPrompt = basePrompt + mcpServersPrompt;
  }
  
  // Update the system message in the chat
  const updatedMessages = chat.messages.map(msg => 
    msg.role === 'system' ? { ...msg, content: newSystemPrompt } : msg
  );
  
  // Update the chat
  const updatedChat = { ...chat, messages: updatedMessages };
  activeChat.set(updatedChat);
  
  // Save to database
  chats.update(currentChats => 
    currentChats.map(c => c.id === chat.id ? updatedChat : c)
  );
  db.saveChat(updatedChat).catch(error => {
    console.error('[ChatStore] Error saving updated chat after mode toggle:', error);
  });
}

// Deep research settings
export const deepResearchDepth = writable(2); // Default depth for deep research
export const deepResearchBreadth = writable(3); // Default breadth for deep research

// Define the AIChatMessage type explicitly if not already done
interface AIChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

// Generate AI response - Now accepts optional tool result context
export async function generateAIResponse(toolResultContext?: string) {
  const currentChat = get(activeChat);
  if (!currentChat) {
    console.error('[ChatStore] generateAIResponse - No active chat found');
    return;
  }

  console.log(`[ChatStore] generateAIResponse - Generating response for chat: ${currentChat.id}${toolResultContext ? ' with tool context' : ''}`);

  // --- Find the user message that triggered this response ---
  let triggeringUserMessage: Message | null = null;
  if (toolResultContext) {
    // If called with tool context, the trigger was likely the user message *before* the assistant message that was approved
    let approvedAssistantMsgIndex = -1;
    for(let i = currentChat.messages.length - 1; i >= 0; i--) {
        if (currentChat.messages[i].pendingMCP?.executionState === 'complete' || currentChat.messages[i].pendingMCP?.executionState === 'error') {
            approvedAssistantMsgIndex = i;
            break;
        }
    }
    if (approvedAssistantMsgIndex > 0) {
        for (let i = approvedAssistantMsgIndex - 1; i >= 0; i--) {
            if (currentChat.messages[i].role === 'user') {
                triggeringUserMessage = currentChat.messages[i];
                break;
            }
        }
    }
  } else {
    // If no tool context, the trigger is likely the last user message
    triggeringUserMessage = currentChat.messages.slice().reverse().find(m => m.role === 'user') || null;
  }
  console.log('[ChatStore] Triggering user message identified:', triggeringUserMessage?.id);
  // ---------------------------------------------------------

  try {
    // Check if AI is initialized
    if (!ai.isInitialized) {
      console.log('[ChatStore] AI not initialized, attempting initialization...');
      try {
        await ai.init(get(selectedModel) || DEFAULT_MODELS.desktop);
      } catch (error) {
        console.error('[ChatStore] Failed to initialize AI:', error);
        await addMessage('Sorry, I encountered an error initializing the AI model. Please try again.', 'assistant');
        return;
      }
    }

    // Prepare messages for the AI from the persistent chat history
    const messagesForAI: AIChatMessage[] = currentChat.messages.map((msg: Message): AIChatMessage => {
      let contentToUse = msg.rawContent || msg.content; // Prefer raw content if available
      contentToUse = contentToUse
        .replace(/\n\n\[Execution Approved & In Progress]/g, '')
        .replace(/\n\[Execution Complete]/g, '')
        .replace(/\n\[Execution Failed]/g, '');

      if (msg.pendingMCP?.status === 'denied') {
        contentToUse += "\n[User denied execution request.]"; 
      } else if (msg.role === 'user' && msg.context) {
        contentToUse = `${contentToUse}\n\nContext from research:\n${msg.context}`;
      }
      return { role: msg.role, content: contentToUse }; 
    }).filter(msg => msg.role !== 'system');
    
    const systemPromptMsg = currentChat.messages.find(m => m.role === 'system');
    if (systemPromptMsg) {
        messagesForAI.unshift({ role: 'system', content: systemPromptMsg.content });
    }

    if (toolResultContext) {
      console.log('[ChatStore] Appending tool result context for AI call.');
      messagesForAI.push({ role: 'user', content: toolResultContext });
    }
    
    if (messagesForAI.length > 1) {
        const lastMsg = messagesForAI[messagesForAI.length - 1];
        if(lastMsg.role === 'assistant') {
            console.warn('[ChatStore] generateAIResponse - Last message before AI call is assistant. This might cause issues.', lastMsg);
            if (!toolResultContext) {
                 throw new Error('Internal Flow Error: Last message is assistant, and no tool context provided.');
            }
        }
    }

    // Call the AI
    const placeholderId = Date.now().toString();
    console.log('[ChatStore] generateAIResponse - Starting AI chat stream with history:', messagesForAI);
    const stream = await ai.chat(messagesForAI); 
    
    let fullResponse = '';
    let parsedContent = '';
    let messageAdded = false; 
    let mcpDetected = false;
    let mcpInfo: any = null; // Holds result from extractMCPInfo

    let responseMessage: Message = {
      id: placeholderId,
      role: 'assistant',
      content: '', // Will hold parsed content
      rawContent: '', // Will hold raw response
      timestamp: new Date()
    };

    // Process the stream chunks
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullResponse += delta;
        responseMessage.rawContent = fullResponse; // Update raw content
        
        // Only check for MCP if NOT in research mode
        const isResearchMode = get(researchMode);
        if (!isResearchMode && !mcpDetected) {
          const extractedInfo = extractMCPInfo(fullResponse);
          if (extractedInfo) {
            mcpDetected = true;
            mcpInfo = extractedInfo; // Store the full result
            console.log('[ChatStore] MCP XML detected in AI response stream, adding pendingMCP:', mcpInfo);
            responseMessage.pendingMCP = {
              serverName: mcpInfo.serverName,
              tool: mcpInfo.tool,
              args: mcpInfo.args,
              status: 'pending'
            };
          }
        }

        // Parse the full raw response for display 
        parsedContent = await Promise.resolve(marked.parse(fullResponse + '▍')); 
        responseMessage.content = parsedContent;

        // Update the active chat with streaming responses
        activeChat.update(chat => {
          if (!chat) return null;
          const existingMsgIndex = chat.messages.findIndex(m => m.id === placeholderId);
          let newMessages = [...chat.messages];
          if (existingMsgIndex !== -1) {
            newMessages[existingMsgIndex] = responseMessage;
          } else {
            newMessages.push(responseMessage);
            messageAdded = true; 
          }
          return { ...chat, messages: newMessages, updatedAt: new Date() };
        });
      }
    }
    
    console.log('[ChatStore] generateAIResponse - AI chat stream finished.');
    
    // --- Append Sources --- 
    let sourcesHtml = '';
    if (triggeringUserMessage?.sources && triggeringUserMessage.sources.length > 0) {
        console.log(`[ChatStore] Appending ${triggeringUserMessage.sources.length} sources to response.`);
        sourcesHtml += '\n\n<hr style="margin: 1rem 0; border-color: var(--color-border, #e5e7eb);">\n'; // Add a themed separator
        sourcesHtml += '<div class="sources-section" style="font-size: 0.8em; margin-top: 1rem;">';
        sourcesHtml += '<strong style="display: block; margin-bottom: 0.5rem; color: var(--color-text-secondary);">Sources:</strong>'; // Use secondary text color
        sourcesHtml += '<ul style="list-style: none; padding-left: 0;">';
        triggeringUserMessage.sources.forEach((source, index) => {
            try {
                const domain = new URL(source.url).hostname;
                // Use inherit color and standard underline for links
                sourcesHtml += 
                   `<li style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem;">
                       <img src="https://www.google.com/s2/favicons?domain=${domain}&sz=16" alt="" style="width: 16px; height: 16px; flex-shrink: 0; border-radius: 2px;" />
                       <a href="${source.url}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">${source.title || source.url}</a>
                   </li>`;
            } catch(e) {
                console.warn(`[ChatStore] Error processing source URL for favicon: ${source.url}`, e);
                // Fallback without favicon, still using inherit color
                 sourcesHtml += 
                   `<li style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem;">
                       <span style="width: 16px; height: 16px; flex-shrink: 0; display: inline-block; background: var(--color-bg-secondary, #eee); border-radius: 2px;"></span>
                       <a href="${source.url}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">${source.title || source.url}</a>
                   </li>`;
            }
        });
        sourcesHtml += '</ul></div>';
    }
    // Append the generated HTML to the raw response *before* final parsing
    fullResponse += sourcesHtml;
    // ---------------------

    // Final parse without cursor, now includes sources HTML
    responseMessage.rawContent = fullResponse; 
    parsedContent = await Promise.resolve(marked.parse(fullResponse)); 
    responseMessage.content = parsedContent;
    
    // Do one final check for MCP XML in case it was split across chunks
    // Only if NOT in research mode
    const isResearchMode = get(researchMode);
    if (!isResearchMode && !mcpDetected) {
      const finalExtractedInfo = extractMCPInfo(fullResponse);
      if (finalExtractedInfo) {
        mcpDetected = true;
        mcpInfo = finalExtractedInfo;
        console.log('[ChatStore] MCP XML detected in final AI response:', mcpInfo);
        responseMessage.pendingMCP = {
          serverName: mcpInfo.serverName,
          tool: mcpInfo.tool,
          args: mcpInfo.args,
          status: 'pending'
        };
      }
    }
    
    // Final update to the message in the store
    activeChat.update(chat => {
      if (!chat) return null;
      const msgIndex = chat.messages.findIndex(m => m.id === placeholderId);
      let newMessages = [...chat.messages];
      if (msgIndex !== -1) {
        newMessages[msgIndex] = responseMessage;
      } else if (!messageAdded) {
        // If message wasn't added during stream (e.g., very short response), add it now
        newMessages.push(responseMessage);
      }
      // Ensure no duplicate placeholder message exists if something went wrong
      newMessages = newMessages.filter((msg, index, self) => 
          index === self.findIndex((t) => (t.id === msg.id)) || msg.id !== placeholderId
      );
      return { ...chat, messages: newMessages, updatedAt: new Date() };
    });
    
    // Save final chat state to database
    const updatedChat = get(activeChat);
    if (updatedChat) {
      chats.update(currentChats => 
        currentChats.map(c => c.id === updatedChat.id ? updatedChat : c)
      );
      try {
        await db.saveChat(updatedChat);
        console.log('[ChatStore] generateAIResponse - Saved final active chat to DB.');
      } catch(dbError) {
        console.error('[ChatStore] generateAIResponse - Error saving final chat:', dbError);
      }
    }

  } catch (error) {
    console.error('[ChatStore] generateAIResponse - Error:', error);
    // Add error message to the persistent chat history
    await addMessage(`Sorry, I encountered an error during generation: ${(error as Error).message}`, 'assistant');
  }
}

// Gather context for research mode - Modified return type
async function gatherResearchContext(query: string): Promise<{ context: string; sources: SearchResult[] } | null> {
  try {
    console.log(`[ChatStore] Gathering research context for: ${query}`);
    
    // First, search in vector store (assuming vectorStore exists and works)
    let vectorContext = '';
    try {
        const vectorResults = await vectorStore.search(query);
        if (vectorResults) {
            console.log(`[Research] Found vector store results for: ${query}`);
            vectorContext = '--- Knowledge Base Results ---\n\n' + vectorResults + '\n\n';
        }
    } catch (vectorError) {
        console.warn('[ChatStore] Vector store search failed:', vectorError);
        // Continue without vector results
    }
    
    let combinedContext = vectorContext; // Start with vector results
    let sourcesUsed: SearchResult[] = []; // Store SearchResult objects
    
    // Get depth and breadth settings from the store
    let depth = get(researchDepth); // Use get() for direct value
    let breadth = get(researchBreadth);
    
    console.log(`[Research] Using depth=${depth}, breadth=${breadth} for query: ${query}`);
    
    // Perform web search
    const webSearchResponse = await searchService.search(query);
    
    // Add web search results if available
    if (webSearchResponse.success && webSearchResponse.results && webSearchResponse.results.length > 0) {
      console.log(`[Research] Found ${webSearchResponse.results.length} web results for: ${query}`);
      
      // Limit results by breadth
      const resultsToProcess = webSearchResponse.results.slice(0, breadth);
      sourcesUsed = resultsToProcess; // Store the results used as sources
      
      // Fetch content from the search results based on depth
      // Assuming fetchContentFromResults is adapted or replaced if needed
      // Let's use a simplified loop here for clarity, assuming fetchContent exists
      let webContentString = '--- Web Search Results ---\n\n';
      let totalContentLength = 0;
      const MAX_CONTENT_LENGTH = 4000; // Limit context size
      
      for (const result of resultsToProcess) {
          if (totalContentLength >= MAX_CONTENT_LENGTH) break;
          try {
              console.log(`[Research] Fetching content for source: ${result.url}`);
              // You might need a dedicated content fetching API endpoint
              const contentResponse = await fetch(`/api/proxy?url=${encodeURIComponent(result.url)}`); 
              let fetchedText = `Error fetching content: ${contentResponse.statusText}`;
              if (contentResponse.ok) {
                 const rawHtml = await contentResponse.text();
                 // Basic HTML stripping (replace with a more robust method if needed)
                 fetchedText = rawHtml
                    .replace(/<style[^>]*>.*?<\/style>/gs, '')
                    .replace(/<script[^>]*>.*?<\/script>/gs, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ').trim();
                 fetchedText = fetchedText.substring(0, MAX_CONTENT_LENGTH - totalContentLength); // Truncate
              }
              
              webContentString += `Source: [${result.title}](${result.url})\nContent:\n${fetchedText}\n\n---\n`;
              totalContentLength += fetchedText.length;
              
          } catch (fetchError) {
              console.error(`[Research] Error fetching content from ${result.url}:`, fetchError);
              webContentString += `Source: [${result.title}](${result.url})\nError fetching content.\n\n---\n`;
          }
      }
      combinedContext += webContentString;
      console.log(`[Research] Web context generation complete, total length: ${totalContentLength}`);
    } else {
      console.log(`[Research] No web results found for: ${query}`);
    }
    
    // Return context string and sources array
    if (combinedContext.trim() === '') {
        return null; // Return null if no context gathered
    }
    
    return { context: combinedContext, sources: sourcesUsed };

  } catch (error) {
    console.error('[ChatStore] Error gathering research context:', error);
    return { context: `Error gathering research context: ${(error as Error).message}`, sources: [] }; // Return error in context
  }
}

// Set selected model
export function setSelectedModel(model: string) {
  selectedModel.set(model);
  
  // Update the active chat model
  activeChat.update((chat) => {
    if (!chat) return null;
    
    const updatedChat = {
      ...chat,
      model
    };
    
    // Update the chat in the chats store
    chats.update((currentChats) => {
      return currentChats.map((c) => (c.id === updatedChat.id ? updatedChat : c));
    });
    
    return updatedChat;
  });
}

// Execute MCP server and add result to chat, preparing for AI analysis
export async function executeMCPAndAddResult(serverName: string, args: string[] = [], messageId: string) {
  console.log(`[ChatStore] executeMCPAndAddResult - Attempting to execute MCP server "${serverName}" with args:`, args, "for messageId:", messageId);
  
  let chat = get(activeChat);
  if (!chat) {
      console.error('[ChatStore] executeMCPAndAddResult - No active chat found');
      return null; 
  }
    
  const originalMessageIndex = chat.messages.findIndex(m => m.id === messageId);
  const originalMessage = originalMessageIndex !== -1 ? chat.messages[originalMessageIndex] : null;
  if (!originalMessage?.pendingMCP) { // Ensure original message has pendingMCP
      console.error('[ChatStore] executeMCPAndAddResult - Original message not found or missing MCP data:', messageId);
      return null;
  }
  const toolName = originalMessage.pendingMCP.tool; // Get tool name from original message

  try {
    // Execute the MCP tool via mcpStore
    const result = await executeMCPServer(serverName, args);
    console.log(`[ChatStore] executeMCPAndAddResult - MCP server "${serverName}" executed successfully. Result:`, result);
    
    // --- Prepare Result Display and Trigger AI Analysis --- 
    
    // 1. Format the result for display in the chat log (optional, can be styled differently or hidden)
    const formattedResultForDisplay = `MCP Server "${serverName}" execution result:\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
    // Add this display message. Important: Use a role that DOESN'T trigger generateAIResponse automatically.
    // We can add a new role like 'tool_result' or just use 'assistant' and ensure addMessage doesn't trigger AI for it.
    // For simplicity, let's modify addMessage slightly later or assume 'assistant' is safe for now.
    const resultDisplayMessage = createMessage(formattedResultForDisplay, 'assistant'); 
    // Add a flag or modify role later if needed to prevent auto-trigger
    // resultDisplayMessage.meta = { skipAITrigger: true }; 
    const chatWithResultDisplay = updateChatWithMessage(get(activeChat)!, resultDisplayMessage, 'assistant', formattedResultForDisplay);
    activeChat.set(chatWithResultDisplay);
    chats.update(list => list.map(c => c.id === chatWithResultDisplay.id ? chatWithResultDisplay : c));
    await db.saveChat(chatWithResultDisplay); // Save intermediate state
    console.log(`[ChatStore] executeMCPAndAddResult - Added raw result display message.`);

    // 2. Format the result as context for the AI
    let resultTextForAI = "Tool execution completed."; // Default text
    if (result && result.output && Array.isArray(result.output) && result.output.length > 0 && result.output[0].text) {
        resultTextForAI = result.output[0].text;
    } else {
        resultTextForAI = JSON.stringify(result); // Fallback to stringified JSON
    }

    // 3. Find the original user message content
    let initiatingUserMessageContent = "your previous request"; 
    for (let i = originalMessageIndex - 1; i >= 0; i--) {
        const loopChat = get(activeChat)!;
        if (loopChat.messages[i]?.role === 'user') {
            initiatingUserMessageContent = loopChat.messages[i].content;
            break; 
        }
    }

    // 4. Create the context string to pass to generateAIResponse
    const contextStringForAI = `Tool Result for ${toolName} (related to user query: "${initiatingUserMessageContent.substring(0, 50)}..."):\n\n\`\`\`\n${resultTextForAI}\n\`\`\`\n\nPlease analyze this result and provide the final response based on the original request and this tool output.`;
    
    // 5. Trigger generateAIResponse with the context string
    // DO NOT add a 'user' message here. Pass the context directly.
    console.log(`[ChatStore] executeMCPAndAddResult - Triggering generateAIResponse with tool context.`);
    setTimeout(() => generateAIResponse(contextStringForAI), 0); // Use setTimeout to ensure state updates settle

    // 6. Update the original assistant message status to complete
    activeChat.update(currentChat => {
      if (!currentChat) return null;
      const msgIndex = currentChat.messages.findIndex(m => m.id === messageId);
      if (msgIndex !== -1 && currentChat.messages[msgIndex].pendingMCP) {
        const updatedMessages = [...currentChat.messages];
        updatedMessages[msgIndex] = {
          ...updatedMessages[msgIndex],
          pendingMCP: { ...updatedMessages[msgIndex].pendingMCP!, executionState: 'complete' },
          content: (updatedMessages[msgIndex].rawContent || updatedMessages[msgIndex].content)
                     .replace('[Execution Approved & In Progress]', '') // Clean tags
                     + '\n[Execution Complete]' // Add final status
        };
         console.log('[ChatStore] executeMCPAndAddResult - Updated original message state to complete.');
         const finalChatState = { ...currentChat, messages: updatedMessages };
         // Save this final state update
         chats.update(list => list.map(c => c.id === finalChatState.id ? finalChatState : c));
         db.saveChat(finalChatState).catch(err => console.error("Error saving final complete state:", err));
         return finalChatState;
      }
      return currentChat;
    });

    return messageId; // Indicate success

  } catch (error) {
    console.error(`[ChatStore] executeMCPAndAddResult - Error executing MCP server "${serverName}":`, error);
    // Add an error message to the chat
    await addMessage(`Error executing MCP server "${serverName}": ${(error as Error).message}`, 'assistant');
    
     // Update the original message to show error state
    activeChat.update(currentChat => {
      if (!currentChat) return null;
      const msgIndex = currentChat.messages.findIndex(m => m.id === messageId);
      if (msgIndex !== -1 && currentChat.messages[msgIndex].pendingMCP) {
        const updatedMessages = [...currentChat.messages];
        updatedMessages[msgIndex] = {
          ...updatedMessages[msgIndex],
          pendingMCP: { ...updatedMessages[msgIndex].pendingMCP!, status: 'approved', executionState: 'error' }, // Keep approved, but mark error
          content: (updatedMessages[msgIndex].rawContent || updatedMessages[msgIndex].content).replace('[Execution Approved & In Progress]', '') + '\n[Execution Failed]'
        };
         console.log('[ChatStore] executeMCPAndAddResult - Updated original message state to error.');
         const finalChatState = { ...currentChat, messages: updatedMessages };
         chats.update(list => list.map(c => c.id === finalChatState.id ? finalChatState : c));
         db.saveChat(finalChatState).catch(err => console.error("Error saving final error state:", err));
         return finalChatState;
      }
      return currentChat;
    });
    
    return null; // Indicate failure
  }
}

// --- Approve MCP Execution Function ---

export async function approveMCPExecution(messageId: string) {
  console.log('[ChatStore] Approving MCP execution for message ID:', messageId);
  
  let chat = get(activeChat);
  if (!chat) return;
  
  const messageIndex = chat.messages.findIndex(m => m.id === messageId);
  if (messageIndex === -1) return;
  
  const message = chat.messages[messageIndex];
  // Ensure message exists and has pending MCP data
  if (!message?.pendingMCP || message.pendingMCP.status !== 'pending') { 
      console.error('[ChatStore] approveMCPExecution - Message not found or not pending approval.', messageId);
      return;
  }
  
  const { serverName, tool, args } = message.pendingMCP; // Get tool name here too
  
  // Update message to show execution in progress
  activeChat.update(currentChat => {
    if (!currentChat) return null;
    const updatedMessages = [...currentChat.messages];
    // Double check index just in case
    const msgIdx = updatedMessages.findIndex(m => m.id === messageId); 
    if (msgIdx !== -1) {
        updatedMessages[msgIdx] = {
          ...updatedMessages[msgIdx],
          pendingMCP: {
            ...updatedMessages[msgIdx].pendingMCP!,
            status: 'approved', // Mark as approved
            executionState: 'executing'
          },
          // Use rawContent if available for modification
          content: (updatedMessages[msgIdx].rawContent || updatedMessages[msgIdx].content) + '\n\n[Execution Approved & In Progress]\n'
        };
    }
    return { ...currentChat, messages: updatedMessages };
  });
  
  // Save chat state immediately after updating status
  const updatedChatState = get(activeChat);
  if (updatedChatState) {
    chats.update(currentChats => 
      currentChats.map(c => c.id === updatedChatState.id ? updatedChatState : c)
    );
    try {
        await db.saveChat(updatedChatState);
        console.log('[ChatStore] Saved chat state after marking MCP as executing.');
    } catch (dbError) {
        console.error('[ChatStore] Error saving chat state after marking executing:', dbError);
    }
  }
  
  // Execute MCP and handle result
  console.log('[ChatStore] Executing MCP for approved message:', messageId, "Server:", serverName, "Tool:", tool, "Args:", args);
  // Pass the tool name along with args
  await executeMCPAndAddResult(serverName, args, messageId); 
  
  // Note: executeMCPAndAddResult now handles the final state update and triggers the next AI response
}

export async function denyMCPExecution(messageId: string) {
    console.log(`[ChatStore] Denying MCP execution for message ID: ${messageId}`);
    let denied = false;
     activeChat.update(chat => {
        if (!chat) return null;
        const messageIndex = chat.messages.findIndex(m => m.id === messageId);
         if (messageIndex !== -1) {
             const message = chat.messages[messageIndex];
             if (message?.pendingMCP?.status === 'pending') {
                 const updatedMessage = {
                     ...message,
                     content: message.content + "\n\n[Execution Denied by User]", 
                     // Explicitly cast status to the specific literal type
                     pendingMCP: { ...message.pendingMCP, status: 'denied' as const }
                 };
                 const newMessages = [...chat.messages];
                 newMessages[messageIndex] = updatedMessage;
                 denied = true;
                 return { ...chat, messages: newMessages, updatedAt: new Date() }; // Return updated chat
             } else {
                 console.warn(`[ChatStore] Message ${messageId} not pending approval for denial.`);
             }
         } else {
             console.warn(`[ChatStore] Message ${messageId} not found for denial.`);
         }
        return chat;
    });

    if (denied) {
        // Save the updated chat state
        const finalChatState = get(activeChat);
        if (finalChatState) {
             chats.update(list => list.map(c => c.id === finalChatState!.id ? finalChatState! : c));
            await db.saveChat(finalChatState);
             console.log(`[ChatStore] Saved chat state after denying MCP for message: ${messageId}`);
        }
        // Trigger AI response again to let the LLM know it was denied and proceed
        console.log(`[ChatStore] Triggering AI response after denial for message: ${messageId}`);
        setTimeout(() => generateAIResponse(), 0); 
    } else {
         console.warn(`[ChatStore] Could not deny MCP for message ${messageId}. Not found or status not pending.`);
    }
}
