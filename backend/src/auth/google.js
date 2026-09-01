import { OAuth2Client } from 'google-auth-library';
import env from '../config/env.js';

const oauth_client = new OAuth2Client(
  env.google_client_id,
  env.google_client_secret,
  env.google_callback_url
);

export function getGoogleAuthUrl(state) {
  const scopes = [
    'openid',
    'email',
    'profile',
  ];

  return oauth_client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state,
  });
}

export async function exchangeCodeForToken(code) {
  const { tokens } = await oauth_client.getToken(code);
  return tokens;
}

export async function verifyIdToken(id_token) {
  const ticket = await oauth_client.verifyIdToken({
    idToken: id_token,
    audience: env.google_client_id,
  });

  const payload = ticket.getPayload();

  // Validate token claims
  if (payload.iss !== 'https://accounts.google.com') {
    throw new Error('Invalid token issuer');
  }

  if (!payload.email_verified) {
    throw new Error('Email not verified');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    email_verified: payload.email_verified,
  };
}

export { oauth_client };
