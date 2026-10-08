import type { Collection } from 'discord.js';
import type { BotCommand } from './shared/discord/command.js';

declare module 'discord.js' {
    interface Client { commands: Collection<string, BotCommand>; }
}
