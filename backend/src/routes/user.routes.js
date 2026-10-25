import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  getUserProfile,
  createProfile,
  updateProfile,
} from '../controllers/user.controller.js';

const router = Router();

router.get('/me', requireAuth, getUserProfile);
router.post('/me', requireAuth, createProfile);
// Students need a completed profile (checked in the controller); approvers edit name and phone.
router.patch('/me', requireAuth, updateProfile);

export default router;
