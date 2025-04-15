import { writable, get } from 'svelte/store';
import { vectorStore } from '$lib/vectorStore';
import { db } from '$lib/db';

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  isInKnowledgeBase: boolean;
}

// Default notes to use if no notes are found in the database
const defaultNotes: Note[] = [
  {
    id: '1',
    title: 'Welcome to viritai',
    content: '# Welcome to viritai\n\nThis is your first note. You can edit it or create a new one.',
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: ['welcome'],
    isInKnowledgeBase: false
  },
  {
    id: '2',
    title: 'How to use markdown',
    content: '# Markdown Guide\n\n## Headers\n\n# H1\n## H2\n### H3\n\n## Emphasis\n\n*italic* or _italic_\n**bold** or __bold__\n\n## Lists\n\n- Item 1\n- Item 2\n  - Subitem\n\n1. First\n2. Second\n\n## Links\n\n[Link text](https://example.com)\n\n## Images\n\n![Alt text](image-url)\n\n## Code\n\n`inline code`\n\n```javascript\n// code block\nfunction example() {\n  return "hello world";\n}\n```\n\n## Blockquotes\n\n> This is a blockquote\n\n## Horizontal Rule\n\n---\n\n## Tables\n\n| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |\n\n## Note Links\n\nYou can link to other notes using [[Note Title]] syntax.',
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: ['markdown', 'guide'],
    isInKnowledgeBase: true
  }
];

// Create the notes store with empty initial state
export const notes = writable<Note[]>([]);

// Currently active note
export const activeNote = writable<Note | null>(null);

// Load notes from database
export async function loadNotes() {
  try {
    const storedNotes = await db.getAllNotes();
    
    // If no notes found in database, use default notes
    if (storedNotes.length === 0) {
      notes.set(defaultNotes);
      // Save default notes to database
      for (const note of defaultNotes) {
        await db.saveNote(note);
      }
    } else {
      notes.set(storedNotes);
    }
    
    // Set the first note as active if none is active
    const currentNotes = get(notes);
    if (currentNotes.length > 0 && !get(activeNote)) {
      activeNote.set(currentNotes[0]);
    }
  } catch (error) {
    console.error('Error loading notes from database:', error);
    notes.set(defaultNotes);
  }
}

// Editor mode: 'edit' or 'preview'
export const editorMode = writable<'edit' | 'preview'>('edit');

// Create a new note
export function createNote() {
  const newNote: Note = {
    id: Date.now().toString(),
    title: 'Untitled Note',
    content: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    isInKnowledgeBase: false
  };

  notes.update((currentNotes) => {
    return [newNote, ...currentNotes];
  });

  activeNote.set(newNote);
  
  // Save to database
  db.saveNote(newNote).catch(error => {
    console.error('Error saving new note to database:', error);
  });
  
  return newNote;
}

// Update a note
export function updateNote(updatedNote: Note) {
  updatedNote.updatedAt = new Date();
  
  // Extract title from content if first line is a heading
  const firstLine = updatedNote.content.split('\n')[0];
  if (firstLine.startsWith('# ')) {
    updatedNote.title = firstLine.substring(2).trim();
  }

  notes.update((currentNotes) => {
    return currentNotes.map((note) => (note.id === updatedNote.id ? updatedNote : note));
  });

  activeNote.set(updatedNote);
  
  // If note is in knowledge base, update it in the vector store
  if (updatedNote.isInKnowledgeBase) {
    // Use setTimeout to avoid blocking the UI
    setTimeout(() => {
      vectorStore.addNote(updatedNote).catch(error => {
        console.error('Failed to update note in vector store:', error);
      });
    }, 0);
  }
  
  // Save to database
  db.saveNote(updatedNote).catch(error => {
    console.error('Error updating note in database:', error);
  });
}

// Delete a note
export function deleteNote(id: string) {
  notes.update((currentNotes) => {
    return currentNotes.filter((note: Note) => note.id !== id);
  });

  // If the active note was deleted, set the first note as active
  activeNote.update((current) => {
    if (current && current.id === id) {
      return null;
    }
    return current;
  });
  
  // Delete from database
  db.deleteNote(id).catch(error => {
    console.error('Error deleting note from database:', error);
  });
}

// Toggle knowledge base status
export function toggleKnowledgeBase(id: string) {
  let updatedNote: Note | null = null;
  
  notes.update((currentNotes) => {
    return currentNotes.map((note: Note) => {
      if (note.id === id) {
        updatedNote = { ...note, isInKnowledgeBase: !note.isInKnowledgeBase };
        return updatedNote;
      }
      return note;
    });
  });
  
  if (updatedNote) {
    // Use setTimeout to avoid blocking the UI
    setTimeout(async () => {
      try {
        if (updatedNote!.isInKnowledgeBase) {
          // Add to vector store if added to knowledge base
          await vectorStore.addNote(updatedNote!);
          console.log('Added note to vector store:', updatedNote!.title);
        } else {
          // Remove from vector store if removed from knowledge base
          await vectorStore.removeNote(updatedNote!.id);
          console.log('Removed note from vector store:', updatedNote!.title);
        }
      } catch (error) {
        console.error('Failed to update vector store:', error);
      }
    }, 0);
    
    // Save to database
    db.saveNote(updatedNote).catch(error => {
      console.error('Error updating note in database:', error);
    });
  }
}

// Set active note
export function setActiveNote(id: string) {
  notes.subscribe((currentNotes) => {
    const note = currentNotes.find((note) => note.id === id);
    if (note) {
      activeNote.set(note);
    }
  })();
}

// Toggle editor mode
export function toggleEditorMode() {
  editorMode.update((mode) => (mode === 'edit' ? 'preview' : 'edit'));
}
