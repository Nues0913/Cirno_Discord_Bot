import { ChannelType, type ChatInputCommandInteraction, type GuildTextBasedChannel, type ButtonInteraction, type StringSelectMenuInteraction } from 'discord.js';
import type { MusicTrack } from '../model/track.js';
import { musicPlayer } from '../playback/player.js';
import { displayText } from './panel.js';

export type MusicInteraction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction;

export function textChannel(interaction: MusicInteraction): GuildTextBasedChannel {
    const channel = interaction.channel;
    if (!interaction.guild || !channel || channel.isDMBased() || !channel.isTextBased()) throw new Error('請在伺服器文字頻道使用此功能。');
    return channel as GuildTextBasedChannel;
}
export async function playTracks(interaction: MusicInteraction, tracks: MusicTrack[], next = false): Promise<string> {
    const channel = interaction.guild!.voiceStates.cache.get(interaction.user.id)?.channel;
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('請先加入一般語音頻道再點歌（不支援 Stage 頻道）。');
    const session = await musicPlayer.enqueueMany(channel, textChannel(interaction), interaction.user.id, interaction.user.displayName, tracks, next);
    return `已加入播放：${tracks.length === 1 ? `**${displayText(tracks[0].title)}**` : `${tracks.length} 首歌曲`}${session.panel.message ? `\n${session.panel.message.url}` : ''}`;
}
