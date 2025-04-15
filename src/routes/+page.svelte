<script lang="ts">
	import { onMount } from 'svelte';
	import { initApp } from '$lib/app';
	import { appMode } from '$lib/stores/appStore';
	import NotesView from '$lib/components/notes/NotesView.svelte';
	import ChatView from '$lib/components/chat/ChatView.svelte';

	onMount(async () => {
		try {
			await initApp();
		} catch (error) {
			console.error('Error initializing app:', error);
		}
	});
</script>

<div class="h-screen flex flex-col">
	{#if $appMode === 'notes'}
		<NotesView />
	{:else}
		<ChatView />
	{/if}
</div>
