import { Events, type Client, type Message } from 'discord.js';
import { generateNvidiaNimReply } from '../reply.js';
import { StreamingReply } from './streamingReply.js';
import logger from '../../../shared/logging/logger.js';

async function handleMention(client: Client, message: Message): Promise<void> {
    if (message.author.bot || !client.user || !message.mentions.users.has(client.user.id)) return;
    const prompt = message.content.replaceAll(`<@${client.user.id}>`, '').replaceAll(`<@!${client.user.id}>`, '').trim();
    if (!prompt) {
        await message.reply({ content: '請在提及我時附上想問的內容。', allowedMentions: { repliedUser: false } });
        return;
    }
    const response = await message.reply({ content: '正在思考…', allowedMentions: { parse: [], repliedUser: false } });
    const reply = new StreamingReply(message, response);
    try { await reply.complete(await generateNvidiaNimReply(prompt, reply.update, reply.update)); }
    catch (error) { logger.error(error); await reply.fail(); }
}
export function registerMentions(client: Client): () => void {
    const listener = (message: Message) => { void handleMention(client, message).catch(error => logger.error(error)); };
    client.on(Events.MessageCreate, listener);
    return () => { client.off(Events.MessageCreate, listener); };
}
