import 'dotenv/config';
import { startBot } from './app/bootstrap.js';
import logger from './shared/logging/logger.js';

void startBot().catch(error => { logger.error(error); process.exitCode = 1; });
