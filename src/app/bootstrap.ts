import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { loadCommands, registerGlobalCommands } from './commandLoader.js';
import { registerInteractions } from './interactions.js';
import { registerReload } from './reload.js';
import { registerMentions } from '../features/assistant/presentation/mentions.js';
import { registerVoiceEntrancePlayer } from '../features/voice/entrancePlayer.js';
import { musicPlayer } from '../features/music/playback/player.js';
import logger from '../shared/logging/logger.js';

export async function startBot() {
    const config = { token: process.env.TOKEN ?? '', clientId: process.env.CLIENT_ID ?? '', testerId: process.env.TESTER_ID ?? '' };
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
    client.commands = new Collection();
    const cleanup = [registerVoiceEntrancePlayer(client), registerInteractions(client), registerReload(client, config), registerMentions(client)];
    musicPlayer.initialize(client);
    client.once(Events.ClientReady, ready => logger.info(`Ready! Logged in as ${ready.user.tag}`));
    try { await registerGlobalCommands(config.token, config.clientId, await loadCommands(client)); }
    catch (error) { logger.error(error); }
    const stop = () => {
        for (const dispose of cleanup) dispose();
        musicPlayer.shutdown(); client.destroy();
        process.off('SIGTERM', stop); process.off('SIGINT', stop);
    };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    try { await client.login(config.token); }
    catch (error) { stop(); throw error; }
    return { client, stop };
}
