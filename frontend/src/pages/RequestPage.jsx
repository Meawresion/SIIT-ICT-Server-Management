import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { getCurrentUser } from '../api/auth.js';
import { getRequest, updateRequest } from '../api/requests.js';
import '../styles/RequestPage.css';

export default function RequestPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({});

  useEffect(() => {
    const fetchRequest = async () => {
      try {
        const user = await getCurrentUser();
        if (!user?.account_id) {
          navigate('/login');
          return;
        }

        const request_data = await getRequest(id);
        setRequest(request_data);
        setFormData(request_data);
      } catch (err) {
        console.error('Error fetching request:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchRequest();
  }, [id, navigate]);

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseInt(value) : value,
    }));
  };

  const handleEdit = () => {
    if (request?.status !== 'PENDING') {
      setError('Can only edit pending requests');
      return;
    }
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setFormData(request);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const updated = await updateRequest(id, formData);
      setRequest({ ...request, ...updated });
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!request) {
    return <div className="error-message">Request not found</div>;
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
    <div className="request-container">
      <div className="request-header">
        <div>
          <h1>Request #{request.id}</h1>
          <span className={`badge ${getStatusBadge(request.status)}`}>
            {request.status}
          </span>
        </div>
        <Link to="/dashboard" className="button-secondary">Back to Dashboard</Link>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="request-content">
        {!editing ? (
          <div className="request-view">
            <div className="request-section">
              <h2>Request Details</h2>
              <div className="details-grid">
                <div>
                  <strong>Purpose:</strong>
                  <p>{request.purpose}</p>
                </div>
                <div>
                  <strong>Resource Type:</strong>
                  <p>{request.resource_type}</p>
                </div>
                <div>
                  <strong>Impact Score:</strong>
                  <p>{request.impact_score}/10</p>
                </div>
                <div>
                  <strong>Supervisor Confirmation:</strong>
                  <p>{request.supervisor_confirmation}</p>
                </div>
              </div>

              <div className="full-width">
                <strong>Project Description:</strong>
                <p>{request.project_description}</p>
              </div>

              <div className="full-width">
                <strong>Project Supervisor Name:</strong>
                <p>{request.project_supervisor_name}</p>
              </div>

              <div className="full-width">
                <strong>Justification:</strong>
                <p>{request.justification}</p>
              </div>

              <div className="details-grid">
                <div>
                  <strong>Estimated Start Date:</strong>
                  <p>{new Date(request.estimated_start_date).toLocaleDateString()}</p>
                </div>
                <div>
                  <strong>Estimated End Date:</strong>
                  <p>{new Date(request.estimated_end_date).toLocaleDateString()}</p>
                </div>
              </div>
            </div>

            {request.status === 'PENDING' && (
              <button onClick={handleEdit} className="button-primary">
                Edit Request
              </button>
            )}

            {request.review_comment && (
              <div className="request-section">
                <h2>Review Comment</h2>
                <p>{request.review_comment}</p>
                {request.reviewed_at && (
                  <small>Reviewed on {new Date(request.reviewed_at).toLocaleString()}</small>
                )}
              </div>
            )}

            <div className="meta-info">
              <small>Created: {new Date(request.created_at).toLocaleString()}</small>
              <small>Last Updated: {new Date(request.updated_at).toLocaleString()}</small>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="request-edit">
            <h2>Edit Request</h2>

            <div className="form-group">
              <label>Purpose *</label>
              <input
                type="text"
                name="purpose"
                value={formData.purpose}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Project Description *</label>
              <textarea
                name="project_description"
                value={formData.project_description}
                onChange={handleChange}
                rows="4"
                required
              />
            </div>

            <div className="form-group">
              <label>Project Supervisor Name *</label>
              <input
                type="text"
                name="project_supervisor_name"
                value={formData.project_supervisor_name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Justification *</label>
              <textarea
                name="justification"
                value={formData.justification}
                onChange={handleChange}
                rows="4"
                required
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Estimated Start Date *</label>
                <input
                  type="date"
                  name="estimated_start_date"
                  value={formData.estimated_start_date?.split('T')[0] || ''}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label>Estimated End Date *</label>
                <input
                  type="date"
                  name="estimated_end_date"
                  value={formData.estimated_end_date?.split('T')[0] || ''}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>Impact Score (1-10) *</label>
              <input
                type="number"
                name="impact_score"
                value={formData.impact_score}
                onChange={handleChange}
                min="1"
                max="10"
                required
              />
            </div>

            <div className="form-group">
              <label>Supervisor Confirmation *</label>
              <select
                name="supervisor_confirmation"
                value={formData.supervisor_confirmation}
                onChange={handleChange}
                required
              >
                <option value="NOT_CONFIRMED">Not Confirmed</option>
                <option value="CONFIRMED">Confirmed</option>
              </select>
            </div>

            <div className="form-actions">
              <button type="submit" disabled={submitting} className="button-primary">
                {submitting ? 'Saving...' : 'Save Changes'}
              </button>
              <button type="button" onClick={handleCancel} className="button-secondary">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
