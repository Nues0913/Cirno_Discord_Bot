/** Expected rejection of a user's input or an operation on stale state. */
export class UserActionError extends Error {
    override name = 'UserActionError';
}

/** Configuration or permissions need an operator's attention. */
export class ConfigurationError extends Error {
    override name = 'ConfigurationError';
}
