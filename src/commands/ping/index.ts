import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

const data = new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong!')
    .addBooleanOption(option => option.setName('silent').setDescription('Silent Pong!'));


async function execute(interaction: ChatInputCommandInteraction) {
    const silent = interaction.options.getBoolean('silent');
    if (silent) {
        await interaction.reply({content: "Pong!", ephemeral: true });
    } else {
        await interaction.reply("Pong!");
    }
    // await interaction.reply({ embeds: [embed] , flags: "Ephemeral" });
}

export { data, execute };
