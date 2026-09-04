import dotenv from 'dotenv';
dotenv.config();

// console.log('=== ENV DEBUG ===');
// console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
// console.log('GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET);
// console.log('GOOGLE_CALLBACK_URL:', process.env.GOOGLE_CALLBACK_URL);
// console.log('================');

const env = {
  node_env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  
  database_url: process.env.DATABASE_URL,
  google_client_id: process.env.GOOGLE_CLIENT_ID,
  google_client_secret: process.env.GOOGLE_CLIENT_SECRET,
  google_callback_url: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',
  
  session_secret: process.env.SESSION_SECRET || 'dev-secret-please-change',
  frontend_url: process.env.FRONTEND_URL || 'http://localhost:5173',
  
  is_production: process.env.NODE_ENV === 'production',
  is_development: process.env.NODE_ENV !== 'production',
};

export default env;