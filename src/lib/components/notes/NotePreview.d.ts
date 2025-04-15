import { SvelteComponentTyped } from 'svelte';

export interface NotePreviewProps {
  content?: string;
}

export default class NotePreview extends SvelteComponentTyped<
  NotePreviewProps,
  {},
  {}
> {}
