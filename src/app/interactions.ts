import { Events, MessageFlags, type Client, type Interaction } from 'discord.js';
import logger from '../shared/logging/logger.js';

async function dispatchInteraction(client: Client, interaction: Interaction): Promise<void> {
    for (const command of client.commands.values()) {
        if (command.handleInteraction && await command.handleInteraction(interaction)) return;
    }
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) { logger.error(`No command matching ${interaction.commandName} was found.`); return; }
    await command.execute(interaction);
    logger.info(`execute command: ${command.data.name}, user: ${interaction.user.tag}`);
}
export function registerInteractions(client: Client): () => void {
    const listener = async (interaction: Interaction) => {
        try { await dispatchInteraction(client, interaction); }
        catch (error) {
            logger.error(error);
            if (!interaction.isRepliable()) return;
            const payload = { content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral as const };
            try {
                if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
                else await interaction.reply(payload);
            } catch (responseError) { logger.error(responseError); }
        }
    };
    client.on(Events.InteractionCreate, listener);
    return () => { client.off(Events.InteractionCreate, listener); };
}
