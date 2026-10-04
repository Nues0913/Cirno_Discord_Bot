import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { getRandom, search, getById } from '../../lib/db.js';
import logger from '../../lib/logger.js';

const data = new SlashCommandBuilder()
    .setName('copyessay')
    .setDescription('複製文相關指令')
    .addSubcommand(sub =>
        sub.setName('random')
            .setDescription('隨機獲取一則複製文')
            .addBooleanOption(opt => opt.setName('silent').setDescription('僅自己可見'))
    )
    .addSubcommand(sub =>
        sub.setName('search')
            .setDescription('搜尋相關複製文並列出分數')
            .addStringOption(opt => opt.setName('query').setDescription('關鍵字、描述或句子').setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName('id')
            .setDescription('依 ID 直接顯示複製文')
            .addIntegerOption(opt => opt.setName('id').setDescription('複製文 ID').setRequired(true))
            .addBooleanOption(opt => opt.setName('silent').setDescription('僅自己可見'))
    );

async function execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const silent = interaction.options.getBoolean('silent') || false;
    const flags = silent ? MessageFlags.Ephemeral : undefined;

    if (sub === 'random') {
        const essay = await getRandom();
        if (!essay) {
            await interaction.reply({ content: '資料庫中尚無複製文', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.reply({ content: essay.content, ...(flags ? { flags } : {}) });
        logger.info(`copyessay random id=${essay.id} user=${interaction.user.tag} silent=${silent}`);

    } else if (sub === 'search') {
        const query = interaction.options.getString('query', true);
        const results = await search(query);
        if (results.length === 0) {
            await interaction.reply({ content: '找不到相關複製文', flags: MessageFlags.Ephemeral });
            return;
        }
        const lines = results
            .slice(0, 10)
            .map(r => `**#${r.essay.id}** ${r.essay.title} ｜ 相關度：${r.score} ｜ ${r.essay.content.slice(0, 30)}${r.essay.content.length > 30 ? '…' : ''}`);
        await interaction.reply({
            content: `找到 ${results.length} 則相關複製文：\n${lines.join('\n')}`,
            flags: MessageFlags.Ephemeral
        });
        logger.info(`copyessay search query="${query}" found=${results.length} user=${interaction.user.tag}`);

    } else if (sub === 'id') {
        const id = interaction.options.getInteger('id', true);
        const essay = await getById(id);
        if (!essay) {
            await interaction.reply({ content: `找不到 ID 為 ${id} 的複製文`, flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.reply({ content: essay.content, ...(flags ? { flags } : {}) });
        logger.info(`copyessay id=${id} user=${interaction.user.tag}`);
    }
}

export { data, execute };
