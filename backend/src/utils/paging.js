// Paging for the request lists (NFR-2.1): ?limit=&offset=, newest first. Without them a list returns
// the newest DEFAULT_LIMIT rows. The answer stays a plain array; X-Total-Count gives the total.
export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

// -> { take, skip }
export function parsePage(query = {}) {
  const int = (value, name, min, max) => {
    if (value === undefined || value === '') return undefined;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${name} must be a whole number from ${min} to ${max}`);
    return n;
  };
  return { take: int(query.limit, 'limit', 1, MAX_LIMIT) ?? DEFAULT_LIMIT, skip: int(query.offset, 'offset', 0, 1_000_000) ?? 0 };
}
