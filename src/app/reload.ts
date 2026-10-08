import { Events, type Client, type Message } from 'discord.js';
import { loadCommands, registerGlobalCommands } from './commandLoader.js';
import logger from '../shared/logging/logger.js';

export function registerReload(client: Client, config: { token: string; clientId: string; testerId: string }): () => void {
    const listener = async (message: Message) => {
        if (message.content !== '!reload' || message.author.id !== config.testerId) return;
        try {
            const commands = await loadCommands(client, true);
            await registerGlobalCommands(config.token, config.clientId, commands);
            logger.info(`${commands.length} Commands reloaded by ${message.author.tag}.`);
            await message.reply(`${commands.length} Commands reloaded successfully.`);
        } catch (error) {
            logger.error(error);
            await message.reply('There was an error while reloading commands.').catch(error => logger.error(error));
        }
    };
    client.on(Events.MessageCreate, listener);
    return () => { client.off(Events.MessageCreate, listener); };
}
