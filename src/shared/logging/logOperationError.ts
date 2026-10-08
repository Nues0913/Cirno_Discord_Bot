import logger from './logger.js';
import { UserActionError, ConfigurationError } from './operationErrors.js';

/** Unclassified failures remain ERROR; never infer severity from message text. */
export function logOperationError(error: unknown): void {
    if (error instanceof UserActionError) logger.info(error.message);
    else if (error instanceof ConfigurationError) logger.warn(error.message);
    else logger.error(error);
}
