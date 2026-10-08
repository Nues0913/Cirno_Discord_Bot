import { ConfigurationError } from '../../../shared/logging/operationErrors.js';
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
import { openRemoteAudio, type RemoteTrack } from '../library/remoteLibrary.js';

type AudioOutput = ReturnType<typeof createLocalAudio>;

function checkHeaders(response: Response, track: RemoteTrack): void {
    const type = response.headers.get('content-type')?.split(';')[0]?.trim();
    if (type && !type.startsWith('audio/') && type !== 'video/webm' && type !== 'application/ogg' && type !== 'application/octet-stream') {
        throw new Error('遠端服務未回傳音檔。');
    }
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== track.byteSize) throw new Error('遠端音檔大小與曲庫資料不一致。');
}

function meter(track: RemoteTrack, hash?: ReturnType<typeof createHash>, onProgress?: (bytes: number) => void): Transform {
    let bytes = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length;
            if (chunk.length) onProgress?.(bytes);
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
        throw new ConfigurationError('REMOTE_MUSIC_BUFFER_SECONDS 必須介於 0 到 10 秒。');
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
    track: RemoteTrack, volume: number, onError: (error: Error) => void, loadController: AbortController, offset = 0
): Promise<AudioOutput> {
    // MP4 containers may store their index at EOF and require a seekable input.
    // Download and verify M4A even in stream mode, rather than silently decoding no audio.
    if (['audio/mp4', 'audio/x-m4a', 'audio/m4a'].includes(track.mimeType.split(';')[0].trim().toLowerCase())) {
        return createRemoteDownloadedAudio(track, volume, onError, loadController, offset);
    }
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
        '-protocol_whitelist', 'file,pipe', '-i', 'pipe:0', '-ss', String(offset),
        '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let disposed = false;
    let reportedError = false;
    let receivedBytes = 0;
    const reportError = (error: Error) => {
        if (disposed || reportedError) return;
        reportedError = true;
        onError(error);
    };
    let errorTail = '';
    child.stderr.on('data', data => { errorTail = (errorTail + String(data)).slice(-1000); });
    child.on('error', reportError);
    child.on('close', code => {
        if (code !== 0) reportError(new Error(`FFmpeg exited ${code}: ${errorTail}`));
    });
    child.stdout.pipe(buffered);
    const resource = createAudioResource(buffered, { inputType: StreamType.Raw, inlineVolume: true });
    resource.volume?.setVolume(volume / 100);
    void pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        meter(track, createHash('sha256'), bytes => { receivedBytes = bytes; }), child.stdin)
        .catch(error => {
            const failure = error instanceof Error ? error : new Error(String(error));
            const causeCode = (failure.cause as { code?: unknown } | undefined)?.code
                ?? (failure as Error & { code?: unknown }).code;
            const code = typeof causeCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(causeCode) ? `；${causeCode}` : '';
            reportError(new Error(`遠端音檔串流失敗（歌曲 ${track.id}；已接收 ${receivedBytes}/${track.byteSize} bytes${code}）：${failure.message}`, { cause: failure }));
        });
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
    track: RemoteTrack, volume: number, onError: (error: Error) => void, loadController: AbortController, offset = 0
): Promise<AudioOutput> {
    const directory = resolve(process.env.REMOTE_MUSIC_CACHE_DIRECTORY?.trim() || 'data/remote-music-cache');
    await mkdir(directory, { recursive: true });
    const part = resolve(directory, `${randomUUID()}.part`);
    const complete = `${part}.audio`;
    const timeoutError = new Error('遠端音檔下載逾時（15 秒沒有接收資料）。');
    let idleTimer: NodeJS.Timeout | undefined;
    const progress = () => {
        if (idleTimer) idleTimer.refresh();
        else idleTimer = setTimeout(() => loadController.abort(timeoutError), 15_000).unref();
    };
    try {
        const response = await openRemoteAudio(track.id, loadController);
        checkHeaders(response, track);
        progress();
        await pipeline(
            Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
            meter(track, createHash('sha256'), progress),
            createWriteStream(part, { flags: 'wx' }),
            { signal: loadController.signal }
        );
        clearTimeout(idleTimer); idleTimer = undefined;
        if (loadController.signal.aborted) throw new Error('下載已取消。');
        await rename(part, complete);
        const audio = createLocalAudio(complete, volume, onError, offset);
        return { resource: audio.resource, dispose() { audio.dispose(); void rm(complete, { force: true }); } };
    } catch (error) {
        loadController.abort();
        await Promise.all([rm(part, { force: true }), rm(complete, { force: true })]);
        throw loadController.signal.reason === timeoutError ? timeoutError : error;
    } finally { clearTimeout(idleTimer); }
}
