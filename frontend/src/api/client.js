// An empty VITE_API_URL means the same origin as the page (on AWS, CloudFront serves /api/*).
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// A 401 on a signed-in call means the sign-in ended (inactivity timeout or its maximum age).
const SESSION_ENDED = 'siit:session-ended';

export function onSessionEnded(handler) {
  window.addEventListener(SESSION_ENDED, handler);
  return () => window.removeEventListener(SESSION_ENDED, handler);
}

// Marks a timed background call (the bell's poll): it reads data but doesn't count as activity,
// so it doesn't extend the sign-in.
export const BACKGROUND = { headers: { 'X-Background': '1' } };

export class ApiError extends Error {
  constructor(message, status, details, body) {
    super(message);
    this.status = status;
    this.details = details;
    // The whole JSON error body, e.g. the overlapping requests in a 409 from approve.
    this.body = body;
  }
}

const UNAVAILABLE = 'The service is not available right now. Please try again in a few minutes.';

// The message shown for a failed call. The server's 4xx messages are written for the user; a 5xx
// (or a load balancer page that isn't JSON) only gets a general message plus the reference, which
// SIIT ICT can look up in the logs.
export function errorMessage(status, data) {
  if (status >= 500 || !data) {
    const base = status >= 500 && data?.message ? data.message : UNAVAILABLE;
    return data?.reference ? `${base} (reference ${data.reference})` : base;
  }
  return data.errors?.[0]?.message || data.message || `Request failed (${status})`;
}

async function send(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, credentials: 'include' });
  } catch {
    throw new ApiError(UNAVAILABLE, 0);
  }
  return response;
}

export async function apiRequest(path, options = {}) {
  return (await apiRequestWithTotal(path, options)).data;
}

// Also returns X-Total-Count from a paged list (null when absent).
export async function apiRequestWithTotal(path, options = {}) {
  const response = await send(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // /api/auth/me answers 401 for anyone not signed in; that is the normal signed-out state.
    if (response.status === 401 && path !== '/api/auth/me') window.dispatchEvent(new Event(SESSION_ENDED));
    throw new ApiError(errorMessage(response.status, data), response.status, data?.errors, data);
  }

  const total = response.headers.get('X-Total-Count');
  return { data, total: total === null ? null : Number(total) };
}

// A file download (e.g. the CSV export): the body as a Blob and the server's file name.
export async function apiDownload(path) {
  const response = await send(path);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_ENDED));
    throw new ApiError(errorMessage(response.status, data), response.status, data?.errors, data);
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'export.csv';
  return { blob: await response.blob(), name };
}
