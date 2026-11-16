// Drafts (FR-3.2, FR-3.3) are kept on the server with the student's account, so they follow the
// student to another device. A draft: { id, data: the request form's fields, updated_at }.
import { apiRequest } from './client.js';

// Only the filled-in fields; the server checks them with the same limits as a request.
function cleanForm(form) {
  const data = { ...form };
  if (data.impact_score === '' || data.impact_score === null || data.impact_score === undefined) delete data.impact_score;
  else data.impact_score = Number(data.impact_score);
  return data;
}

// Newest first.
export async function listDrafts() {
  return apiRequest('/api/drafts');
}

// A new draft, or an update of draftId. -> the saved draft.
export async function saveDraft(form, draftId = null) {
  const body = JSON.stringify({ data: cleanForm(form) });
  return draftId
    ? apiRequest(`/api/drafts/${draftId}`, { method: 'PUT', body })
    : apiRequest('/api/drafts', { method: 'POST', body });
}

export async function deleteDraft(draftId) {
  await apiRequest(`/api/drafts/${draftId}`, { method: 'DELETE' });
}
