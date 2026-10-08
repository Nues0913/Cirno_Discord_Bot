import { fetchPublicUrl } from './integrations/safeWebFetch.js';
import { getPositiveInteger } from './config.js';
import type { ToolCall, TavilySearchResponse } from './model.js';

const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 20_000;

export const DIRECT_FETCH_TOOL = {
    type: 'function',
    function: {
        name: 'fetch_url',
        description: 'Directly fetch a known authoritative HTTPS webpage or JSON API. Prefer this over web_search when you know the exact official source URL.',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The complete public HTTPS URL to retrieve.'
                }
            },
            required: ['url'],
            additionalProperties: false
        }
    }
};

export const WEB_SEARCH_TOOL = {
    type: 'function',
    function: {
        name: 'web_search',
        description: 'Search the live web for current, recent, changing, or externally verifiable information.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'A concise web search query in the language most likely to return useful sources.'
                }
            },
            required: ['query'],
            additionalProperties: false
        }
    }
};

async function searchWeb(query: string, callerSignal?: AbortSignal): Promise<string> {
    callerSignal?.throwIfAborted();
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
        return JSON.stringify({
            error: 'Web search is not configured. Set TAVILY_API_KEY on the bot server.',
            query
        });
    }

    const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            query: query.slice(0, 400),
            search_depth: process.env.TAVILY_SEARCH_DEPTH ?? 'fast',
            topic: 'general',
            max_results: Math.min(getPositiveInteger(process.env.TAVILY_MAX_RESULTS, 5), 10),
            include_answer: false,
            include_raw_content: false
        }),
        signal: AbortSignal.any([
            AbortSignal.timeout(getPositiveInteger(process.env.WEB_SEARCH_TIMEOUT_MS, DEFAULT_WEB_SEARCH_TIMEOUT_MS)),
            ...(callerSignal ? [callerSignal] : [])
        ])
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
            `Tavily search failed (HTTP ${response.status}): ${errorBody.slice(0, 500)}`
        );
    }

    const data = await response.json() as TavilySearchResponse;
    return JSON.stringify({
        query,
        results: (data.results ?? []).map(result => ({
            title: result.title ?? 'Untitled source',
            url: result.url ?? '',
            content: result.content ?? '',
            publishedDate: result.published_date ?? null
        }))
    });
}

export async function executeToolCall(toolCall: ToolCall, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    let args: unknown;
    try {
        args = JSON.parse(toolCall.function.arguments);
    } catch {
        return JSON.stringify({ error: 'The web search arguments were invalid JSON.' });
    }

    if (toolCall.function.name === 'fetch_url') {
        const url = typeof args === 'object' && args !== null && 'url' in args
            ? (args as { url?: unknown }).url
            : undefined;
        if (typeof url !== 'string' || !url.trim()) {
            return JSON.stringify({ error: 'A non-empty HTTPS URL is required.' });
        }
        return fetchPublicUrl(url.trim(), signal);
    }

    if (toolCall.function.name !== 'web_search') {
        return JSON.stringify({ error: `Unsupported tool: ${toolCall.function.name}` });
    }

    const query = typeof args === 'object' && args !== null && 'query' in args
        ? (args as { query?: unknown }).query
        : undefined;
    if (typeof query !== 'string' || !query.trim()) {
        return JSON.stringify({ error: 'A non-empty search query is required.' });
    }

    try {
        return await searchWeb(query.trim(), signal);
    } catch (error) {
        signal?.throwIfAborted();
        return JSON.stringify({
            error: error instanceof Error ? error.message : 'Web search failed.',
            query
        });
    }
}
