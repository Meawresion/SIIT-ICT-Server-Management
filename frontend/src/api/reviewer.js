import { apiRequest } from './client.js';

export async function getRequests(filters = {}, options) {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.resource_type) params.append('resource_type', filters.resource_type);
  if (filters.student_id) params.append('student_id', filters.student_id);

  const query = params.toString();
  const url = query ? `/api/reviewer/requests?${query}` : '/api/reviewer/requests';
  
  return apiRequest(url, options);
}

export async function getRequest(id) {
  return apiRequest(`/api/reviewer/requests/${id}`);
}

// confirm_overlap: the approver saw the student's overlapping requests (D28). Without it the API
// answers 409 with the list when there are any.
export async function approveRequest(id, review_comment, confirm_overlap = false) {
  return apiRequest(`/api/reviewer/requests/${id}/approve`, {
    method: 'PATCH',
    body: JSON.stringify({ review_comment, ...(confirm_overlap && { confirm_overlap: true }) }),
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

// D4: after a failed setup or removal, queue a new job.
export async function retryProvisioning(id) {
  return apiRequest(`/api/reviewer/requests/${id}/provision/retry`, { method: 'POST', body: JSON.stringify({}) });
}
