import type { ChatInputCommandInteraction, Interaction, ModalSubmitInteraction, RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
export interface BotCommand {
    data: { readonly name: string; toJSON(): RESTPostAPIApplicationCommandsJSONBody };
    execute(interaction: ChatInputCommandInteraction): Promise<void>;
    handleInteraction?(interaction: Interaction): Promise<boolean>;
    handleModal?(interaction: ModalSubmitInteraction): Promise<void>;
    loadHandlers?(reloadKey: string): Promise<Pick<BotCommand, 'execute' | 'handleInteraction'>>;
    afterReload?(): void;
}
export function isBotCommand(value: unknown): value is BotCommand {
    if (!value || typeof value !== 'object') return false;
    const command = value as Partial<BotCommand>;
    return typeof command.execute === 'function' && typeof command.data?.name === 'string' && typeof command.data.toJSON === 'function';
}
