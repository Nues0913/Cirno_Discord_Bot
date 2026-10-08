import { glob, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Collection, REST, Routes, type Client } from 'discord.js';
import { isBotCommand, type BotCommand } from '../shared/discord/command.js';
import logger from '../shared/logging/logger.js';

export async function loadCommands(client: Client, reload = false) {
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
    const cwd = fileURLToPath(new URL('../commands/', import.meta.url));
    const files: string[] = [];
    for await (const file of glob(`*/index.${extension}`, { cwd })) {
        const path = resolve(cwd, file);
        if ((await stat(path)).isFile()) files.push(path);
    }
    const commands = new Collection<string, BotCommand>();
    const reloadKey = String(Date.now());
    for (const file of files.sort()) {
        const url = pathToFileURL(file);
        if (reload) url.searchParams.set('update', reloadKey);
        const command: unknown = await import(url.href);
        if (!isBotCommand(command)) throw new Error(`Invalid command entry: ${file}`);
        if (commands.has(command.data.name)) throw new Error(`Duplicate command: ${command.data.name}`);
        const handlers = reload && command.loadHandlers ? await command.loadHandlers(reloadKey) : {};
        commands.set(command.data.name, { ...command, ...handlers });
    }
    // Replace only after every entry loads successfully; a failed reload keeps working commands.
    client.commands = commands;
    if (reload) for (const command of commands.values()) command.afterReload?.();
    return commands.map(command => command.data.toJSON());
}
export async function registerGlobalCommands(token: string, clientId: string, commands: ReturnType<BotCommand['data']['toJSON']>[]) {
    const rest = new REST({ version: '10' }).setToken(token);
    logger.info('Started refreshing global application (/) commands.');
    const registered = await rest.put(Routes.applicationCommands(clientId), { body: commands });
    logger.info(`Successfully reloaded ${Array.isArray(registered) ? registered.length : commands.length} global application (/) commands.`);
}
