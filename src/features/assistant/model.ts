export interface NvidiaNimErrorResponse {
    error?: { message?: string };
    detail?: string;
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

export interface NvidiaNimStreamChunk extends NvidiaNimErrorResponse {
    choices?: Array<{
        delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: Array<{
                index?: number;
                id?: string;
                type?: 'function';
                function?: { name?: string; arguments?: string };
            }>;
        };
    }>;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    reasoning_content?: string;
    tool_call_id?: string;
    name?: string;
}

export interface TavilySearchResponse {
    results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        published_date?: string;
    }>;
}
