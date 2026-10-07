import dotenv from 'dotenv';
import fg from 'fast-glob';
import { Client, Events, Collection, GatewayIntentBits, REST, Routes, MessageFlags } from 'discord.js';
import logger from './lib/logger.js';
import { generateNvidiaNimReply } from './lib/nvidiaNim.js';
import { registerVoiceEntrancePlayer } from './lib/voiceEntrancePlayer.js';
import { musicPlayer } from './lib/localMusicPlayer.js';
import { musicLibrary } from './lib/localMusicLibrary.js';

dotenv.config();
const TOKEN = process.env.TOKEN || "";
const CLIENT_ID = process.env.CLIENT_ID || "";
const TESTER_ID = process.env.TESTER_ID || "";
const COMMAND_GLOB = import.meta.url.endsWith('.ts')
    ? 'src/commands/**/*.ts'
    : 'dist/commands/**/*.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent]
});
registerVoiceEntrancePlayer(client);
musicPlayer.initialize(client);
void musicLibrary.load().catch(error => logger.error(error));
client.commands = new Collection();
let commands = [];

function splitDiscordMessage(content: string, maxLength = 2000): string[] {
    const chunks: string[] = [];
    let remaining = content.trim();

    while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf('\n', maxLength);
        if (splitAt < maxLength / 2) {
            splitAt = remaining.lastIndexOf(' ', maxLength);
        }
        if (splitAt < maxLength / 2) {
            splitAt = maxLength;
        }

        chunks.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining) {
        chunks.push(remaining);
    }

    return chunks;
}

async function registerGlobalCommands(commands: any[]) {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    logger.info('Started refreshing global application (/) commands.');
    const data: any = await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    logger.info(`Successfully reloaded ${data.length} global application (/) commands.`);
}

(async () => {
    const files = await fg(COMMAND_GLOB, {
        absolute: true, onlyFiles: true,
        ignore: ['**/*.d.ts']
    });
    for (const file of files) {
        const command = await import(file);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commands.push(command.data.toJSON());
            // logger.info(`found ${command.data.name} command.`);
        }
    }
    (async (commands) => {
        try {
            await registerGlobalCommands(commands);
        } catch (error) {
            logger.error(error);
        }
    })(commands);
})();

client.on(Events.InteractionCreate, async interaction => {
    try {
        const playlistCommand = client.commands.get('playlist');
        if (playlistCommand?.handlePlaylistInteraction && await playlistCommand.handlePlaylistInteraction(interaction)) return;
        const musicCommand = client.commands.get('music');
        if (musicCommand?.handleMusicInteraction && await musicCommand.handleMusicInteraction(interaction)) return;
    } catch (error) {
        logger.error(error);
        return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'copymanager:add') {
        const command = interaction.client.commands.get('copymanager');
        if (!command || !('handleModal' in command)) {
            logger.error('No modal handler found for copymanager:add.');
            return;
        }
        try {
            await command.handleModal(interaction);
        } catch (error) {
            logger.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) {
        return;
    }
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
        logger.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }
    try {
        await command.execute(interaction);
        logger.info(`excute command: ${command.data.name}, user: ${interaction.user.tag}`)
    } catch (error) {
        logger.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', flags: "Ephemeral" });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', flags: "Ephemeral" });
        }
    }
});

// reload command
client.on(Events.MessageCreate, async (message) => {
    if (message.content === '!reload' && message.author.id === TESTER_ID) {
        try {
            const files = await fg(COMMAND_GLOB, {
                absolute: true, onlyFiles: true,
                ignore: ['**/*.d.ts']
            }); client.commands.clear();
            commands = [];
            for (const file of files) {
                const command = await import(`${file}?update=${Date.now()}`);   // https://futurestud.io/tutorials/node-js-esm-bypass-cache-for-dynamic-imports
                if ('data' in command && 'execute' in command) {
                    client.commands.set(command.data.name, command);
                    commands.push(command.data.toJSON());
                }
            }
            await registerGlobalCommands(commands);
            logger.info(`${commands.length} Commands reloaded by ${message.author.tag}.`);
            await message.reply(`${commands.length} Commands reloaded successfully.`);  // Ephemeral responses are only available for interaction responses
        } catch (error) {
            logger.error(error);
            message.reply('There was an error while reloading commands.');
        }
    }
});

// Ask MiniMax through NVIDIA NIM when the bot is mentioned.
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !client.user || !message.mentions.users.has(client.user.id)) {
        return;
    }

    const prompt = message.content
        .replaceAll(`<@${client.user.id}>`, '')
        .replaceAll(`<@!${client.user.id}>`, '')
        .trim();

    if (!prompt) {
        await message.reply({
            content: '請在提及我時附上想問的內容。',
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    const responseMessage = await message.reply({
        content: '正在思考…',
        allowedMentions: { parse: [], repliedUser: false }
    });
    let latestAnswer = '';
    let lastEditAt = 0;
    let lastRenderedAnswer = '';
    let editQueue = Promise.resolve();

    const queueStreamingEdit = (content: string) => {
        latestAnswer = content;
        const now = Date.now();
        if (now - lastEditAt < 1_250) {
            return;
        }
        lastEditAt = now;

        editQueue = editQueue
            .then(async () => {
                const preview = latestAnswer.length > 2000
                    ? `${latestAnswer.slice(0, 1997)}...`
                    : latestAnswer;
                if (preview && preview !== lastRenderedAnswer) {
                    await responseMessage.edit({
                        content: preview,
                        allowedMentions: { parse: [] }
                    });
                    lastRenderedAnswer = preview;
                }
            })
            .catch(error => {
                logger.error(error);
            });
    };

    try {
        const answer = await generateNvidiaNimReply(
            prompt,
            queueStreamingEdit,
            queueStreamingEdit
        );
        await editQueue;

        const chunks = splitDiscordMessage(answer);
        await responseMessage.edit({
            content: chunks[0],
            allowedMentions: { parse: [] }
        });

        for (const chunk of chunks.slice(1)) {
            await message.channel.send({
                content: chunk,
                allowedMentions: { parse: [] }
            });
        }
    } catch (error) {
        logger.error(error);
        await editQueue;

        const interruptionNotice = '\n\n⚠️ 回覆中斷，請稍後再試。';
        const errorContent = latestAnswer
            ? `${latestAnswer.slice(0, 2000 - interruptionNotice.length).trimEnd()}${interruptionNotice}`
            : '目前無法取得 AI 回覆，請稍後再試。';
        await responseMessage.edit({
            content: errorContent,
            allowedMentions: { parse: [] }
        });
    }
});

client.once(Events.ClientReady, readyClient => {
    logger.info(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Log in to Discord with your client's token
client.login(TOKEN);
