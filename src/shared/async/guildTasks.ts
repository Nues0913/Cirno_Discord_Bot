// Serializes guild mutations without retaining completed guilds forever.
export class GuildTasks {
    private tasks = new Map<string, Promise<unknown>>();
    run<T>(guildId: string, task: () => Promise<T> | T): Promise<T> {
        const result = (this.tasks.get(guildId) ?? Promise.resolve()).catch(() => undefined).then(task);
        this.tasks.set(guildId, result);
        void result.finally(() => {
            if (this.tasks.get(guildId) === result) this.tasks.delete(guildId);
        }).catch(() => undefined);
        return result;
    }
}
