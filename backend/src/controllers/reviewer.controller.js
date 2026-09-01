import {
  getAllRequests,
  getRequestForReview,
  approveRequest,
  rejectRequest,
  activateRequest,
  completeRequest,
} from '../services/reviewer.service.js';
import { ReviewRequestSchema } from '../utils/validation.js';

export async function listRequests(req, res, next) {
  try {
    const { status, resource_type, student_id } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (resource_type) filters.resource_type = resource_type;
    if (student_id) filters.student_id = student_id;

    const requests = await getAllRequests(filters);

    res.json(requests.map(r => ({
      id: r.id,
      purpose: r.purpose,
      resource_type: r.resource_type,
      status: r.status,
      student_name: r.user.account.full_name,
      student_id: r.user.student_id,
      created_at: r.created_at,
      reviewed_at: r.reviewed_at,
    })));
  } catch (err) {
    next(err);
  }
}

export async function getRequestDetail(req, res, next) {
  try {
    const { id } = req.params;

    const request = await getRequestForReview(BigInt(id));

    if (!request) {
      return res.status(404).json({
        message: 'Request not found',
      });
    }

    res.json({
      id: request.id,
      purpose: request.purpose,
      project_description: request.project_description,
      project_supervisor_name: request.project_supervisor_name,
      resource_type: request.resource_type,
      justification: request.justification,
      estimated_start_date: request.estimated_start_date,
      estimated_end_date: request.estimated_end_date,
      impact_score: request.impact_score,
      supervisor_confirmation: request.supervisor_confirmation,
      status: request.status,
      review_comment: request.review_comment,
      reviewed_at: request.reviewed_at,
      created_at: request.created_at,
      student: {
        id: request.user.id,
        name: request.user.account.full_name,
        email: request.user.account.primary_email,
        student_id: request.user.student_id,
        degree: request.user.degree,
        program: request.user.program,
        advisor_name: request.user.advisor_name,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function approveRequestHandler(req, res, next) {
  try {
    const { id } = req.params;
    const reviewer_account_id = req.session.account_id;

    const validation = ReviewRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: 'Validation error',
        errors: validation.error.errors,
      });
    }

    const request = await approveRequest(BigInt(id), reviewer_account_id, validation.data.review_comment);

    res.json({
      id: request.id,
      status: request.status,
      reviewed_at: request.reviewed_at,
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ message: err.message });
    }
    if (err.message.includes('Invalid state')) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
}

export async function rejectRequestHandler(req, res, next) {
  try {
    const { id } = req.params;
    const reviewer_account_id = req.session.account_id;

    const validation = ReviewRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: 'Validation error',
        errors: validation.error.errors,
      });
    }

    const request = await rejectRequest(BigInt(id), reviewer_account_id, validation.data.review_comment);

    res.json({
      id: request.id,
      status: request.status,
      reviewed_at: request.reviewed_at,
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ message: err.message });
    }
    if (err.message.includes('Invalid state')) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
}

export async function activateRequestHandler(req, res, next) {
  try {
    const { id } = req.params;
    const reviewer_account_id = req.session.account_id;

    const request = await activateRequest(BigInt(id), reviewer_account_id);

    res.json({
      id: request.id,
      status: request.status,
      reviewed_at: request.reviewed_at,
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ message: err.message });
    }
    if (err.message.includes('Invalid state')) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
}

export async function completeRequestHandler(req, res, next) {
  try {
    const { id } = req.params;
    const reviewer_account_id = req.session.account_id;

    const request = await completeRequest(BigInt(id), reviewer_account_id);

    res.json({
      id: request.id,
      status: request.status,
      reviewed_at: request.reviewed_at,
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ message: err.message });
    }
    if (err.message.includes('Invalid state')) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
}
