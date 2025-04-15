import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Let Vite use default root-relative paths
	// base: '/', // Default is usually fine
	// Ensure proper handling of __dirname in ESM
	build: {
		rollupOptions: {
			output: {
				format: 'es'
			}
		}
	}
});