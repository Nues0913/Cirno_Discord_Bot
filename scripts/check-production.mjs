import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repository = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'cirno-production-check-'));
try {
    for (const file of ['package.json', 'package-lock.json']) await copyFile(join(repository, file), join(temporary, file));
    await mkdir(join(temporary, 'dist/shared/logging'), { recursive: true });
    await copyFile(join(repository, 'dist/shared/logging/logger.js'), join(temporary, 'dist/shared/logging/logger.js'));
    // No FFmpeg download is needed for this runtime dependency resolution check.
    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--cache', join(temporary, 'npm-cache')], { cwd: temporary, stdio: 'pipe' });
    execFileSync(process.execPath, ['dist/shared/logging/logger.js'], { cwd: temporary, stdio: 'pipe' });
    console.log('PASS: production-only installation resolves the runtime logger.');
} finally { await rm(temporary, { recursive: true, force: true }); }
