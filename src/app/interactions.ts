import { Events, MessageFlags, type Client, type Interaction } from 'discord.js';
import logger from '../shared/logging/logger.js';
import { isInteractionResponseUnavailable, logInteractionError } from '../shared/discord/interactionErrors.js';

const registrations = new WeakMap<Client, () => void>();

async function dispatchInteraction(client: Client, interaction: Interaction): Promise<void> {
    for (const command of client.commands.values()) {
        if (command.handleInteraction && await command.handleInteraction(interaction)) return;
    }
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) { logger.warn(`No command matching ${interaction.commandName} was found; refresh Discord application commands.`); return; }
    await command.execute(interaction);
    logger.info(`execute command: ${command.data.name}, user: ${interaction.user.tag}`);
}
export function registerInteractions(client: Client): () => void {
    const existing = registrations.get(client);
    if (existing) return existing;
    const listener = async (interaction: Interaction) => {
        try { await dispatchInteraction(client, interaction); }
        catch (error) {
            logInteractionError(error);
            if (isInteractionResponseUnavailable(error) || !interaction.isRepliable()) return;
            const payload = { content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral as const };
            try {
                if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
                else await interaction.reply(payload);
            } catch (responseError) { logInteractionError(responseError); }
        }
    };
    client.on(Events.InteractionCreate, listener);
    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        client.off(Events.InteractionCreate, listener);
        registrations.delete(client);
    };
    registrations.set(client, dispose);
    return dispose;
}
