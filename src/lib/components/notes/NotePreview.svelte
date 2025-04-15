<script lang="ts">
  import { onMount } from 'svelte';
  import { marked } from 'marked';
  export let content = '';
  
  let renderedContent = '';
  
  // Configure marked to preserve HTML
  marked.setOptions({
    gfm: true,
    breaks: true,
    xhtml: true,  // Add this to ensure proper HTML rendering
    headerIds: true
  });
  
  // Use marked to render markdown while preserving HTML
  function renderMarkdown(text: string): string {
    if (!text) return '';
    // First pass to handle markdown
    let parsed = marked.parse(text).toString();
    
    // Process any source sections with favicons
    const sourcesRegex = /<h2>Sources<\/h2>([\s\S]*?)(?:<h2>|$)/i;
    const sourcesMatch = parsed.match(sourcesRegex);
    
    if (sourcesMatch) {
      const sourceSection = sourcesMatch[1];
      // Extract URLs and titles from the source section
      const sourceLines = sourceSection.split('\n').filter(line => line.trim());
      
      const formattedSources = sourceLines.map((source, index) => {
        try {
          // Extract URL and title from markdown link
          const linkMatch = source.match(/\[(.*?)\]\((.*?)\)/);
          if (linkMatch) {
            const [_, title, url] = linkMatch;
            const domain = new URL(url).hostname;
            return `<div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
              <img src="https://www.google.com/s2/favicons?domain=${domain}" alt="" style="width: 16px; height: 16px;" />
              <a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">${index + 1}. ${title}</a>
            </div>`;
          }
          return source; // Keep original if not a link
        } catch (error) {
          console.error('Error formatting source:', error);
          return source; // Keep original on error
        }
      }).join('\n');
      
      // Replace the original sources section with the formatted one
      parsed = parsed.replace(sourcesMatch[0], `<h2>Sources</h2>\n${formattedSources}`);
    }
    
    return parsed;
  }
  
  $: {
    renderedContent = renderMarkdown(content);
  }
</script>

<div class="p-4">
  <div class="prose dark:prose-invert prose-lg prose-headings:font-semibold prose-p:text-lg prose-p:leading-relaxed prose-p:font-serif prose-li:text-lg prose-li:leading-relaxed">
    {@html renderedContent}
  </div>
</div>

<style>
  /* Add custom styling for markdown preview */
  :global(.prose) {
    font-family: inherit;
  }
  
  :global(.prose h1) {
    font-size: 2rem;
    font-weight: 600;
    margin-top: 1.5rem;
    margin-bottom: 1rem;
  }
  
  :global(.prose h2) {
    font-size: 1.5rem;
    font-weight: 600;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
  }
  
  :global(.prose h3) {
    font-size: 1.25rem;
    font-weight: 600;
    margin-top: 1.25rem;
    margin-bottom: 0.5rem;
  }
  
  :global(.prose p) {
    margin-bottom: 1rem;
  }
  
  :global(.prose ul) {
    list-style-type: disc;
    margin-left: 1.5rem;
    margin-bottom: 1rem;
  }
  
  :global(.prose li) {
    margin-bottom: 0.5rem;
  }
  
  :global(.prose code) {
    background-color: rgba(0, 0, 0, 0.1);
    padding: 0.2rem 0.4rem;
    border-radius: 0.25rem;
    font-family: 'JetBrains Mono', monospace;
  }
  
  :global(.prose pre) {
    background-color: rgba(0, 0, 0, 0.1);
    padding: 1rem;
    border-radius: 0.5rem;
    overflow-x: auto;
    margin-bottom: 1rem;
  }
  
  :global(.prose pre code) {
    background-color: transparent;
    padding: 0;
    border-radius: 0;
    font-family: 'JetBrains Mono', monospace;
  }
  
  /* Add styles for source links */
  :global(.prose a) {
    text-decoration: none;
    color: #2563eb;
  }
  
  :global(.prose a:hover) {
    text-decoration: underline;
  }
  
  :global(.source-link) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  
  :global(.source-favicon) {
    width: 16px;
    height: 16px;
  }
</style>
