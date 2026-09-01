import { apiRequest } from './client.js';

export async function getRequests(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.resource_type) params.append('resource_type', filters.resource_type);
  if (filters.student_id) params.append('student_id', filters.student_id);

  const query = params.toString();
  const url = query ? `/api/reviewer/requests?${query}` : '/api/reviewer/requests';
  
  return apiRequest(url);
}

export async function getRequest(id) {
  return apiRequest(`/api/reviewer/requests/${id}`);
}

export async function approveRequest(id, review_comment) {
  return apiRequest(`/api/reviewer/requests/${id}/approve`, {
    method: 'PATCH',
    body: JSON.stringify({ review_comment }),
  });
}

export async function rejectRequest(id, review_comment) {
  return apiRequest(`/api/reviewer/requests/${id}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ review_comment }),
  });
}

export async function activateRequest(id) {
  return apiRequest(`/api/reviewer/requests/${id}/activate`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
}

export async function completeRequest(id) {
  return apiRequest(`/api/reviewer/requests/${id}/complete`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
}
