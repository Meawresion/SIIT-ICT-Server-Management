// Error types the worker uses to decide what happens to a message.

// The message itself is invalid or untrusted (bad envelope, bad signature). The transport rejects
// it, so the broker dead-letters it without retrying.
export class PoisonMessageError extends Error {}

// The job is authentic but can never succeed as sent (unsupported resource, bad payload,
// identity mismatch). The worker reports a failed result at once instead of retrying.
export class JobRejectedError extends Error {}
