import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// List of CORS proxies to try in order
const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://cors-anywhere.herokuapp.com/${url}`,
  (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`
];

export const GET: RequestHandler = async ({ url, fetch }) => {
  const targetUrl = url.searchParams.get('url');
  
  if (!targetUrl) {
    return json({ error: 'URL parameter is required' }, { status: 400 });
  }

  console.log(`Content extraction request for: ${targetUrl}`);
  
  // Try each proxy in sequence until one works
  let html = '';
  let lastError = null;
  let proxyUsed = '';

  for (const proxyGenerator of CORS_PROXIES) {
    try {
      const proxyUrl = proxyGenerator(targetUrl);
      proxyUsed = proxyUrl.split('?')[0]; // Just log the base proxy URL
      
      console.log(`Trying proxy: ${proxyUsed}`);
      
      const response = await fetch(proxyUrl, {
        headers: {
          // Request mobile version for simpler content
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch content with status ${response.status}`);
      }

      html = await response.text();
      console.log(`Successfully fetched content using ${proxyUsed}, content length: ${html.length} chars`);
      break; // Exit the loop if successful
    } catch (error) {
      lastError = error;
      console.error(`Proxy ${proxyUsed} failed:`, error);
      // Continue to the next proxy
    }
  }

  // If all proxies failed, try a direct fetch as a last resort
  if (!html) {
    try {
      console.log('All proxies failed, attempting direct fetch (may fail due to CORS)');
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
        }
      });
      
      if (response.ok) {
        html = await response.text();
        console.log(`Direct fetch succeeded, content length: ${html.length} chars`);
      }
    } catch (directError) {
      console.error('Direct fetch failed:', directError);
    }
  }

  // If we still don't have content, try to extract from search result metadata
  if (!html) {
    console.log('All content fetch methods failed, returning fallback content');
    
    // Return a minimal response with just the URL and a fallback message
    return json({ 
      url: targetUrl,
      content: `Unable to extract content from ${targetUrl}. This may be due to website restrictions or CORS policies.`,
      fallback: true
    });
  }

  try {
    // Extract the main content from the HTML
    const extractedText = extractMainContent(html);
    console.log(`Content extracted successfully, length: ${extractedText.length} chars`);
    
    // Log a preview of the extracted content
    const contentPreview = extractedText.length > 200 
      ? extractedText.substring(0, 200) + '...' 
      : extractedText;
    console.log(`Content preview: ${contentPreview}`);
    
    return json({ 
      url: targetUrl,
      content: extractedText
    });
  } catch (error: unknown) {
    console.error('Content extraction error:', error);
    return json({ 
      error: 'Failed to extract content',
      message: (error as Error).message 
    }, { status: 500 });
  }
};

/**
 * Extracts the main content from an HTML page
 * Inspired by the defuddle approach
 */
function extractMainContent(html: string): string {
  // First, clean up the HTML
  let cleanHtml = html
    // Remove scripts
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove styles
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Remove comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove head
    .replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, '')
    // Remove navigation
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    // Remove footers
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    // Remove headers (often navigation/menus)
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '');

  // Try to find the main content area
  const mainContentRegexes = [
    /<main\b[^<]*(?:(?!<\/main>)<[^<]*)*<\/main>/i,
    /<article\b[^<]*(?:(?!<\/article>)<[^<]*)*<\/article>/i,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>[\s\S]*?<\/div>/i,
    /<div[^>]*class="[^"]*main[^"]*"[^>]*>[\s\S]*?<\/div>/i,
    /<div[^>]*id="[^"]*content[^"]*"[^>]*>[\s\S]*?<\/div>/i,
    /<div[^>]*id="[^"]*main[^"]*"[^>]*>[\s\S]*?<\/div>/i
  ];

  let mainContent = '';
  for (const regex of mainContentRegexes) {
    const match = cleanHtml.match(regex);
    if (match && match[0]) {
      mainContent = match[0];
      console.log(`Found main content using regex: ${regex}`);
      break;
    }
  }

  // If we couldn't find a main content area, use the whole body
  if (!mainContent) {
    const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      mainContent = bodyMatch[1];
      console.log('Using body content as fallback');
    } else {
      mainContent = cleanHtml;
      console.log('Using entire HTML as fallback');
    }
  }

  // Extract text from the HTML using the same approach as decodeHTMLEntities
  let text = mainContent
    // Replace breaks with newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    // Remove all remaining HTML tags
    .replace(/<[^>]*>/g, '')
    // Decode HTML entities using the same mapping as decodeHTMLEntities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Fix spacing
    .replace(/\n\s*\n/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim();

  // If the extracted text is too short, it might be a paywall or similar
  if (text.length < 200) {
    console.log(`Extracted text too short (${text.length} chars), trying alternative extraction`);
    // Try a more aggressive approach - get all paragraphs
    const paragraphs = html.match(/<p[^>]*>(.*?)<\/p>/gi);
    if (paragraphs && paragraphs.length > 0) {
      text = paragraphs
        .map(p => p.replace(/<[^>]*>/g, ''))
        .join('\n\n')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  return text;
}
