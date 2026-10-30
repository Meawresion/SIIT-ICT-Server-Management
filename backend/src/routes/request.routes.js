import { Router } from 'express';
import { requireUser } from '../middleware/auth.middleware.js';
import {
  createNewRequest,
  getMyRequests,
  getRequest,
  updateRequestHandler,
  requestExtensionHandler,
} from '../controllers/request.controller.js';

const router = Router();

router.post('/', requireUser, createNewRequest);
router.get('/me', requireUser, getMyRequests);
router.get('/:id', requireUser, getRequest);
router.patch('/:id', requireUser, updateRequestHandler);
router.post('/:id/extension', requireUser, requestExtensionHandler);

export default router;
