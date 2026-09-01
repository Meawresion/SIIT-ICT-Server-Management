import { Router } from 'express';
import { requireAuth, requireUser } from '../middleware/auth.middleware.js';
import {
  getUserProfile,
  createProfile,
  updateProfile,
} from '../controllers/user.controller.js';

const router = Router();

router.get('/me', requireAuth, getUserProfile);
router.post('/me', requireAuth, createProfile);
router.patch('/me', requireUser, updateProfile);

export default router;
