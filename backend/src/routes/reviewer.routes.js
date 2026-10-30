import { Router } from 'express';
import { requireReviewer } from '../middleware/auth.middleware.js';
import {
  listRequests,
  getRequestDetail,
  approveRequestHandler,
  rejectRequestHandler,
  activateRequestHandler,
  completeRequestHandler,
  retryProvisioningHandler,
  exportHandler,
  approveExtensionHandler,
  rejectExtensionHandler,
} from '../controllers/reviewer.controller.js';

const router = Router();

router.get('/requests', requireReviewer, listRequests);
router.get('/export', requireReviewer, exportHandler);
router.get('/requests/:id', requireReviewer, getRequestDetail);
router.patch('/requests/:id/approve', requireReviewer, approveRequestHandler);
router.patch('/requests/:id/reject', requireReviewer, rejectRequestHandler);
router.patch('/requests/:id/activate', requireReviewer, activateRequestHandler);
router.patch('/requests/:id/complete', requireReviewer, completeRequestHandler);
router.post('/requests/:id/provision/retry', requireReviewer, retryProvisioningHandler);
router.patch('/requests/:id/extension/approve', requireReviewer, approveExtensionHandler);
router.patch('/requests/:id/extension/reject', requireReviewer, rejectExtensionHandler);

export default router;
