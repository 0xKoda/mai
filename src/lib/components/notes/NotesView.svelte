<script lang="ts">
  import { activeNote, editorMode, toggleEditorMode, updateNote } from '$lib/stores/notesStore';
  import NoteEditor from './NoteEditor.svelte';
  import NotePreview from './NotePreview.svelte';
  import Button from '$lib/components/common/Button.svelte';
  import { Edit, Eye, MessageSquare, Sun, Moon } from 'lucide-svelte';
  import { theme, toggleTheme, aiLoading, selectedModel, notesDrawerVisible } from '$lib/stores/appStore';
  import NoteDrawer from './NoteDrawer.svelte';
  import { ai } from '$lib/ai';
  import { get } from 'svelte/store';
  import { marked } from 'marked';
  
  let editorContent = '';
  
  // Initialize drawer as hidden
  notesDrawerVisible.set(false);
  
  // Auto-save timer
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Update editor content when active note changes
  $: if ($activeNote) {
    editorContent = $activeNote.content;
  }
  
  function handleContentChange(event: CustomEvent<string>) {
    if (!$activeNote) return;
    
    editorContent = event.detail;
    
    // Clear previous timeout
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    // Set new timeout for auto-save (2 seconds after typing stops)
    saveTimeout = setTimeout(() => {
      const updatedNote = {
        ...$activeNote,
        content: editorContent
      };
      updateNote(updatedNote);
    }, 2000);
  }
  
  // Handle AI prompt submission
  async function handlePromptSubmit(event: CustomEvent<string>) {
    if (!$activeNote) return;
    
    const promptText = event.detail;
    console.log('AI Prompt received in NotesView:', promptText);
    
    if (!promptText) {
      console.error('Empty prompt text received');
      return;
    }
    
    // Show a temporary indicator that AI is processing
    const processingIndicator = '⏳ AI is processing your request...';
    
    // Get cursor position or use the end of content
    const textArea = document.querySelector('.note-editor textarea') as HTMLTextAreaElement | null;
    const cursorPosition = textArea?.selectionStart !== undefined ? 
        textArea.selectionStart : 
        editorContent.length;
    
    console.log('Cursor position for AI response:', cursorPosition);
    
    // Store content parts as variables that can be modified
    let insertPosition = cursorPosition;
    let textBefore = editorContent.substring(0, insertPosition);
    let textAfter = editorContent.substring(insertPosition);
    
    try {
      aiLoading.set(true);
      
      // Initialize AI if not already initialized
      if (!ai.isInitialized) {
        console.log('AI not initialized, attempting to initialize...');
        try {
          const model = $selectedModel || 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
          await ai.init(model);
        } catch (initError: any) {
          console.error('Failed to initialize AI:', initError);
          alert('Failed to initialize AI: ' + (initError.message || 'Unknown error'));
          aiLoading.set(false);
          return;
        }
      }
      
      console.log('Sending prompt to AI:', promptText);
      
      // Add a temporary processing indicator
      if (insertPosition > 0 && !textBefore.endsWith('\n\n')) {
        textBefore += '\n\n';
      }
      editorContent = textBefore + processingIndicator + textAfter;
      
      // Extract sources if this is a research prompt
      let sources: string[] = [];
      if (promptText.includes('Context from research:')) {
        // Extract sources section from the prompt
        const sourcesMatch = promptText.match(/--- Sources ---\s*([\s\S]*?)(?:$|\n\n)/i);
        if (sourcesMatch && sourcesMatch[1]) {
          sources = sourcesMatch[1].trim().split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => line.trim());
          console.log('Extracted sources:', sources);
        }
      }
      
      // Get AI response
      const response = await ai.chat([
        { role: 'system', content: 'You are a helpful assistant for note-taking.' },
        { role: 'user', content: promptText }
      ]);
      
      console.log('Got AI response stream');
      
      // Initialize response text
      let responseText = '';
      
      // Remove the processing indicator
      if (editorContent.includes(processingIndicator)) {
        const parts = editorContent.split(processingIndicator);
        textBefore = parts[0];
        textAfter = parts.length > 1 ? parts[1] : '';
      }
      
      // Process the streaming response
      for await (const chunk of response) {
        const content = chunk.choices[0]?.delta?.content || '';
        responseText += content;
        
        // Insert the response directly at cursor position
        editorContent = textBefore + responseText + textAfter;
      }
      
      console.log('Completed AI response, length:', responseText.length);
      
      // Add sources to the response if they exist
      if (sources.length > 0) {
        // Process sources to create formatted links with favicons
        const formattedSources = sources.map((source, index) => {
          try {
            // Extract URL and title from the source string
            const sourceRegex = /\[(\d+)\]\s*\[(.*?)\]\((.*?)\)/;
            const match = source.match(sourceRegex);
            
            let title, url;
            if (match) {
              title = match[2];
              url = match[3];
            } else {
              const simpleLinkRegex = /\[(.*?)\]\((.*?)\)/;
              const simpleMatch = source.match(simpleLinkRegex);
              if (simpleMatch) {
                title = simpleMatch[1];
                url = simpleMatch[2];
              } else {
                title = source.replace(/^\[\d+\]\s*/, '');
                url = source;
              }
            }
            
            // Clean up the URL if it's still wrapped in brackets
            url = url.replace(/^\[|\]$/g, '');
            
            // Return markdown formatted link
            return `[${title}](${url})`;
          } catch (error) {
            console.error(`Error formatting source: ${source}`, error);
            const cleanSource = source.replace(/^\[\d+\]\s*/, '').replace(/^\[|\]$/g, '');
            return cleanSource;
          }
        }).join('\n');
        
        // Add sources section with markdown formatting
        responseText += '\n\n## Sources\n\n' + formattedSources;
      }
      
      // Update the note content
      if (!textBefore.endsWith('\n\n') && !responseText.startsWith('\n')) {
        editorContent = textBefore + '\n\n' + responseText + textAfter;
      } else {
        editorContent = textBefore + responseText + textAfter;
      }
      
      // Save the updated note
      const updatedNote = {
        ...$activeNote,
        content: editorContent,
        updatedAt: new Date()
      };
      updateNote(updatedNote);
      
      // Force update the editor content to ensure it's displayed correctly
      editorContent = updatedNote.content;
      
      aiLoading.set(false);
    } catch (error: any) {
      console.error('Error processing AI prompt:', error);
      alert(`Error: Failed to get AI response. ${error.message || 'Please try again.'}`);
      aiLoading.set(false);
    }
  }
</script>

<div class="flex flex-col h-full">
  <!-- Notes toolbar -->
  <div class="flex items-center justify-between p-4 pl-16 border-b border-primary-200 dark:border-primary-800">
    <div class="flex items-center gap-2">
      <Button 
        variant="outline" 
        className="text-sm"
        on:click={toggleEditorMode}
      >
        {#if $editorMode === 'edit'}
          <Eye size={16} class="mr-2" />
          <span>Preview</span>
        {:else}
          <Edit size={16} class="mr-2" />
          <span>Edit</span>
        {/if}
      </Button>
    </div>
    
    <div class="flex items-center gap-2">
      <Button 
        variant="icon" 
        className="text-primary-600 dark:text-primary-400 {$notesDrawerVisible ? 'bg-primary-100 dark:bg-primary-800' : ''}" 
        on:click={() => notesDrawerVisible.update(v => !v)}
      >
        <MessageSquare size={20} />
      </Button>
      
      <Button variant="icon" className="text-primary-600 dark:text-primary-400" on:click={toggleTheme}>
        {#if $theme === 'dark'}
          <Sun size={20} />
        {:else}
          <Moon size={20} />
        {/if}
      </Button>
    </div>
  </div>
  
  <!-- Notes content area with constrained width -->
  <div class="flex-1 overflow-y-auto flex justify-center">
    <div class="w-full max-w-3xl px-4">
      {#if $activeNote}
        {#if $editorMode === 'edit'}
          <NoteEditor 
            content={editorContent} 
            on:change={handleContentChange}
          />
        {:else}
          <NotePreview content={editorContent} />
        {/if}
    {:else}
      <div class="flex items-center justify-center h-full">
        <p class="text-primary-500 dark:text-primary-400">Select a note or create a new one</p>
      </div>
    {/if}
    </div>
  </div>
  
  <!-- Notes drawer (for AI) -->
  <NoteDrawer on:promptSubmit={handlePromptSubmit} />
</div>
