import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getCurrentUser, logout } from '../api/auth.js';
import { getRequests } from '../api/reviewer.js';
import '../styles/ReviewerPage.css';

export default function ReviewerPage() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    resource_type: '',
    student_id: '',
  });

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const user = await getCurrentUser();
        if (!user?.account_id) {
          navigate('/login');
          return;
        }

        // Check if user is reviewer (this would be done by the API in production)
        // For now, we allow navigation but the API will reject if not reviewer

        const requests_data = await getRequests(filters);
        setRequests(requests_data);
      } catch (err) {
        console.error('Error fetching requests:', err);
        if (err.message.includes('403') || err.message.includes('Forbidden')) {
          setError('You do not have reviewer access');
          navigate('/dashboard');
        } else {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchRequests();
  }, [navigate, filters]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value,
    }));
  };

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
    <div className="reviewer-container">
      <div className="reviewer-header">
        <h1>Review Requests</h1>
        <button onClick={handleLogout} className="logout-button">Logout</button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="filters-section">
        <h3>Filters</h3>
        <div className="filters">
          <div className="filter-group">
            <label>Status:</label>
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
            >
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="ACTIVE">Active</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Resource Type:</label>
            <select
              name="resource_type"
              value={filters.resource_type}
              onChange={handleFilterChange}
            >
              <option value="">All</option>
              <option value="HPC_GPU">HPC/GPU</option>
              <option value="BIG_DATA">Big Data</option>
              <option value="VM">Virtual Machine</option>
              <option value="LAB_EQUIPMENT">Lab Equipment</option>
              <option value="AWS_SKILL_BUILDER">AWS Skill Builder</option>
              <option value="AWS_LEARNER_LAB">AWS Learner Lab</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Student ID:</label>
            <input
              type="text"
              name="student_id"
              value={filters.student_id}
              onChange={handleFilterChange}
              placeholder="Search student..."
            />
          </div>
        </div>
      </div>

      <div className="requests-section">
        {requests.length === 0 ? (
          <p className="no-requests">No requests found</p>
        ) : (
          <div className="requests-table">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Student Name</th>
                  <th>Student ID</th>
                  <th>Purpose</th>
                  <th>Resource Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => (
                  <tr key={req.id}>
                    <td>{req.id}</td>
                    <td>{req.student_name}</td>
                    <td>{req.student_id}</td>
                    <td>{req.purpose}</td>
                    <td>{req.resource_type}</td>
                    <td>
                      <span className={`badge ${getStatusBadge(req.status)}`}>
                        {req.status}
                      </span>
                    </td>
                    <td>{new Date(req.created_at).toLocaleDateString()}</td>
                    <td>
                      <Link to={`/reviewer/requests/${req.id}`} className="link-action">
                        Review
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
