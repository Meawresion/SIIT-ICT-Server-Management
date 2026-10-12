// Drafts are kept in the browser only: the backend has no draft endpoint yet.
// Each account gets its own list, keyed by account_id.

const key = (accountId) => `siit-drafts-${accountId}`;

function read(accountId) {
  try {
    return JSON.parse(localStorage.getItem(key(accountId))) || [];
  } catch {
    return [];
  }
}

function write(accountId, drafts) {
  try {
    localStorage.setItem(key(accountId), JSON.stringify(drafts));
  } catch {
    // Storage unavailable (private mode); drafts simply won't persist.
  }
}

export function listDrafts(accountId) {
  return read(accountId).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function saveDraft(accountId, data, draftId = null) {
  const drafts = read(accountId);
  const now = new Date().toISOString();
  if (draftId) {
    const existing = drafts.find((d) => d.id === draftId);
    if (existing) {
      existing.data = data;
      existing.updated_at = now;
      write(accountId, drafts);
      return existing;
    }
  }
  const draft = { id: `D${Date.now().toString().slice(-6)}`, data, updated_at: now };
  drafts.push(draft);
  write(accountId, drafts);
  return draft;
}

export function deleteDraft(accountId, draftId) {
  write(accountId, read(accountId).filter((d) => d.id !== draftId));
}
