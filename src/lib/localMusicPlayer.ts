import { randomUUID } from 'node:crypto';
import {
    AudioPlayerStatus, createAudioPlayer, entersState, joinVoiceChannel,
    NoSubscriberBehavior, VoiceConnectionStatus,
    type AudioPlayer, type DiscordGatewayAdapterCreator, type VoiceConnection
} from '@discordjs/voice';
import { Events, PermissionFlagsBits, type Client, type GuildTextBasedChannel, type VoiceChannel } from 'discord.js';
import { musicLibrary, type LocalTrack } from './localMusicLibrary.js';
import { MusicQueue, GuildTasks } from './musicQueue.js';
import { createLocalAudio } from './localAudio.js';
import { MusicPanel, renderMusicPanel, type MusicPanelState } from './musicPanel.js';
import { voiceSessions, type VoiceLease } from './voiceSessionManager.js';
import logger from './logger.js';

export class MusicSession {
    readonly id = randomUUID().slice(0, 12);
    readonly queue = new MusicQueue();
    readonly panel = new MusicPanel(() => this.view(), error => logger.error(error));
    status: MusicPanelState['status'] = 'connecting';
    volume = 70;
    generation = 0;
    failures = 0;
    notice?: string;
    connection?: VoiceConnection;
    player?: AudioPlayer;
    audio?: ReturnType<typeof createLocalAudio>;
    progressTimer?: NodeJS.Timeout;
    emptyTimer?: NodeJS.Timeout;
    pauseTimer?: NodeJS.Timeout;
    bufferingTimer?: NodeJS.Timeout;
    recovering = false;
    hasConnected = false;
    constructor(readonly channel: VoiceChannel, readonly lease: VoiceLease) {}
    get active(): boolean { return this.lease.active && this.status !== 'ended'; }
    view(): MusicPanelState {
        return {
            id: this.id, generation: this.generation, channelId: this.channel.id,
            queue: this.queue, status: this.status, volume: this.volume,
            elapsed: (this.audio?.resource.playbackDuration ?? 0) / 1000, notice: this.notice
        };
    }
    clearAudio(): void {
        clearTimeout(this.bufferingTimer); this.bufferingTimer = undefined;
        clearTimeout(this.pauseTimer); this.pauseTimer = undefined;
        // Remove listeners before stop(), which emits Idle synchronously.
        this.player?.removeAllListeners();
        this.player?.stop(true); this.player = undefined;
        this.audio?.dispose(); this.audio = undefined;
    }
}

export class LocalMusicPlayer {
    private sessions = new Map<string, MusicSession>();
    private tasks = new GuildTasks();
    private initialized = false;
    get(guildId: string): MusicSession | undefined { return this.sessions.get(guildId); }
    initialize(client: Client): void {
        if (this.initialized) return;
        this.initialized = true;
        client.on(Events.VoiceStateUpdate, (oldState, newState) => {
            const session = this.get(newState.guild.id);
            if (!session) return;
            if (session.hasConnected && newState.id === client.user?.id && oldState.channelId === session.channel.id && newState.channelId !== session.channel.id) {
                this.end(session, 'Bot 已離開原語音頻道。');
            } else this.checkEmpty(session);
        });
    }
    private checkEmpty(session: MusicSession): void {
        if (!session.active) return;
        if (session.channel.members.some(member => !member.user.bot)) {
            clearTimeout(session.emptyTimer); session.emptyTimer = undefined;
        } else if (!session.emptyTimer) {
            session.emptyTimer = setTimeout(() => {
                if (session.active && !session.channel.members.some(member => !member.user.bot)) this.end(session, '頻道已無真人 60 秒，播放結束。');
            }, 60_000).unref();
        }
    }
    assertListener(session: MusicSession, userId: string): void {
        if (session.channel.guild.voiceStates.cache.get(userId)?.channelId !== session.channel.id) {
            throw new Error(`請先加入 <#${session.channel.id}>，才能控制播放器。`);
        }
    }
    assertPanel(guildId: string, sessionId: string, messageId: string): MusicSession {
        const session = this.get(guildId);
        if (!session?.active || session.id !== sessionId || session.panel.message?.id !== messageId) {
            throw new Error('此面板已失效，請使用 /music panel 或 /music play。');
        }
        return session;
    }
    async enqueue(channel: VoiceChannel, textChannel: GuildTextBasedChannel, userId: string, requestedBy: string, track: LocalTrack): Promise<MusicSession> {
        return this.tasks.run(channel.guild.id, async () => {
            let session = this.get(channel.guild.id);
            if (session) {
                this.assertListener(session, userId);
                session.queue.add({ track, requestedBy });
                session.panel.update();
                return session;
            }
            if (channel.guild.voiceStates.cache.get(userId)?.channelId !== channel.id) throw new Error('請先加入語音頻道再點歌。');
            const me = channel.guild.members.me;
            if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]) || !channel.joinable) {
                throw new Error('Bot 需要查看、連線及說話權限，且語音頻道需有可用位置。');
            }
            const sendPermission = textChannel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
            if (!textChannel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, sendPermission, PermissionFlagsBits.EmbedLinks])) {
                throw new Error('Bot 需要此文字頻道的查看、傳送訊息及嵌入連結權限。');
            }
            await musicLibrary.playablePath(track);
            const lease = voiceSessions.acquire(channel.guild.id, 'music')!;
            session = new MusicSession(channel, lease);
            const current = session;
            this.sessions.set(channel.guild.id, current);
            lease.onDispose(() => this.dispose(current));
            current.queue.add({ track, requestedBy });
            try {
                current.panel.attach(await textChannel.send(renderMusicPanel(current.view())));
                if (!current.active) throw new Error('播放已結束，請重新點歌。');
                const connection = joinVoiceChannel({
                    channelId: channel.id, guildId: channel.guild.id,
                    adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
                    selfDeaf: true, selfMute: false
                });
                current.connection = connection;
                connection.on('error', error => { logger.error(error); this.end(current, '語音連線發生錯誤。'); });
                connection.on(VoiceConnectionStatus.Disconnected, () => { void this.recover(current); });
                connection.on(VoiceConnectionStatus.Destroyed, () => {
                    if (current.active) this.end(current, '語音連線已關閉。');
                });
                await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
                if (!current.active) throw new Error('播放已結束，請重新點歌。');
                if (connection.joinConfig.channelId !== channel.id) throw new Error('Bot 已被移動至其他語音頻道。');
                current.hasConnected = true;
                current.progressTimer = setInterval(() => {
                    if (current.status === 'playing') current.panel.update();
                }, 15_000).unref();
                this.checkEmpty(current);
                await this.advance(current, 'finished');
                if (!current.active) throw new Error('音檔無法播放，請選擇其他歌曲。');
                return current;
            } catch (error) {
                this.end(current, '無法開始播放，請確認音檔與語音權限。');
                logger.error(error);
                throw new Error('無法開始播放，請確認音檔與語音權限後重試。');
            }
        });
    }
    private async recover(session: MusicSession): Promise<void> {
        if (!session.active || session.recovering || !session.connection) return;
        session.recovering = true;
        try { await entersState(session.connection, VoiceConnectionStatus.Ready, 20_000); }
        catch { if (session.active) this.end(session, '語音連線逾時，播放結束。'); }
        finally { session.recovering = false; }
    }
    private scheduleAdvance(session: MusicSession, token: number, reason: 'finished' | 'error', error?: Error): void {
        if (error) logger.error(error);
        void this.tasks.run(session.channel.guild.id, async () => {
            if (session.active && session.generation === token) await this.advance(session, reason);
        }).catch(error => { logger.error(error); this.end(session, '播放器發生錯誤。'); });
    }
    private async advance(session: MusicSession, reason: 'finished' | 'skip' | 'error'): Promise<void> {
        if (!session.active) return;
        const previous = session.queue.current;
        const playedMs = session.audio?.resource.playbackDuration ?? 0;
        // A decoder that produces no audio is a failed track, not a repeatable completion.
        if (reason === 'finished' && previous && playedMs === 0) reason = 'error';
        if (reason === 'error') {
            session.failures++;
            session.notice = `無法播放「${previous?.track.title ?? '此歌曲'}」，已略過。`;
        } else if (reason === 'finished') session.failures = 0;
        session.generation++;
        const token = session.generation;
        session.clearAudio();
        if (session.failures >= 3) { this.end(session, '連續三首無法播放，請檢查音檔。'); return; }
        const entry = session.queue.advance(reason);
        if (!entry) { this.end(session, reason === 'error' ? session.notice! : '播放清單已結束。'); return; }
        session.status = 'connecting';
        session.panel.update();
        try {
            const path = await musicLibrary.playablePath(entry.track);
            if (!session.active || session.generation !== token) return;
            const audio = createLocalAudio(path, session.volume, error => this.scheduleAdvance(session, token, 'error', error));
            session.audio = audio;
            const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
            session.player = player;
            player.once(AudioPlayerStatus.Idle, () => this.scheduleAdvance(session, token, 'finished'));
            player.on('error', error => this.scheduleAdvance(session, token, 'error', error));
            player.on(AudioPlayerStatus.Playing, () => {
                if (!session.active || session.generation !== token) return;
                clearTimeout(session.bufferingTimer); session.bufferingTimer = undefined;
                session.status = 'playing'; session.panel.update();
            });
            session.connection!.subscribe(player);
            player.play(audio.resource);
            session.bufferingTimer = setTimeout(() => this.scheduleAdvance(session, token, 'error', new Error('Audio buffering timed out')), 20_000).unref();
        } catch (error) {
            logger.error(error);
            await this.advance(session, 'error');
        }
    }
    async control(guildId: string, userId: string, action: string, panel?: { sessionId: string; messageId: string; generation: number }): Promise<void> {
        return this.tasks.run(guildId, async () => {
            const session = panel ? this.assertPanel(guildId, panel.sessionId, panel.messageId) : this.get(guildId);
            if (!session?.active) throw new Error('目前沒有手動播放中的音樂。');
            this.assertListener(session, userId);
            if (panel && ['skip', 'pause'].includes(action) && panel.generation !== session.generation) throw new Error('歌曲已切換，請使用更新後的面板。');
            switch (action) {
                case 'stop': this.end(session, '已結束播放。'); return;
                case 'skip': await this.advance(session, 'skip'); break;
                case 'pause':
                    if (session.status === 'paused') {
                        if (!session.player?.unpause()) throw new Error('目前無法繼續播放。');
                        session.status = 'playing'; clearTimeout(session.pauseTimer); session.pauseTimer = undefined;
                    } else if (session.status === 'playing') {
                        if (!session.player?.pause()) throw new Error('目前無法暫停。');
                        session.status = 'paused';
                        session.pauseTimer = setTimeout(() => {
                            if (session.active && session.status === 'paused') this.end(session, '暫停已達 10 分鐘，播放結束。');
                        }, 600_000).unref();
                    } else throw new Error('歌曲仍在載入中，請稍後再試。');
                    break;
                case 'repeat': session.queue.cycleRepeat(); break;
                case 'shuffle': session.queue.shuffle(); break;
                case 'up': case 'down':
                    session.volume = Math.max(0, Math.min(100, session.volume + (action === 'up' ? 10 : -10)));
                    session.audio?.resource.volume?.setVolume(session.volume / 100); break;
                default: throw new Error('未知的播放器操作。');
            }
            session.panel.update();
        });
    }
    async panel(guildId: string, textChannel: GuildTextBasedChannel, userId: string): Promise<string> {
        return this.tasks.run(guildId, async () => {
            const session = this.get(guildId);
            if (!session?.active) throw new Error('目前沒有手動播放中的音樂。');
            if (session.panel.message) {
                try { await session.panel.message.fetch(); return session.panel.message.url; }
                catch (error) { if ((error as { code?: number }).code !== 10008) throw error; }
            }
            this.assertListener(session, userId);
            const message = await textChannel.send(renderMusicPanel(session.view()));
            session.panel.attach(message);
            session.panel.update(true);
            return message.url;
        });
    }
    end(session: MusicSession, notice: string): void {
        if (!session.active) return;
        session.notice = notice;
        session.lease.release();
    }
    private dispose(session: MusicSession): void {
        session.status = 'ended'; session.generation++;
        if (this.get(session.channel.guild.id) === session) this.sessions.delete(session.channel.guild.id);
        clearInterval(session.progressTimer); clearTimeout(session.emptyTimer);
        session.clearAudio(); session.queue.clear();
        if (session.connection && session.connection.state.status !== VoiceConnectionStatus.Destroyed) session.connection.destroy();
        session.panel.update(true);
    }
}
export const musicPlayer = new LocalMusicPlayer();
