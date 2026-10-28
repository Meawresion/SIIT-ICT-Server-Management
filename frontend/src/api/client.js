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

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // /api/auth/me answers 401 for anyone not signed in; that is the normal signed-out state.
    if (response.status === 401 && path !== '/api/auth/me') window.dispatchEvent(new Event(SESSION_ENDED));
    const detail = data?.errors?.[0]?.message;
    throw new ApiError(
      detail || data?.message || `API request failed: ${response.status}`,
      response.status,
      data?.errors,
      data,
    );
  }

  return data;
}

// A file download (e.g. the CSV export): the body as a Blob and the server's file name.
export async function apiDownload(path) {
  const response = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_ENDED));
    throw new ApiError(data?.message || `Download failed: ${response.status}`, response.status, data?.errors, data);
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'export.csv';
  return { blob: await response.blob(), name };
}
