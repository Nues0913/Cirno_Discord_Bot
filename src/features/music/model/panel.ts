import type { MusicQueue } from './queue.js';
import type { Message } from 'discord.js';

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
export interface SessionPanel {
    message?: Message;
    attach(message: Message): void;
    update(immediate?: boolean): void;
}
