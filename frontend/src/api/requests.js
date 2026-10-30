import { apiRequest } from './client.js';

export async function createRequest(data) {
  return apiRequest('/api/requests', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getMyRequests(options) {
  return apiRequest('/api/requests/me', options);
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

// FR-8.3: ask for a later end date on a request in use. -> the request.
export async function requestExtension(id, { end_date, reason }) {
  return apiRequest(`/api/requests/${id}/extension`, { method: 'POST', body: JSON.stringify({ end_date, reason }) });
}
