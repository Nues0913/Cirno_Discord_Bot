import { musicLibrary, searchRemoteSongs, selectedMusicSource } from '../../music/api.js';
import type { AutocompleteInteraction } from 'discord.js';
import { playlists } from '../store.js';
import { isInteractionResponseUnavailable, logInteractionError } from '../../../shared/discord/interactionErrors.js';

export async function completePlaylist(interaction: AutocompleteInteraction): Promise<void> {
    try {
        const focus = interaction.options.getFocused(true);
        const query = String(focus.value).toLocaleLowerCase();
        if (focus.name === 'playlist') {
            const all = await playlists.list(interaction.user.id);
            await interaction.respond(all.filter(p => p.name.toLocaleLowerCase().includes(query)).slice(0, 25).map(p => ({ name: `${p.name} · ${p.entries.length} 首`, value: p.id })));
        } else if (focus.name === 'entry') {
            const p = await playlists.get(interaction.user.id, interaction.options.getString('playlist', true));
            await interaction.respond(p.entries.map((e, i) => ({ name: `${i + 1}. ${e.title} · ${e.source === 'remote' ? '遠端' : '本地'}`.slice(0, 100), value: e.entryId }))
                .filter(e => e.name.toLocaleLowerCase().includes(query)).slice(0, 25));
        } else if (focus.name === 'song') {
            const source = selectedMusicSource(interaction.options.getString('source'));
            if (source === 'local') await musicLibrary.load();
            const tracks = source === 'remote'
                ? (await searchRemoteSongs(query, undefined, 25, 2000)).items : musicLibrary.search(query).slice(0, 25);
            await interaction.respond(tracks.map(t => ({ name: `${t.title.slice(0, 65)} · ${t.artist?.slice(0, 20) ?? ''} · ${t.id.slice(0, 5)}`, value: t.id })));
        } else await interaction.respond([]);
    } catch (error) {
        logInteractionError(error);
        if (!isInteractionResponseUnavailable(error) && !interaction.responded) await interaction.respond([]);
    }
}
