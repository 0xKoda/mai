import { SvelteComponentTyped } from 'svelte';

export interface ChatDrawerProps {
  onClose?: () => void;
}

export default class ChatDrawer extends SvelteComponentTyped<
  ChatDrawerProps,
  {},
  {}
> {}
