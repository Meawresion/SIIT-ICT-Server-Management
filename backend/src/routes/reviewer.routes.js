import { Router } from 'express';
import { requireReviewer } from '../middleware/auth.middleware.js';
import {
  listRequests,
  getRequestDetail,
  approveRequestHandler,
  rejectRequestHandler,
  activateRequestHandler,
  completeRequestHandler,
} from '../controllers/reviewer.controller.js';

const router = Router();

router.get('/requests', requireReviewer, listRequests);
router.get('/requests/:id', requireReviewer, getRequestDetail);
router.patch('/requests/:id/approve', requireReviewer, approveRequestHandler);
router.patch('/requests/:id/reject', requireReviewer, rejectRequestHandler);
router.patch('/requests/:id/activate', requireReviewer, activateRequestHandler);
router.patch('/requests/:id/complete', requireReviewer, completeRequestHandler);

export default router;
