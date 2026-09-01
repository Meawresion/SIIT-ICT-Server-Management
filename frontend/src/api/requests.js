import { apiRequest } from './client.js';

export async function createRequest(data) {
  return apiRequest('/api/requests', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getMyRequests() {
  return apiRequest('/api/requests/me');
}

export async function getRequest(id) {
  return apiRequest(`/api/requests/${id}`);
}

export async function updateRequest(id, data) {
  return apiRequest(`/api/requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
