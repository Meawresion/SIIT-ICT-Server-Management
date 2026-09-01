import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, getGoogleAuthUrl } from '../api/auth.js';
import '../styles/LoginPage.css';

export default function LoginPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // Check if already logged in
    const checkAuth = async () => {
      const user = await getCurrentUser();
      if (user?.account_id) {
        navigate('/dashboard');
      }
    };
    checkAuth();
  }, [navigate]);

  const handleGoogleLogin = async () => {
    try {
      const auth_url = await getGoogleAuthUrl();
      window.location.href = auth_url;
    } catch (err) {
      console.error('Login error:', err);
      alert('Failed to initiate login');
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>SIIT ICT Resource Request System</h1>
        <p>Sign in with your university Google account</p>
        <button onClick={handleGoogleLogin} className="google-button">
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
