import { apiRequest } from './client.js';

export async function getGoogleAuthUrl() {
  const data = await apiRequest('/api/auth/google');
  return data.auth_url;
}

export async function getCurrentUser() {
  try {
    return await apiRequest('/api/auth/me');
  } catch (err) {
    return null;
  }
}

export async function logout() {
  return apiRequest('/api/auth/logout', { method: 'POST' });
}
