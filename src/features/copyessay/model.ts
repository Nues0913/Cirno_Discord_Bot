export interface CopyEssay {
    id: number;
    title: string;
    content: string;
    created_at: string;
}

export interface SearchResult {
    essay: CopyEssay;
    score: number;
}
