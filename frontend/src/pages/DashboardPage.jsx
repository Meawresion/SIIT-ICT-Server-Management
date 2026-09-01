import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getCurrentUser, logout } from '../api/auth.js';
import { getUserProfile } from '../api/users.js';
import { getMyRequests } from '../api/requests.js';
import '../styles/DashboardPage.css';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = await getCurrentUser();
        if (!user?.account_id) {
          navigate('/login');
          return;
        }

        const profile_data = await getUserProfile();
        setProfile(profile_data);

        const requests_data = await getMyRequests();
        setRequests(requests_data);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  const getStatusBadge = (status) => {
    const classes = {
      PENDING: 'badge-pending',
      APPROVED: 'badge-approved',
      REJECTED: 'badge-rejected',
      ACTIVE: 'badge-active',
      COMPLETED: 'badge-completed',
    };
    return classes[status] || 'badge-default';
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <button onClick={handleLogout} className="logout-button">Logout</button>
      </div>

      <div className="profile-section">
        {profile && (
          <div className="profile-card">
            <h2>Profile Information</h2>
            <div className="profile-grid">
              <div>
                <strong>Full Name:</strong>
                <p>{profile.full_name}</p>
              </div>
              <div>
                <strong>Email:</strong>
                <p>{profile.primary_email}</p>
              </div>
              <div>
                <strong>Student ID:</strong>
                <p>{profile.student_id}</p>
              </div>
              <div>
                <strong>Degree:</strong>
                <p>{profile.degree}</p>
              </div>
              <div>
                <strong>Program:</strong>
                <p>{profile.program}</p>
              </div>
              <div>
                <strong>Advisor:</strong>
                <p>{profile.advisor_name}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="requests-section">
        <div className="section-header">
          <h2>Your Requests</h2>
          <Link to="/requests/new" className="button-primary">
            Create New Request
          </Link>
        </div>

        {requests.length === 0 ? (
          <p className="no-requests">No requests yet. Create one to get started!</p>
        ) : (
          <div className="requests-table">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Purpose</th>
                  <th>Resource Type</th>
                  <th>Status</th>
                  <th>Impact Score</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => (
                  <tr key={req.id}>
                    <td>{req.id}</td>
                    <td>{req.purpose}</td>
                    <td>{req.resource_type}</td>
                    <td>
                      <span className={`badge ${getStatusBadge(req.status)}`}>
                        {req.status}
                      </span>
                    </td>
                    <td>{req.impact_score}/10</td>
                    <td>{new Date(req.created_at).toLocaleDateString()}</td>
                    <td>
                      <Link to={`/requests/${req.id}`} className="link-action">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
