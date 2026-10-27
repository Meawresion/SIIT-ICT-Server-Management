// An empty VITE_API_URL means the same origin as the page (on AWS, CloudFront serves /api/*).
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
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
    const detail = data?.errors?.[0]?.message;
    throw new ApiError(
      detail || data?.message || `API request failed: ${response.status}`,
      response.status,
      data?.errors,
    );
  }

  return data;
}
