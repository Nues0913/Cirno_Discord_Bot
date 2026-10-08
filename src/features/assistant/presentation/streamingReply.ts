import type { Message } from 'discord.js';
import { splitDiscordMessage } from '../../../shared/discord/messages.js';
import { logInteractionError } from '../../../shared/discord/interactionErrors.js';

export class StreamingReply {
    private latestAnswer = '';
    private lastEditAt = 0;
    private lastRenderedAnswer = '';
    private edits = Promise.resolve();
    constructor(private readonly source: Message, private readonly response: Message) {}
    update = (content: string): void => {
        this.latestAnswer = content;
        const now = Date.now();
        if (now - this.lastEditAt < 1250) return;
        this.lastEditAt = now;
        this.edits = this.edits.then(async () => {
            const preview = this.latestAnswer.length > 2000 ? `${this.latestAnswer.slice(0, 1997)}...` : this.latestAnswer;
            if (!preview || preview === this.lastRenderedAnswer) return;
            await this.response.edit({ content: preview, allowedMentions: { parse: [] } });
            this.lastRenderedAnswer = preview;
        }).catch(logInteractionError);
    };
    async complete(answer: string): Promise<void> {
        await this.edits;
        const chunks = splitDiscordMessage(answer);
        await this.response.edit({ content: chunks[0], allowedMentions: { parse: [] } });
        const channel = this.source.channel;
        if (!channel.isSendable()) return;
        for (const content of chunks.slice(1)) await channel.send({ content, allowedMentions: { parse: [] } });
    }
    async fail(): Promise<void> {
        await this.edits;
        const notice = '\n\n⚠️ 回覆中斷，請稍後再試。';
        const content = this.latestAnswer ? `${this.latestAnswer.slice(0, 2000 - notice.length).trimEnd()}${notice}`
            : '目前無法取得 AI 回覆，請稍後再試。';
        await this.response.edit({ content, allowedMentions: { parse: [] } });
    }
}
