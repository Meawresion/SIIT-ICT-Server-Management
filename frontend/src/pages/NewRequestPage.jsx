import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../api/auth.js';
import { createRequest } from '../api/requests.js';
import '../styles/NewRequestPage.css';

const RESOURCE_TYPES = [
  { value: 'HPC_GPU', label: 'High-Performance Computing (HPC) / GPU Cluster Access' },
  { value: 'BIG_DATA', label: 'Big Data Platform / Server Access' },
  { value: 'VM', label: 'Virtual Machine (VM)' },
  { value: 'LAB_EQUIPMENT', label: 'Specialized Laboratory Equipment' },
  { value: 'AWS_SKILL_BUILDER', label: 'AWS Skill Builder Training Course' },
  { value: 'AWS_LEARNER_LAB', label: 'AWS Learner Lab' },
];

export default function NewRequestPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    purpose: '',
    project_description: '',
    project_supervisor_name: '',
    resource_type: 'HPC_GPU',
    justification: '',
    estimated_start_date: '',
    estimated_end_date: '',
    impact_score: 5,
    supervisor_confirmation: 'NOT_CONFIRMED',
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
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseInt(value) : value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    // Validation
    if (new Date(formData.estimated_end_date) < new Date(formData.estimated_start_date)) {
      setError('End date must be after or equal to start date');
      setSubmitting(false);
      return;
    }

    if (formData.impact_score < 1 || formData.impact_score > 10) {
      setError('Impact score must be between 1 and 10');
      setSubmitting(false);
      return;
    }

    try {
      await createRequest(formData);
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
    <div className="new-request-container">
      <div className="new-request-box">
        <h1>Create Resource Request</h1>
        <form onSubmit={handleSubmit}>
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label>Purpose of Request *</label>
            <input
              type="text"
              name="purpose"
              value={formData.purpose}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Brief Project / Task Description *</label>
            <textarea
              name="project_description"
              value={formData.project_description}
              onChange={handleChange}
              rows="4"
              required
            />
          </div>

          <div className="form-group">
            <label>Project / Task Supervisor or Course Instructor Name *</label>
            <input
              type="text"
              name="project_supervisor_name"
              value={formData.project_supervisor_name}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Type of Resource Requested *</label>
            <select
              name="resource_type"
              value={formData.resource_type}
              onChange={handleChange}
              required
            >
              {RESOURCE_TYPES.map(rt => (
                <option key={rt.value} value={rt.value}>
                  {rt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Justification for Resource Request *</label>
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
                value={formData.estimated_start_date}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Estimated End Date *</label>
              <input
                type="date"
                name="estimated_end_date"
                value={formData.estimated_end_date}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Resource Impact Assessment (1-10) *</label>
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
              {submitting ? 'Creating Request...' : 'Submit Request'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="button-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
