import { parseId } from '../utils/db-mapping.js';
import { createDraft, deleteDraft, listDrafts, updateDraft } from '../services/draft.service.js';
import { DraftSchema } from '../utils/validation.js';

function parseDraft(req, res) {
  const validation = DraftSchema.safeParse(req.body?.data ?? {});
  if (!validation.success) {
    res.status(400).json({ message: 'Validation error', errors: validation.error.errors });
    return null;
  }
  return validation.data;
}

export async function getMyDrafts(req, res, next) {
  try {
    res.json(await listDrafts(req.auth.user_id));
  } catch (err) {
    next(err);
  }
}

export async function createDraftHandler(req, res, next) {
  try {
    const data = parseDraft(req, res);
    if (data) res.status(201).json(await createDraft(req.auth.user_id, data));
  } catch (err) {
    next(err);
  }
}

export async function updateDraftHandler(req, res, next) {
  try {
    const did = parseId(req.params.id);
    const data = parseDraft(req, res);
    if (data) res.json(await updateDraft(req.auth.user_id, did, data));
  } catch (err) {
    next(err);
  }
}

export async function deleteDraftHandler(req, res, next) {
  try {
    await deleteDraft(req.auth.user_id, parseId(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
