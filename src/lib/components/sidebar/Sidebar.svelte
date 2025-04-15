<script lang="ts">
  import { appMode, sidebarVisible, toggleSidebar } from '$lib/stores/appStore';
  import { createNote, notes, activeNote, setActiveNote, deleteNote, toggleKnowledgeBase } from '$lib/stores/notesStore';
  import { createChat, chats, activeChat, setActiveChat, deleteChat } from '$lib/stores/chatStore';
  import Button from '$lib/components/common/Button.svelte';
  import SidebarItem from './SidebarItem.svelte';
  import ModeToggle from './ModeToggle.svelte';
  
  // Import Lucide icons
  import { Plus, User, Settings } from 'lucide-svelte';
  
  // Handle new item creation based on current mode
  function handleNewItem() {
    if ($appMode === 'notes') {
      createNote();
    } else {
      createChat();
    }
  }
</script>

<aside 
  class="flex flex-col h-full border-r border-primary-200 dark:border-primary-800 bg-white dark:bg-primary-900 transition-all duration-300 {$sidebarVisible ? 'w-64' : 'w-0 overflow-hidden'}"
>
  <div class="flex items-center justify-between p-4 border-b border-primary-200 dark:border-primary-800">
    <div class="flex items-center gap-2">
      <ModeToggle />
    </div>
    <Button variant="icon" on:click={handleNewItem} className="text-primary-600 dark:text-primary-400" ariaLabel="Create new item">
      <Plus size={20} />
    </Button>
  </div>
  
  <div class="flex-1 overflow-y-auto py-2">
    {#if $appMode === 'notes'}
      {#each $notes as note (note.id)}
        <SidebarItem 
          title={note.title} 
          id={note.id}
          active={$activeNote?.id === note.id}
          isInKnowledgeBase={note.isInKnowledgeBase}
          showKnowledgeToggle={true}
          on:click={() => setActiveNote(note.id)}
          on:delete={({ detail }) => deleteNote(detail.id)}
          on:toggleKnowledge={({ detail }) => toggleKnowledgeBase(detail.id)}
        />
      {/each}
    {:else}
      {#each $chats as chat (chat.id)}
        <SidebarItem 
          title={chat.title} 
          id={chat.id}
          active={$activeChat?.id === chat.id}
          on:click={() => setActiveChat(chat.id)}
          on:delete={({ detail }) => deleteChat(detail.id)}
        />
      {/each}
    {/if}
  </div>
  
  <div class="flex justify-between p-4 border-t border-primary-200 dark:border-primary-800">
    <Button variant="icon" className="text-primary-600 dark:text-primary-400">
      <User size={20} />
    </Button>
    <Button variant="icon" className="text-primary-600 dark:text-primary-400">
      <Settings size={20} />
    </Button>
  </div>
</aside>
