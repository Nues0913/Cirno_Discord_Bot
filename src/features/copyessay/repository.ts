import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CopyEssay } from './model.js';

/** One process owns this file; concurrent commands serialize read-modify-write operations. */
export class JsonEssayRepository {
    private writes: Promise<void> = Promise.resolve();
    private readonly path: string;
    constructor(path: string | URL) { this.path = typeof path === 'string' ? path : fileURLToPath(path); }

    private async read(): Promise<CopyEssay[]> {
        try { return JSON.parse(await readFile(this.path, 'utf8')) as CopyEssay[]; }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
    }
    async readAll(): Promise<CopyEssay[]> { await this.writes; return this.read(); }

    mutate<T>(update: (essays: CopyEssay[]) => T): Promise<T> {
        const result = this.writes.then(async () => {
            const essays = await this.read();
            const value = update(essays);
            await mkdir(dirname(this.path), { recursive: true });
            const temporary = `${this.path}.${randomUUID()}.tmp`;
            try {
                await writeFile(temporary, JSON.stringify(essays, null, 2), { encoding: 'utf8', flag: 'wx' });
                await rename(temporary, this.path);
            } finally { await rm(temporary, { force: true }); }
            return value;
        });
        this.writes = result.then(() => undefined, () => undefined);
        return result;
    }
}
