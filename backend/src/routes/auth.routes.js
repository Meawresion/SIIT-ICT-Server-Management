import { Router } from 'express';
import {
  initiateGoogleAuth,
  handleGoogleCallback,
  getCurrentUser,
  logout,
} from '../controllers/auth.controller.js';

const router = Router();

router.get('/google', initiateGoogleAuth);
router.get('/google/callback', handleGoogleCallback);
router.get('/me', getCurrentUser);
router.post('/logout', logout);

export default router;
