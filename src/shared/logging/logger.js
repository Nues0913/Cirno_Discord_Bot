import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDir = path.join(__dirname, '../../../logs');
const rootDir = path.resolve(__dirname, '../../..');

if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// 獲取呼叫者的檔案名稱
function getCallerFile() {
    const originalFunc = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;

    const err = new Error();
    const stack = err.stack;
    Error.prepareStackTrace = originalFunc;

    const callerFile = stack[2]?.getFileName();
    if (!callerFile) return 'unknown';

    if (callerFile.startsWith('file://')) {
        const filePath = fileURLToPath(callerFile);
        if (filePath.startsWith(rootDir)) {
            return "./" + filePath.substring(rootDir.length + 1);
        }
    } else if (callerFile.startsWith(rootDir)) {
        return "./" + callerFile.substring(rootDir.length + 1);
    }

    return path.basename(callerFile);
}

// 定義日誌格式
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, module, stack, ...metadata }) => {
        let msg = `${timestamp} [${level}] ${message}`;
        if (stack) {
            msg += `\n${stack}`;
        }
        if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
        }
        return msg;
    })
);

// 控制台格式
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp, module, stack, ...metadata }) => {
        let msg = `${timestamp} [${level}] ${message}`;
        if (stack) {
            msg += `\n${stack}`;   // ✅ 也輸出到 console
        }
        if (Object.keys(metadata).length > 0) {
            msg += `\n${JSON.stringify(metadata, null, 2)}`;
        }
        return msg;
    })
);

const baseLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        new winston.transports.Console({
            format: consoleFormat,
            level: process.env.LOG_LEVEL || 'debug'
        }),
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            level: process.env.LOG_LEVEL || 'info',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
});

const logger = new Proxy(baseLogger, {
    get(target, prop) {
        if (typeof target[prop] === 'function') {
            return (...args) => {
                const module = getCallerFile();

                // case 1: (Error)
                if (args[0] instanceof Error) {
                    const err = args[0];
                    const wrappedErr = Object.assign(new Error(), err);
                    wrappedErr.name = err.name;
                    wrappedErr.stack = err.stack;
                    wrappedErr.message = `[${module}] ${err.message}`;
                    return target[prop](wrappedErr);
                }

                // case 2: (message, Error)
                if (typeof args[0] === 'string' && args[1] instanceof Error) {
                    const err = args[1];
                    const wrappedErr = Object.assign(new Error(), err);
                    wrappedErr.name = err.name;
                    wrappedErr.stack = err.stack;
                    wrappedErr.message = `[${module}] ${args[0]}: ${err.message}`;
                    return target[prop](wrappedErr);
                }

                // case 3: (message, object)
                if (typeof args[0] === 'string') {
                    args[0] = `[${module}] ${args[0]}`;
                } else if (typeof args[0] === 'object' && args[0] !== null) {
                    args[0].module = module;
                }
                return target[prop](...args);
            };
        }
        return target[prop];
    }
});

export default logger;
