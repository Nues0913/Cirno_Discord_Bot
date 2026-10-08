export function splitDiscordMessage(content: string, maxLength = 2000): string[] {
    const chunks: string[] = [];
    let remaining = content.trim();

    while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf('\n', maxLength);
        if (splitAt < maxLength / 2) {
            splitAt = remaining.lastIndexOf(' ', maxLength);
        }
        if (splitAt < maxLength / 2) {
            splitAt = maxLength;
        }

        chunks.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining) {
        chunks.push(remaining);
    }

    return chunks;
}
