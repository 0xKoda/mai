export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export class SearchService {
  private readonly API_URL = '/api/search'; // Use the SvelteKit API endpoint

  async search(query: string) {
    try {
      console.log(`[SearchService] Searching for: ${query}`);
      
      const response = await fetch(`${this.API_URL}?q=${encodeURIComponent(query)}`);
      
      if (!response.ok) {
        throw new Error(`Search failed with status: ${response.status}`);
      }

      const data = await response.json() as { results?: SearchResult[], error?: string };
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Extract results from the API response
      const results: SearchResult[] = data.results || [];
      console.log(`[SearchService] Found ${results.length} results for query: ${query}`);
      
      if (results.length > 0) {
        console.log(`[SearchService] Top result: ${results[0].title} - ${results[0].url}`);
      } else {
        console.log(`[SearchService] No results found for query: ${query}`);
      }

      return {
        success: true,
        results: results.length > 0 ? results : this.getFallbackResults(query),
        noResults: results.length === 0
      };
    } catch (error) {
      console.error('[SearchService] Search failed:', error);
      return {
        success: false,
        results: this.getFallbackResults(query),
        error: (error as Error).message
      };
    }
  }
  
  // Fetch and process content from search results
  async fetchContentFromResults(results: SearchResult[], depth: number = 1): Promise<{content: string, sources: string[]}> {
    const sources: string[] = [];
    let combinedContent = '';
    let totalContentLength = 0;
    const MAX_CONTENT_LENGTH = 4000; // Maximum content length to stay within context window limits
    
    // Limit the number of results to process based on depth
    const resultsToProcess = results.slice(0, depth);
    console.log(`[SearchService] Processing ${resultsToProcess.length} results for content fetching`);
    
    for (const result of resultsToProcess) {
      try {
        console.log(`[SearchService] Fetching content from: ${result.url}`);
        sources.push(`[${result.title}](${result.url})`);
        
        // Fetch the content
        const content = await this.fetchContent(result.url);
        
        // Truncate content if needed to stay within context window limits
        let processedContent = content;
        if (totalContentLength + content.length > MAX_CONTENT_LENGTH) {
          const remainingSpace = Math.max(0, MAX_CONTENT_LENGTH - totalContentLength);
          processedContent = content.substring(0, remainingSpace) + '... [Content truncated due to length]';
          console.log(`[SearchService] Content truncated to ${remainingSpace} chars to fit context window`);
        }
        
        totalContentLength += processedContent.length;
        
        // Log a preview of the content
        const contentPreview = processedContent.length > 200 ? processedContent.substring(0, 200) + '...' : processedContent;
        console.log(`[SearchService] Content fetched (${processedContent.length}/${content.length} chars): ${contentPreview}`);
        
        // Add the content to the combined result
        combinedContent += `### Source: [${result.title}](${result.url})\n\n${processedContent}\n\n---\n\n`;
        
        // Stop processing if we've reached the maximum content length
        if (totalContentLength >= MAX_CONTENT_LENGTH) {
          console.log(`[SearchService] Reached maximum content length (${MAX_CONTENT_LENGTH}), stopping further processing`);
          break;
        }
      } catch (error) {
        console.error(`[SearchService] Error fetching content from ${result.url}:`, error);
        combinedContent += `### Source: [${result.title}](${result.url})\n\nError fetching content: ${(error as Error).message}\n\n---\n\n`;
      }
    }
    
    console.log(`[SearchService] Total content length: ${totalContentLength} chars`);
    return { content: combinedContent, sources };
  }
  
  private getFallbackResults(query: string): SearchResult[] {
    console.log('[SearchService] Using fallback results');
    return [
      {
        title: `Result for "${query}" - Example 1`,
        url: 'https://example.com/result1',
        description: `This is a sample search result about ${query}. It contains information that might be relevant to your query.`
      },
      {
        title: `${query} - Comprehensive Guide`,
        url: 'https://example.com/guide',
        description: `Learn everything about ${query} in this comprehensive guide. Includes examples, tutorials, and best practices.`
      },
      {
        title: `Understanding ${query} - Deep Dive`,
        url: 'https://example.com/deep-dive',
        description: `A detailed analysis of ${query} with expert insights and practical applications.`
      }
    ];
  }

  // Fetch the content of a URL and convert it to plain text
  async fetchContent(url: string): Promise<string> {
    try {
      // Use a proxy endpoint to fetch the content for security reasons
      // This would be a real implementation in production
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      
      if (!response.ok) {
        // Fallback to direct fetch if proxy fails (for development only)
        const directResponse = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        
        if (!directResponse.ok) {
          throw new Error(`Failed to fetch content: ${directResponse.status}`);
        }
        
        const html = await directResponse.text();
        return this.htmlToText(html);
      }
      
      const html = await response.text();
      return this.htmlToText(html);
    } catch (error) {
      console.error('Failed to fetch content:', error);
      return `Error fetching content: ${(error as Error).message}`;
    }
  }
  
  private htmlToText(html: string): string {
    // Simple HTML to text conversion
    return html
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  
  // Deep research functionality
  async performDeepResearch(query: string, depth: number = 2, breadth: number = 3): Promise<string> {
    try {
      console.log(`[SearchService] Performing deep research on: "${query}" with depth=${depth}, breadth=${breadth}`);
      
      // First, perform a search to get relevant results
      const searchResults = await this.search(query);
      
      if (!searchResults.success || searchResults.results.length === 0) {
        console.log(`[SearchService] No search results found for deep research query: ${query}`);
        return `No search results found for: ${query}`;
      }
      
      // Limit the number of results based on breadth parameter
      const limitedResults = searchResults.results.slice(0, breadth);
      console.log(`[SearchService] Processing ${limitedResults.length} results for deep research`);
      
      // Create a context string with information from search results
      let researchContext = `Deep research on: ${query}\n\n`;
      
      // For each result, try to get content
      for (const [index, result] of limitedResults.entries()) {
        try {
          console.log(`[SearchService] Processing result ${index + 1}/${limitedResults.length}: ${result.title}`);
          // Add basic info about the result
          researchContext += `Source: ${result.title}\nURL: ${result.url}\n\n`;
          
          // Try to fetch content from the URL
          console.log(`[SearchService] Fetching content from: ${result.url}`);
          const contentResponse = await fetch(`/api/content?url=${encodeURIComponent(result.url)}`);
          
          if (contentResponse.ok) {
            const contentData = await contentResponse.json() as { content?: string, error?: string, fallback?: boolean };
            const content = contentData.content || '';
            
            console.log(`[SearchService] Content fetched successfully from ${result.url}, length: ${content.length} chars`);
            
            // Add a preview of the content to logs
            const contentPreview = content.length > 200 
              ? content.substring(0, 200) + '...' 
              : content;
            console.log(`[SearchService] Content preview: ${contentPreview}`);
            
            // Add a portion of the content based on depth parameter
            // Higher depth means more content from each source
            const contentChars = depth * 2000; // 2000 chars per depth level
            const truncatedContent = content.slice(0, contentChars);
            
            researchContext += `Content:\n${truncatedContent}\n\n---\n\n`;
          } else {
            const errorData = await contentResponse.json();
            console.error(`[SearchService] Content fetch failed for ${result.url}:`, errorData);
            researchContext += `Could not fetch content from this source.\n\n---\n\n`;
          }
        } catch (error) {
          console.error(`[SearchService] Error processing result ${result.url}:`, error);
          researchContext += `Error extracting content: ${(error as Error).message}\n\n---\n\n`;
        }
      }
      
      console.log(`[SearchService] Deep research complete, context length: ${researchContext.length} chars`);
      return researchContext;
    } catch (error) {
      console.error('[SearchService] Deep research failed:', error);
      return `Deep research failed: ${(error as Error).message}`;
    }
  }
}

export const searchService = new SearchService();
