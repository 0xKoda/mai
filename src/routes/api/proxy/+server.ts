import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const targetUrl = url.searchParams.get('url');
  
  if (!targetUrl) {
    return json({ error: 'URL parameter is required' }, { status: 400 });
  }

  try {
    // Validate URL to prevent server-side request forgery
    const parsedUrl = new URL(targetUrl);
    
    // Block requests to internal network or localhost
    if (parsedUrl.hostname === 'localhost' || 
        parsedUrl.hostname === '127.0.0.1' ||
        parsedUrl.hostname.startsWith('192.168.') ||
        parsedUrl.hostname.startsWith('10.') ||
        parsedUrl.hostname.startsWith('172.16.')) {
      return json({ error: 'Cannot request internal network resources' }, { status: 403 });
    }

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const content = await response.text();
    return new Response(content, {
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  } catch (error: unknown) {
    console.error('Proxy API error:', error);
    return json({ error: 'Failed to fetch content' }, { status: 500 });
  }
};
