import { writable } from 'svelte/store';

// App mode: 'notes' or 'chat'
export const appMode = writable<'notes' | 'chat'>('chat');

// Theme: 'light' or 'dark'
export const theme = writable<'light' | 'dark'>('dark');

// Sidebar visibility
export const sidebarVisible = writable<boolean>(true);

// AI loading state
export const aiLoading = writable<boolean>(false);

// AI loading progress
export const aiLoadingProgress = writable<{progress: number; text: string}>({progress: 0, text: ''});

// Research mode
export const researchMode = writable<boolean>(false);

// Research depth - how many sources to visit
export const researchDepth = writable<number>(2);

// Research breadth - how many search results to process
export const researchBreadth = writable<number>(3);

// Notes drawer visibility
export const notesDrawerVisible = writable<boolean>(false);

// Selected model
export const selectedModel = writable<string>('Qwen2.5-1.5B-Instruct-q4f16_1-MLC');

// RAG mode
export const ragMode = writable<boolean>(false);

// Initialize theme based on user preference
if (typeof window !== 'undefined') {
  // Check if user has a saved preference
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    theme.set(savedTheme as 'light' | 'dark');
  } else {
    // Check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme.set(prefersDark ? 'dark' : 'light');
  }

  // Apply theme to document
  theme.subscribe((value) => {
    if (value === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', value);
  });
}

// Toggle theme function
export function toggleTheme() {
  theme.update((current) => (current === 'light' ? 'dark' : 'light'));
}

// Toggle sidebar function
export function toggleSidebar() {
  sidebarVisible.update((visible) => !visible);
}

// Set app mode function
export function setAppMode(mode: 'notes' | 'chat') {
  appMode.set(mode);
}
