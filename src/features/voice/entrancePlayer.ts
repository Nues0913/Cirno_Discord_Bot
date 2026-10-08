import {
    AudioPlayerStatus, createAudioPlayer, entersState, joinVoiceChannel,
    NoSubscriberBehavior, VoiceConnectionStatus, type DiscordGatewayAdapterCreator
} from '@discordjs/voice';
import { Client, Events, type VoiceBasedChannel } from 'discord.js';
import { existsSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import logger from '../../shared/logging/logger.js';
import { voiceSessions, type VoiceLease } from './sessionManager.js';
import { AUDIO_EXTENSIONS } from '../music/library/localLibrary.js';
import { createLocalAudio } from '../music/audio/localAudio.js';

function findAudioFiles(): string[] {
    const directory = resolve(process.env.VOICE_AUDIO_DIRECTORY?.trim() || 'assets/songs');
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
        .map(entry => resolve(directory, entry.name));
}
export function registerVoiceEntrancePlayer(client: Client): () => void {
    const configured = process.env.VOICE_CHANNEL_IDS?.split(',').map(id => id.trim()).filter(Boolean);
    const channelIds = new Set(configured ?? []);
    const lastFiles = new Map<string, string>();
    const start = async (channel: VoiceBasedChannel, lease: VoiceLease) => {
        try {
            const files = findAudioFiles();
            if (!files.length) { logger.warn('Voice entrance audio is missing. Add files to assets/songs or set VOICE_AUDIO_DIRECTORY.'); lease.release(); return; }
            const previous = lastFiles.get(channel.guild.id);
            const file = files[((previous ? files.indexOf(previous) : -1) + 1) % files.length];
            lastFiles.set(channel.guild.id, file);
            const connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator, selfDeaf: true, selfMute: false });
            lease.onDispose(() => { if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy(); });
            connection.on('error', error => { if (lease.active) { logger.error(error); lease.release(); } });
            connection.on(VoiceConnectionStatus.Disconnected, () => lease.release());
            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
            if (!lease.active) return;
            const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
            const audio = createLocalAudio(file, 100, error => { if (lease.active) { logger.error(error); lease.release(); } });
            lease.onDispose(() => { player.removeAllListeners(); player.stop(true); audio.dispose(); });
            player.once(AudioPlayerStatus.Idle, () => lease.release());
            player.once('error', error => { if (lease.active) { logger.error(error); lease.release(); } });
            const timeout = setTimeout(() => lease.release(), 20_000).unref();
            lease.onDispose(() => clearTimeout(timeout));
            player.once(AudioPlayerStatus.Playing, () => clearTimeout(timeout));
            connection.subscribe(player); player.play(audio.resource);
            logger.info(`Playing entrance audio ${file} in voice channel ${channel.id}.`);
        } catch (error) {
            if (lease.active) { logger.error(error); lease.release(); }
        }
    };
    const listener: Parameters<Client['on']>[1] = (oldState: import('discord.js').VoiceState, newState: import('discord.js').VoiceState) => {
        if (!newState.channelId || !channelIds.has(newState.channelId) || oldState.channelId === newState.channelId || newState.member?.user.bot || !newState.channel) return;
        // Acquire synchronously: a manual owner is never interrupted by a join event.
        const lease = voiceSessions.acquire(newState.guild.id, 'entrance');
        if (lease) void start(newState.channel, lease);
    };
    client.on(Events.VoiceStateUpdate, listener);
    logger.info(`Monitoring voice channels ${[...channelIds].join(', ')} for member joins.`);
    return () => { client.off(Events.VoiceStateUpdate, listener); voiceSessions.releaseAll('entrance'); };
}
