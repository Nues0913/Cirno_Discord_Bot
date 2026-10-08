import { Events, type Client, type Message } from 'discord.js';
import { generateNvidiaNimReply } from '../reply.js';
import { StreamingReply } from './streamingReply.js';
import { logInteractionError } from '../../../shared/discord/interactionErrors.js';

async function handleMention(client: Client, message: Message, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (message.author.bot || !client.user || !message.mentions.users.has(client.user.id)) return;
    const prompt = message.content.replaceAll(`<@${client.user.id}>`, '').replaceAll(`<@!${client.user.id}>`, '').trim();
    if (!prompt) {
        await message.reply({ content: '請在提及我時附上想問的內容。', allowedMentions: { repliedUser: false } });
        return;
    }
    const response = await message.reply({ content: '正在思考…', allowedMentions: { parse: [], repliedUser: false } });
    if (signal.aborted) return;
    const reply = new StreamingReply(message, response, signal);
    try { await reply.complete(await generateNvidiaNimReply(prompt, reply.update, reply.update, signal)); }
    catch (error) { if (!signal.aborted) { logInteractionError(error); await reply.fail(); } }
}
export function registerMentions(client: Client): () => void {
    const pending = new Set<AbortController>();
    let disposed = false;
    const listener = (message: Message) => {
        if (disposed) return;
        const controller = new AbortController();
        pending.add(controller);
        void handleMention(client, message, controller.signal)
            .catch(error => { if (!controller.signal.aborted) logInteractionError(error); })
            .finally(() => pending.delete(controller));
    };
    client.on(Events.MessageCreate, listener);
    return () => {
        disposed = true;
        client.off(Events.MessageCreate, listener);
        for (const controller of pending) controller.abort();
        pending.clear();
    };
}
