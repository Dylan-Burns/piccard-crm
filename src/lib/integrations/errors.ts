/** How an integration call failed, which decides what the outbox worker does next (spec §6.1). */

/** The connection itself is broken (revoked, expired): hold the queue and tell an admin. */
export class ConnectionError extends Error {}
/** Worth trying again later (rate limit, server error, network). */
export class RetryableError extends Error {}
/** Will not fix itself (a validation error): fail now and show the message. */
export class FatalError extends Error {}
