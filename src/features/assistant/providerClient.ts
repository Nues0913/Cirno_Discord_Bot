import type { ChatMessage, ToolCall, NvidiaNimErrorResponse } from './model.js';
import { getPositiveInteger, getErrorMessage } from './config.js';
import { DIRECT_FETCH_TOOL, WEB_SEARCH_TOOL } from './tools.js';
import { readCompletionStream } from './protocol.js';

const DEFAULT_NVIDIA_NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_NVIDIA_NIM_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_NVIDIA_NIM_TIMEOUT_MS = 180_000;

export async function streamCompletion(
    messages: ChatMessage[],
    onUpdate?: (content: string) => void,
    enableWebTools = false,
    toolChoice: 'auto' | 'required' = 'auto'
): Promise<{ content: string; reasoningContent: string; toolCalls: ToolCall[] }> {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
        throw new Error('NVIDIA_API_KEY is not configured.');
    }

    const response = await fetch(
        process.env.NVIDIA_NIM_URL ?? DEFAULT_NVIDIA_NIM_URL,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'text/event-stream',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: process.env.NVIDIA_NIM_MODEL ?? DEFAULT_NVIDIA_NIM_MODEL,
                messages,
                ...(enableWebTools
                    ? {
                        tools: process.env.TAVILY_API_KEY
                            ? [DIRECT_FETCH_TOOL, WEB_SEARCH_TOOL]
                            : [DIRECT_FETCH_TOOL],
                        tool_choice: toolChoice
                    }
                    : {}),
                max_tokens: getPositiveInteger(process.env.NVIDIA_NIM_MAX_TOKENS, 1024),
                reasoning_effort: process.env.NVIDIA_NIM_REASONING_EFFORT ?? 'low',
                temperature: 1,
                stream: true
            }),
            signal: AbortSignal.timeout(
                getPositiveInteger(process.env.NVIDIA_NIM_TIMEOUT_MS, DEFAULT_NVIDIA_NIM_TIMEOUT_MS)
            )
        }
    );

    if (!response.ok) {
        const data = await response.json()
            .catch(() => undefined) as NvidiaNimErrorResponse | undefined;
        throw new Error(
            `NVIDIA NIM request failed (HTTP ${response.status}): ${getErrorMessage(data)}`
        );
    }
    if (!response.body) {
        throw new Error('NVIDIA NIM returned a response without a stream.');
    }

    return readCompletionStream(response.body, onUpdate);
}
