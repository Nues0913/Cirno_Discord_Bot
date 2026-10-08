import logger from '../logging/logger.js';
import { logOperationError } from '../logging/logOperationError.js';

/** These callback failures cannot be recovered with another initial response. */
export function isInteractionResponseUnavailable(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 10062 || code === 40060;
}

export function logInteractionError(error: unknown): void {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'CommandInteractionOptionNotFound') {
        logger.info('指令選項尚未填寫，或 Discord 指令選項已更新；請重新選擇後操作。');
        return;
    }
    if (code === 50001 || code === 50013) {
        logger.warn(`Discord 權限不足（${code}），請檢查 Bot 的頻道存取與操作權限。`);
        return;
    }
    if (code === 10008) {
        logger.info('Discord 訊息已刪除（10008），請重新開啟面板。');
        return;
    }
    if (!isInteractionResponseUnavailable(error)) { logOperationError(error); return; }
    // DiscordAPIError.url contains the interaction token. Log only the useful diagnosis.
    logger.warn(code === 10062
        ? 'Discord interaction unavailable (10062); check response latency and duplicate Bot instances.'
        : 'Discord interaction already acknowledged (40060); check duplicate handlers or Bot instances.');
}
