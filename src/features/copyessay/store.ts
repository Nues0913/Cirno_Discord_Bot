import type { CopyEssay, SearchResult } from './model.js';
import { JsonEssayRepository } from './repository.js';
import { searchEssays } from './search.js';
export type { CopyEssay, SearchResult } from './model.js';

const repository = new JsonEssayRepository(new URL('../../../data/copyessay.json', import.meta.url));

export async function getAll(): Promise<CopyEssay[]> {
    return repository.readAll();
}

export async function getRandom(): Promise<CopyEssay | null> {
    const essays = await repository.readAll();
    if (essays.length === 0) return null;
    return essays[Math.floor(Math.random() * essays.length)];
}

export async function add(title: string, content: string): Promise<CopyEssay> {
    return repository.mutate(essays => {
        const id = essays.length > 0 ? Math.max(...essays.map(e => e.id)) + 1 : 1;
        const entry: CopyEssay = { id, title, content, created_at: new Date().toISOString() };
        essays.push(entry);
        return entry;
    });
}

export async function remove(id: number): Promise<boolean> {
    return repository.mutate(essays => {
        const idx = essays.findIndex(e => e.id === id);
        if (idx === -1) return false;
        essays.splice(idx, 1);
        return true;
    });
}

export async function count(): Promise<number> {
    return (await repository.readAll()).length;
}

export async function getById(id: number): Promise<CopyEssay | null> {
    const essays = await repository.readAll();
    return essays.find(e => e.id === id) ?? null;
}

export async function search(query: string): Promise<SearchResult[]> {
    return searchEssays(await repository.readAll(), query);
}
