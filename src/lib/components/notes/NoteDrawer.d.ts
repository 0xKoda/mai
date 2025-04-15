import { SvelteComponentTyped } from 'svelte';

export interface NoteDrawerProps {}

export interface NoteDrawerEvents {
  close: CustomEvent<void>;
}

export default class NoteDrawer extends SvelteComponentTyped<
  NoteDrawerProps,
  NoteDrawerEvents,
  {}
> {}
