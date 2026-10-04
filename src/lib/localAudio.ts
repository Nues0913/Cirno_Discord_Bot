import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { createAudioResource, StreamType } from '@discordjs/voice';

export function createLocalAudio(path: string, volume: number, onError: (error: Error) => void) {
    const executable = ffmpegPath as unknown as string | null;
    if (!executable) throw new Error('此平台沒有可用的 FFmpeg。');
    const child = spawn(executable, [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-protocol_whitelist', 'file,pipe', '-i', path,
        '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let disposed = false;
    let errorTail = '';
    child.stderr.on('data', data => { errorTail = (errorTail + String(data)).slice(-1000); });
    child.on('error', error => { if (!disposed) onError(error); });
    child.on('close', code => {
        if (!disposed && code !== 0) onError(new Error(`FFmpeg exited ${code}: ${errorTail}`));
    });
    const resource = createAudioResource(child.stdout, { inputType: StreamType.Raw, inlineVolume: true });
    resource.volume?.setVolume(volume / 100);
    return {
        resource,
        dispose() {
            if (disposed) return;
            disposed = true;
            resource.playStream.destroy();
            child.stdout.destroy(); child.stderr.destroy();
            child.kill('SIGKILL');
        }
    };
}
