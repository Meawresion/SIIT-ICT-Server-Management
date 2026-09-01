import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../api/auth.js';
import { createUserProfile, getUserProfile } from '../api/users.js';
import '../styles/ProfilePage.css';

export default function ProfilePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    student_id: '',
    degree: 'UNDERGRADUATE',
    program: '',
    advisor_name: '',
    phone_number: '',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user?.account_id) {
          navigate('/login');
          return;
        }

        // Check if profile already exists
        try {
          await getUserProfile();
          navigate('/dashboard');
        } catch {
          // No profile yet, stay on this page
        }
      } catch (err) {
        console.error('Auth check error:', err);
        navigate('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await createUserProfile(formData);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="profile-container">
      <div className="profile-box">
        <h1>Complete Your Profile</h1>
        <form onSubmit={handleSubmit}>
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label>Student ID *</label>
            <input
              type="text"
              name="student_id"
              value={formData.student_id}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Degree *</label>
            <select
              name="degree"
              value={formData.degree}
              onChange={handleChange}
              required
            >
              <option value="UNDERGRADUATE">Undergraduate</option>
              <option value="MASTER">Master</option>
              <option value="DOCTORAL">Doctoral</option>
            </select>
          </div>

          <div className="form-group">
            <label>Program *</label>
            <input
              type="text"
              name="program"
              value={formData.program}
              onChange={handleChange}
              placeholder="e.g., Computer Engineering"
              required
            />
          </div>

          <div className="form-group">
            <label>Advisor / Supervisor Name *</label>
            <input
              type="text"
              name="advisor_name"
              value={formData.advisor_name}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Phone Number *</label>
            <input
              type="tel"
              name="phone_number"
              value={formData.phone_number}
              onChange={handleChange}
              required
            />
          </div>

          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating Profile...' : 'Create Profile'}
          </button>
        </form>
      </div>
    </div>
  );
}
