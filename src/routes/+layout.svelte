<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { appMode, sidebarVisible, aiLoading, aiLoadingProgress, selectedModel } from '$lib/stores/appStore';
	import { aiState, ai, DEFAULT_MODELS } from '$lib/ai';
	import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
	import ChatView from '$lib/components/chat/ChatView.svelte';
	import NotesView from '$lib/components/notes/NotesView.svelte';
	import { loadNotes } from '$lib/stores/notesStore';
	import { loadChats } from '$lib/stores/chatStore';
	import { db } from '$lib/db';
	import { initializeWebLLM } from '$lib/webllm-loader';

	let { children } = $props();

	// Initialize theme, database, WebLLM and AI model on mount
	onMount(async () => {
		// Set theme
		const theme = localStorage.getItem('theme') || 'dark';
		if (theme === 'dark') {
			document.documentElement.classList.add('dark');
		} else {
			document.documentElement.classList.remove('dark');
		}
		
		// Initialize database and load data
		try {
			console.log('Initializing database...');
			await db.init();
			console.log('Database initialized successfully');
			
			// Load notes and chats from database
			await Promise.all([
				loadNotes(),
				loadChats()
			]);
			console.log('Notes and chats loaded from database');
		} catch (error) {
			console.error('Error initializing database:', error);
		}

		// Initialize WebLLM and AI
		console.log('Initializing WebLLM...');
		if (initializeWebLLM()) {
			console.log('WebLLM loaded successfully');
			
			// Initialize AI with default model
			try {
				const model = get(selectedModel) || DEFAULT_MODELS.desktop;
				console.log('Initializing AI with model:', model);
				await ai.init(model);
				console.log('AI initialized successfully');
			} catch (error) {
				console.error('Error initializing AI:', error);
			}
		} else {
			console.error('Failed to load WebLLM');
		}
		
		aiLoading.set(false);
	});
</script>

<div class="flex h-screen overflow-hidden bg-white dark:bg-primary-950 text-primary-900 dark:text-primary-100 relative">
	<!-- Sidebar toggle button positioned absolutely so it's always visible -->
	<button 
		class="fixed top-4 {$sidebarVisible ? 'left-[260px]' : 'left-4'} z-50 p-2 rounded-md bg-white dark:bg-primary-800 shadow-md hover:bg-primary-100 dark:hover:bg-primary-700 transition-all duration-300"
		onclick={() => sidebarVisible.update(v => !v)}
		aria-label="{$sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}"
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{$sidebarVisible ? 'rotate-180' : 'rotate-0'} transition-transform duration-300">
			<path d="M19 12H5"/>
			<path d="M12 19l-7-7 7-7"/>
		</svg>
	</button>

	<Sidebar />
	
	<main class="flex-1 overflow-hidden transition-all duration-300 {$sidebarVisible ? 'ml-64' : 'ml-0'}">
		{#if $appMode === 'notes'}
			<NotesView />
		{:else}
			<ChatView />
		{/if}
	</main>
</div>
