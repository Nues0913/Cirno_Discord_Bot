import {
    ActionRowBuilder,
    ChatInputCommandInteraction,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { add, remove, getAll, count } from '../../lib/db.js';
import logger from '../../lib/logger.js';

const data = new SlashCommandBuilder()
    .setName('copymanager')
    .setDescription('管理複製文資料庫')
    .addSubcommand(sub =>
        sub.setName('add')
            .setDescription('新增一則複製文')
    )
    .addSubcommand(sub =>
        sub.setName('delete')
            .setDescription('刪除一則複製文')
            .addIntegerOption(opt => opt.setName('id').setDescription('複製文 ID').setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName('list')
            .setDescription('列出所有複製文')
    );

async function execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
        const titleInput = new TextInputBuilder()
            .setCustomId('title')
            .setLabel('標題')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true);

        const contentInput = new TextInputBuilder()
            .setCustomId('content')
            .setLabel('內容')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(2000)
            .setRequired(true);

        const modal = new ModalBuilder()
            .setCustomId('copymanager:add')
            .setTitle('新增複製文')
            .addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput)
            );

        await interaction.showModal(modal);

    } else if (sub === 'delete') {
        const id = interaction.options.getInteger('id', true);
        const ok = await remove(id);
        await interaction.reply({
            content: ok ? `已刪除複製文 #${id}` : `找不到 ID 為 ${id} 的複製文`,
            flags: MessageFlags.Ephemeral
        });
        logger.info(`copymanager delete id=${id} ok=${ok} by ${interaction.user.tag}`);

    } else if (sub === 'list') {
        const essays = await getAll();
        if (essays.length === 0) {
            await interaction.reply({ content: '目前沒有任何複製文', flags: MessageFlags.Ephemeral });
            return;
        }
        const lines = essays.map(e => `**#${e.id}** ${e.title || '(無標題)'} — ${e.content.slice(0, 40)}${e.content.length > 40 ? '…' : ''}`);
        // Discord message limit: 2000 chars; chunk if needed
        const chunks: string[] = [];
        let current = '';
        for (const line of lines) {
            if (current.length + line.length + 1 > 1900) {
                chunks.push(current);
                current = line;
            } else {
                current += (current ? '\n' : '') + line;
            }
        }
        if (current) chunks.push(current);

        await interaction.reply({ content: `共 ${essays.length} 則複製文：\n${chunks[0]}`, flags: MessageFlags.Ephemeral });
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral });
        }
        logger.info(`copymanager list count=${essays.length} by ${interaction.user.tag}`);
    }
}

async function handleModal(interaction: ModalSubmitInteraction) {
    const title = interaction.fields.getTextInputValue('title');
    const content = interaction.fields.getTextInputValue('content');
    const entry = await add(title, content);

    await interaction.reply({
        content: `已新增複製文 #${entry.id}：**${entry.title}**`,
        flags: MessageFlags.Ephemeral
    });
    logger.info(`copymanager add id=${entry.id} title="${entry.title}" by ${interaction.user.tag}`);
}

export { data, execute, handleModal };
