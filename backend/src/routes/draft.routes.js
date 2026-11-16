import { Router } from 'express';
import { requireUser } from '../middleware/auth.middleware.js';
import { createDraftHandler, deleteDraftHandler, getMyDrafts, updateDraftHandler } from '../controllers/draft.controller.js';

const router = Router();

router.get('/', requireUser, getMyDrafts);
router.post('/', requireUser, createDraftHandler);
router.put('/:id', requireUser, updateDraftHandler);
router.delete('/:id', requireUser, deleteDraftHandler);

export default router;
