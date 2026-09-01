import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { getCurrentUser } from '../api/auth.js';
import { getRequest, approveRequest, rejectRequest, activateRequest, completeRequest } from '../api/reviewer.js';
import '../styles/ReviewerRequestPage.css';

export default function ReviewerRequestPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [activeAction, setActiveAction] = useState(null);

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
      } catch (err) {
        console.error('Error fetching request:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchRequest();
  }, [id, navigate]);

  const handleApprove = async () => {
    if (!reviewComment.trim()) {
      setError('Review comment is required');
      return;
    }
    await submitReview('approve', approveRequest);
  };

  const handleReject = async () => {
    if (!reviewComment.trim()) {
      setError('Review comment is required');
      return;
    }
    await submitReview('reject', rejectRequest);
  };

  const handleActivate = async () => {
    await submitReview('activate', activateRequest);
  };

  const handleComplete = async () => {
    await submitReview('complete', completeRequest);
  };

  const submitReview = async (action, api_func) => {
    setSubmitting(true);
    setError('');

    try {
      if (action === 'approve' || action === 'reject') {
        await api_func(id, reviewComment);
      } else {
        await api_func(id);
      }

      // Refresh request
      const request_data = await getRequest(id);
      setRequest(request_data);
      setReviewComment('');
      setActiveAction(null);
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

  const can_approve = request.status === 'PENDING';
  const can_reject = request.status === 'PENDING';
  const can_activate = request.status === 'APPROVED';
  const can_complete = request.status === 'ACTIVE';

  return (
    <div className="reviewer-request-container">
      <div className="request-header">
        <div>
          <h1>Request #{request.id}</h1>
          <span className={`badge ${getStatusBadge(request.status)}`}>
            {request.status}
          </span>
        </div>
        <Link to="/reviewer" className="button-secondary">Back to Requests</Link>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="request-content">
        <div className="request-section">
          <h2>Student Information</h2>
          <div className="details-grid">
            <div>
              <strong>Name:</strong>
              <p>{request.student.name}</p>
            </div>
            <div>
              <strong>Email:</strong>
              <p>{request.student.email}</p>
            </div>
            <div>
              <strong>Student ID:</strong>
              <p>{request.student.student_id}</p>
            </div>
            <div>
              <strong>Degree:</strong>
              <p>{request.student.degree}</p>
            </div>
            <div>
              <strong>Program:</strong>
              <p>{request.student.program}</p>
            </div>
            <div>
              <strong>Advisor:</strong>
              <p>{request.student.advisor_name}</p>
            </div>
          </div>
        </div>

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

        {request.review_comment && (
          <div className="request-section">
            <h2>Previous Review</h2>
            <p>{request.review_comment}</p>
            {request.reviewed_at && (
              <small>Reviewed on {new Date(request.reviewed_at).toLocaleString()}</small>
            )}
          </div>
        )}

        <div className="request-section review-actions">
          <h2>Review Actions</h2>

          {(can_approve || can_reject) && (
            <>
              <div className="review-comment">
                <label>Review Comment *</label>
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  rows="4"
                  placeholder="Enter your review comment..."
                  disabled={submitting}
                />
              </div>

              <div className="action-buttons">
                {can_approve && (
                  <button
                    onClick={handleApprove}
                    disabled={submitting}
                    className="button-approve"
                  >
                    {submitting && activeAction === 'approve' ? 'Approving...' : 'Approve'}
                  </button>
                )}

                {can_reject && (
                  <button
                    onClick={handleReject}
                    disabled={submitting}
                    className="button-reject"
                  >
                    {submitting && activeAction === 'reject' ? 'Rejecting...' : 'Reject'}
                  </button>
                )}
              </div>
            </>
          )}

          {can_activate && (
            <button
              onClick={handleActivate}
              disabled={submitting}
              className="button-activate"
            >
              {submitting && activeAction === 'activate' ? 'Activating...' : 'Activate Request'}
            </button>
          )}

          {can_complete && (
            <button
              onClick={handleComplete}
              disabled={submitting}
              className="button-complete"
            >
              {submitting && activeAction === 'complete' ? 'Completing...' : 'Mark as Completed'}
            </button>
          )}

          {!can_approve && !can_reject && !can_activate && !can_complete && (
            <p className="no-actions">No actions available for this request status.</p>
          )}
        </div>

        <div className="meta-info">
          <small>Created: {new Date(request.created_at).toLocaleString()}</small>
        </div>
      </div>
    </div>
  );
}
