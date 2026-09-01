import { apiRequest } from './client.js';

export async function getUserProfile() {
  return apiRequest('/api/users/me');
}

export async function createUserProfile(data) {
  return apiRequest('/api/users/me', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateUserProfile(data) {
  return apiRequest('/api/users/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
