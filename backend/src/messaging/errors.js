// The message itself is invalid or untrusted (bad envelope, bad signature). The transport does
// not retry it: the broker dead-letters it.
export class PoisonMessageError extends Error {}
