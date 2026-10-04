import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown, type Message } from 'discord.js';
import type { MusicQueue } from './musicQueue.js';

export interface MusicPanelState {
    id: string;
    generation: number;
    channelId: string;
    queue: MusicQueue;
    status: 'connecting' | 'playing' | 'paused' | 'ended';
    volume: number;
    elapsed: number;
    notice?: string;
}
export function displayText(value: string, length = 160): string {
    return escapeMarkdown(value.replace(/@/g, '@\u200b').replace(/[\r\n]+/g, ' ')).slice(0, length);
}
export function durationText(seconds?: number): string {
    if (seconds === undefined || !Number.isFinite(seconds)) return '總長未知';
    const total = Math.max(0, Math.floor(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
export const repeatLabels = { off: '關閉', one: '單曲', all: '佇列' };
export function renderMusicPanel(state: MusicPanelState) {
    const { queue, status } = state;
    const track = queue.current?.track;
    const ended = status === 'ended';
    const paused = status === 'paused';
    const active = status === 'playing' || paused;
    const elapsed = track?.duration ? Math.min(track.duration, state.elapsed) : state.elapsed;
    const position = track?.duration ? Math.min(11, Math.floor(elapsed / track.duration * 12)) : 0;
    const progress = track?.duration ? `${'━'.repeat(position)}●${'━'.repeat(11 - position)}` : '播放時間';
    const labels = { connecting: '連線／載入中', playing: '播放中', paused: '已暫停', ended: '已結束' };
    const embed = new EmbedBuilder()
        .setColor(ended ? 0x747f8d : paused ? 0xdaa520 : 0x20b2aa)
        .setTitle(`🎧 本地電台 · ${labels[status]}`)
        .setDescription(track
            ? `**${displayText(track.title, 200)}**${track.artist ? `\n${displayText(track.artist)}` : ''}\n本地曲庫 · 點歌者：${displayText(queue.current!.requestedBy, 60)}\n\n\`${durationText(elapsed)} ${progress} ${durationText(track.duration)}\``
            : '選擇本地歌曲，與語音頻道的朋友一起聆聽。')
        .addFields(
            { name: '🔊 音量', value: `${state.volume}%`, inline: true },
            { name: '🔁 循環', value: repeatLabels[queue.repeat], inline: true },
            { name: '📍 語音頻道', value: `<#${state.channelId}>`, inline: true },
            { name: `📚 待播 ${queue.pending.length} 首`, value: queue.pending[0] ? `下一首：${displayText(queue.pending[0].track.title)}` : '尚無待播歌曲' }
        );
    if (state.notice) embed.addFields({ name: '播放提示', value: displayText(state.notice, 500) });
    embed.setFooter({ text: ended ? '使用 /music play 開始新的播放' : '同語音頻道成員可共同控制 · 進度約每 15 秒更新' });
    const button = (action: string, label: string, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
        .setCustomId(`music:${state.id}:${action}:${state.generation}`)
        .setLabel(label).setStyle(style).setDisabled(ended || disabled);
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                button('pause', paused ? '▶ 繼續' : '⏸ 暫停', ButtonStyle.Primary, !active),
                button('skip', queue.repeat === 'one' ? '⏮ 從頭播放' : '⏭ 下一首', ButtonStyle.Secondary, !active),
                button('repeat', `🔁 循環：${repeatLabels[queue.repeat]}`),
                button('shuffle', '🔀 打亂待播', ButtonStyle.Secondary, queue.pending.length < 2)
            ),
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                button('library', '🎵 選歌'), button('queue', '📜 佇列'),
                button('down', '🔉 降音量', ButtonStyle.Secondary, state.volume === 0),
                button('up', '🔊 升音量', ButtonStyle.Secondary, state.volume === 100),
                button('stop', '⏹ 結束播放', ButtonStyle.Danger)
            )
        ],
        allowedMentions: { parse: [] as [] }
    };
}

// Coalesce updates and serialize edits so a stale progress update cannot overwrite "ended".
export class MusicPanel {
    message?: Message;
    private timer?: NodeJS.Timeout;
    private edits: Promise<unknown> = Promise.resolve();
    private retryTimer?: NodeJS.Timeout;
    private failures = 0;
    constructor(private view: () => MusicPanelState, private onError: (error: unknown) => void) {}
    attach(message: Message): void {
        clearTimeout(this.retryTimer); this.retryTimer = undefined; this.failures = 0;
        this.message = message;
    }
    update(immediate = false): void {
        if (this.timer) {
            if (!immediate) return;
            clearTimeout(this.timer);
        }
        if (immediate) { this.timer = undefined; this.edit(); }
        else this.timer = setTimeout(() => { this.timer = undefined; this.edit(); }, 1000).unref();
    }
    private edit(): void {
        this.edits = this.edits.catch(() => undefined).then(async () => {
            const message = this.message;
            if (!message) return;
            try {
                await message.edit(renderMusicPanel(this.view()));
                this.failures = 0; clearTimeout(this.retryTimer); this.retryTimer = undefined;
            }
            catch (error) {
                if ((error as { code?: number }).code === 10008 && this.message === message) this.message = undefined;
                else {
                    this.onError(error);
                    // discord.js handles rate-limit delays; retry transient edit failures at most twice.
                    if (++this.failures <= 2 && !this.retryTimer) {
                        this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.edit(); }, this.failures * 2000).unref();
                    }
                }
            }
        });
    }
}
