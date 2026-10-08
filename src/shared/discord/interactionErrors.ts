import logger from '../logging/logger.js';

/** These callback failures cannot be recovered with another initial response. */
export function isInteractionResponseUnavailable(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 10062 || code === 40060;
}

export function logInteractionError(error: unknown): void {
    if (!isInteractionResponseUnavailable(error)) { logger.error(error); return; }
    // DiscordAPIError.url contains the interaction token. Log only the useful diagnosis.
    const code = (error as { code: number }).code;
    logger.warn(code === 10062
        ? 'Discord interaction unavailable (10062); check response latency and duplicate Bot instances.'
        : 'Discord interaction already acknowledged (40060); check duplicate handlers or Bot instances.');
}
