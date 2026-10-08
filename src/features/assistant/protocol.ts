import type { NvidiaNimStreamChunk, ToolCall } from './model.js';
import { getErrorMessage } from './config.js';

/** Accumulates completion deltas independently of HTTP and Discord. */
export class CompletionAccumulator {
    private content = '';
    private reasoningContent = '';
    private readonly toolCalls = new Map<number, ToolCall>();
    constructor(private readonly onUpdate?: (content: string) => void) {}

    processLine(rawLine: string): boolean {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) return false;
        const payload = line.slice(5).trim();
        if (!payload) return false;
        if (payload === '[DONE]') return true;
        let data: NvidiaNimStreamChunk;
        try { data = JSON.parse(payload) as NvidiaNimStreamChunk; }
        catch { throw new Error('NVIDIA NIM returned invalid streaming data.'); }
        if (!data || typeof data !== 'object') throw new Error('NVIDIA NIM returned invalid streaming data.');
        if (data.error || data.detail) throw new Error(`NVIDIA NIM stream failed: ${getErrorMessage(data)}`);
        const delta = data.choices?.[0]?.delta;
        if (typeof delta?.reasoning_content === 'string') this.reasoningContent += delta.reasoning_content;
        if (typeof delta?.content === 'string' && delta.content) {
            this.content += delta.content;
            this.onUpdate?.(this.content);
        }
        for (const fragment of delta?.tool_calls ?? []) {
            const index = fragment.index ?? 0;
            const call = this.toolCalls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (fragment.id) call.id += fragment.id;
            if (fragment.function?.name) call.function.name += fragment.function.name;
            if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
            this.toolCalls.set(index, call);
        }
        return false;
    }

    result() {
        return {
            content: this.content.trim(), reasoningContent: this.reasoningContent,
            toolCalls: [...this.toolCalls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call)
        };
    }
}

export async function readCompletionStream(body: ReadableStream<Uint8Array>, onUpdate?: (content: string) => void) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const accumulator = new CompletionAccumulator(onUpdate);
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            if (done) {
                if (buffer) accumulator.processLine(buffer);
                return accumulator.result();
            }
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) if (accumulator.processLine(line)) return accumulator.result();
        }
    } finally {
        // [DONE], malformed data and consumer errors all release the underlying stream.
        try { await reader.cancel(); } catch { /* A failed transport may already be closed. */ }
        finally { reader.releaseLock(); }
    }
}
