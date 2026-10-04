import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, '../../data/copyessay.json');

export interface CopyEssay {
    id: number;
    title: string;
    content: string;
    created_at: string;
}

async function readAll(): Promise<CopyEssay[]> {
    if (!existsSync(DATA_PATH)) return [];
    const raw = await readFile(DATA_PATH, 'utf-8');
    return JSON.parse(raw) as CopyEssay[];
}

async function writeAll(essays: CopyEssay[]): Promise<void> {
    await mkdir(path.dirname(DATA_PATH), { recursive: true });
    await writeFile(DATA_PATH, JSON.stringify(essays, null, 2), 'utf-8');
}

export async function getAll(): Promise<CopyEssay[]> {
    return readAll();
}

export async function getRandom(): Promise<CopyEssay | null> {
    const essays = await readAll();
    if (essays.length === 0) return null;
    return essays[Math.floor(Math.random() * essays.length)];
}

export async function add(title: string, content: string): Promise<CopyEssay> {
    const essays = await readAll();
    const id = essays.length > 0 ? Math.max(...essays.map(e => e.id)) + 1 : 1;
    const entry: CopyEssay = { id, title, content, created_at: new Date().toISOString() };
    essays.push(entry);
    await writeAll(essays);
    return entry;
}

export async function remove(id: number): Promise<boolean> {
    const essays = await readAll();
    const idx = essays.findIndex(e => e.id === id);
    if (idx === -1) return false;
    essays.splice(idx, 1);
    await writeAll(essays);
    return true;
}

export async function count(): Promise<number> {
    return (await readAll()).length;
}

function scoreEssay(essay: CopyEssay, query: string): { score: number; qualifies: boolean } {
    const q = query.toLowerCase().replace(/\s/g, '');
    const title = essay.title.toLowerCase();
    const content = essay.content.toLowerCase();
    let score = 0;
    let hasNgram = false;
    let distinctMatches = 0;

    for (const ch of new Set(q)) {
        const inTitle = title.includes(ch);
        const inContent = content.includes(ch);
        if (inTitle || inContent) {
            distinctMatches++;
            if (inTitle) score += 3;
            if (inContent) score += content.split(ch).length - 1;
        }
    }

    for (let i = 0; i < q.length - 1; i++) {
        for (const len of [2, 3]) {
            if (i + len > q.length) continue;
            const gram = q.slice(i, i + len);
            const w = len === 2 ? [5, 2] : [8, 3];
            if (title.includes(gram)) { score += w[0]; hasNgram = true; }
            else if (content.includes(gram)) { score += w[1]; hasNgram = true; }
        }
    }

    return { score, qualifies: hasNgram || distinctMatches >= 2 };
}

export async function getById(id: number): Promise<CopyEssay | null> {
    const essays = await readAll();
    return essays.find(e => e.id === id) ?? null;
}

export interface SearchResult {
    essay: CopyEssay;
    score: number;
}

export async function search(query: string): Promise<SearchResult[]> {
    const essays = await readAll();
    const results: SearchResult[] = essays
        .map(essay => { const d = scoreEssay(essay, query); return { essay, score: d.score, qualifies: d.qualifies }; })
        .filter(r => r.score > 0 && r.qualifies)
        .sort((a, b) => b.score - a.score);
    return results;
}
