import type { CopyEssay, SearchResult } from './model.js';

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

export function searchEssays(essays: CopyEssay[], query: string): SearchResult[] {
    const results: SearchResult[] = essays
        .map(essay => { const d = scoreEssay(essay, query); return { essay, score: d.score, qualifies: d.qualifies }; })
        .filter(r => r.score > 0 && r.qualifies)
        .sort((a, b) => b.score - a.score);
    return results;
}
