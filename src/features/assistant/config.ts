import type { NvidiaNimErrorResponse } from './model.js';

export function getPositiveInteger(value: string | undefined, fallback: number): number {
    const configuredValue = Number.parseInt(value ?? '', 10);
    return Number.isInteger(configuredValue) && configuredValue > 0
        ? configuredValue
        : fallback;
}

export function getErrorMessage(data: NvidiaNimErrorResponse | undefined): string {
    return data?.error?.message ?? data?.detail ?? 'Unknown error';
}

export function needsWebSearch(prompt: string): boolean {
    const mode = process.env.WEB_SEARCH_MODE ?? 'auto';
    if (mode === 'always') {
        return true;
    }
    if (mode === 'off') {
        return false;
    }

    return /(https:\/\/|搜尋|搜索|查詢|查一下|上網|聯網|最新|今天|今日|目前|現在|近期|新聞|即時|價格|股價|匯率|天氣|氣象|比分|賽程|排名|現任|總統|首相|執行長|CEO|版本|更新|法規|法律|規定|search|look\s*up|browse|latest|today|current|recent|news|price|weather|score|schedule|president|prime minister|CEO|version|release)/iu.test(prompt);
}
