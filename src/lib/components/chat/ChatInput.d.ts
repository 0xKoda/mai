import { SvelteComponentTyped } from 'svelte';

export interface ChatInputProps {
  placeholder?: string;
  disabled?: boolean;
}

export interface ChatInputEvents {
  submit: CustomEvent<string>;
}

export default class ChatInput extends SvelteComponentTyped<
  ChatInputProps,
  ChatInputEvents,
  {}
> {}
