import { SvelteComponentTyped } from 'svelte';

export interface NoteEditorProps {
  content?: string;
}

export interface NoteEditorEvents {
  change: CustomEvent<string>;
}

export default class NoteEditor extends SvelteComponentTyped<
  NoteEditorProps,
  NoteEditorEvents,
  {}
> {}
