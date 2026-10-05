import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createAudioResource, StreamType } from '@discordjs/voice';
import ffmpegPath from 'ffmpeg-static';
import { createLocalAudio } from './localAudio.js';
import { openRemoteAudio, type RemoteTrack } from './remoteMusicLibrary.js';

type AudioOutput = ReturnType<typeof createLocalAudio>;

function checkHeaders(response: Response, track: RemoteTrack): void {
    const type = response.headers.get('content-type')?.split(';')[0]?.trim();
    if (type && !type.startsWith('audio/') && type !== 'video/webm' && type !== 'application/ogg' && type !== 'application/octet-stream') {
        throw new Error('遠端服務未回傳音檔。');
    }
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== track.byteSize) throw new Error('遠端音檔大小與曲庫資料不一致。');
}

function meter(track: RemoteTrack, hash?: ReturnType<typeof createHash>): Transform {
    let bytes = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length;
            if (bytes > track.byteSize) return callback(new Error('遠端音檔超過預期大小。'));
            hash?.update(chunk);
            callback(null, chunk);
        },
        flush(callback) {
            if (bytes !== track.byteSize) return callback(new Error('遠端音檔傳輸不完整。'));
            if (hash && hash.digest('hex') !== track.sha256.toLowerCase()) return callback(new Error('遠端音檔雜湊驗證失敗。'));
            callback();
        }
    });
}

const PCM_BYTES_PER_SECOND = 48_000 * 2 * 2;

function decodedAudioBuffer(): Transform {
    const configured = process.env.REMOTE_MUSIC_BUFFER_SECONDS?.trim();
    const seconds = configured === undefined || configured === '' ? 3 : Number(configured);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 10) {
        throw new Error('REMOTE_MUSIC_BUFFER_SECONDS 必須介於 0 到 10 秒。');
    }
    const target = Math.ceil(seconds * PCM_BYTES_PER_SECOND);
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    return new Transform({
        readableHighWaterMark: Math.max(target, 16 * 1024),
        transform(chunk: Buffer, _encoding, callback) {
            if (pendingBytes < target) {
                pending.push(chunk);
                pendingBytes += chunk.length;
                if (pendingBytes >= target) {
                    this.push(Buffer.concat(pending, pendingBytes));
                    pending = [];
                }
            } else this.push(chunk);
            callback();
        },
        flush(callback) {
            if (pending.length) this.push(Buffer.concat(pending, pendingBytes));
            pending = [];
            callback();
        }
    });
}

export async function createRemoteStreamAudio(
    track: RemoteTrack, volume: number, onError: (error: Error) => void, loadController: AbortController
): Promise<AudioOutput> {
    const response = await openRemoteAudio(track.id, loadController);
    try { checkHeaders(response, track); }
    catch (error) { await response.body?.cancel(); throw error; }
    const executable = ffmpegPath as unknown as string | null;
    if (!executable) { await response.body?.cancel(); throw new Error('此平台沒有可用的 FFmpeg。'); }
    let buffered: Transform;
    try { buffered = decodedAudioBuffer(); }
    catch (error) { await response.body?.cancel(); throw error; }
    const child = spawn(executable, [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-protocol_whitelist', 'file,pipe', '-i', 'pipe:0',
        '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let disposed = false;
    let errorTail = '';
    child.stderr.on('data', data => { errorTail = (errorTail + String(data)).slice(-1000); });
    child.on('error', error => { if (!disposed) onError(error); });
    child.on('close', code => {
        if (!disposed && code !== 0) onError(new Error(`FFmpeg exited ${code}: ${errorTail}`));
    });
    child.stdout.pipe(buffered);
    const resource = createAudioResource(buffered, { inputType: StreamType.Raw, inlineVolume: true });
    resource.volume?.setVolume(volume / 100);
    void pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), meter(track, createHash('sha256')), child.stdin)
        .catch(error => { if (!disposed) onError(error instanceof Error ? error : new Error(String(error))); });
    return {
        resource,
        dispose() {
            if (disposed) return;
            disposed = true;
            loadController.abort();
            resource.playStream.destroy();
            child.stdout.unpipe(buffered); buffered.destroy();
            child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
            child.kill('SIGKILL');
        }
    };
}

export async function createRemoteDownloadedAudio(
    track: RemoteTrack, volume: number, onError: (error: Error) => void, loadController: AbortController
): Promise<AudioOutput> {
    const directory = resolve(process.env.REMOTE_MUSIC_CACHE_DIRECTORY?.trim() || 'data/remote-music-cache');
    await mkdir(directory, { recursive: true });
    const part = resolve(directory, `${randomUUID()}.part`);
    const complete = `${part}.audio`;
    try {
        const response = await openRemoteAudio(track.id, loadController);
        checkHeaders(response, track);
        await pipeline(
            Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
            meter(track, createHash('sha256')),
            createWriteStream(part, { flags: 'wx' }),
            { signal: loadController.signal }
        );
        if (loadController.signal.aborted) throw new Error('下載已取消。');
        await rename(part, complete);
        const audio = createLocalAudio(complete, volume, onError);
        return { resource: audio.resource, dispose() { audio.dispose(); void rm(complete, { force: true }); } };
    } catch (error) {
        loadController.abort();
        await Promise.all([rm(part, { force: true }), rm(complete, { force: true })]);
        throw error;
    }
}
