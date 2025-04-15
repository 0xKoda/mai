import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get('q');
  
  if (!query) {
    return json({ error: 'Query parameter is required' }, { status: 400 });
  }

  try {
    const searchUrl = new URL('https://duckduckgo.com/html');
    searchUrl.searchParams.append('q', query);
    searchUrl.searchParams.append('kl', 'wt-wt');

    const response = await fetch(searchUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`DuckDuckGo request failed with status ${response.status}`);
    }

    const html = await response.text();
    
    const results: SearchResult[] = [];
    const resultRegex = /<h2 class="result__title">.*?<a rel="nofollow" class="result__a" href="(.*?)".*?>(.*?)<\/a>.*?<a class="result__snippet".*?>(.*?)<\/a>/gs;
    
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 4) {
      const [_, url, title, snippet] = match;
      if (!url.startsWith('https://duckduckgo.com')) {
        results.push({
          title: decodeHTMLEntities(title.trim()),
          url: url,
          description: decodeHTMLEntities(snippet.trim())
        });
      }
    }

    return json({ results, query });
  } catch (error: unknown) {
    console.error('Search API error:', error);
    return json({ error: 'Failed to perform search' }, { status: 500 });
  }
};

function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' '
  };
  return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, match => entities[match] || match);
}
