import { createRequest, getRequestById, getUserRequests, updateRequest } from '../services/request.service.js';
import { CreateRequestSchema, UpdateRequestSchema } from '../utils/validation.js';

export async function createNewRequest(req, res, next) {
  try {
    const validation = CreateRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: 'Validation error',
        errors: validation.error.errors,
      });
    }

    const user_id = req.session.user_id;

    if (!user_id) {
      return res.status(400).json({
        message: 'User profile required',
      });
    }

    const request = await createRequest(user_id, validation.data);

    res.status(201).json({
      id: request.id.toString(),  // ← Convert BigInt
      status: request.status,
      resource_type: request.resource_type,
      purpose: request.purpose,
      created_at: request.created_at,
    });
  } catch (err) {
    next(err);
  }
}

export async function getMyRequests(req, res, next) {
  try {
    const user_id = req.session.user_id;

    if (!user_id) {
      return res.status(400).json({
        message: 'User profile required',
      });
    }

    const requests = await getUserRequests(user_id);

    res.json(requests.map(r => ({
      id: r.id.toString(),  // ← Convert BigInt
      purpose: r.purpose,
      resource_type: r.resource_type,
      status: r.status,
      impact_score: r.impact_score,
      estimated_start_date: r.estimated_start_date,
      estimated_end_date: r.estimated_end_date,
      created_at: r.created_at,
      reviewed_at: r.reviewed_at,
    })));
  } catch (err) {
    next(err);
  }
}

export async function getRequest(req, res, next) {
  try {
    const { id } = req.params;
    const user_id = req.session.user_id;

    const request = await getRequestById(BigInt(id), user_id);

    if (!request) {
      return res.status(404).json({
        message: 'Request not found',
      });
    }

    res.json({
      id: request.id.toString(),  // ← Convert BigInt
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
      updated_at: request.updated_at,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateRequestHandler(req, res, next) {
  try {
    const { id } = req.params;
    const user_id = req.session.user_id;

    const validation = UpdateRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: 'Validation error',
        errors: validation.error.errors,
      });
    }

    const request = await updateRequest(BigInt(id), user_id, validation.data);

    res.json({
      id: request.id.toString(),  // ← Convert BigInt
      purpose: request.purpose,
      resource_type: request.resource_type,
      status: request.status,
    });
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('unauthorized')) {
      return res.status(404).json({ message: err.message });
    }
    if (err.message.includes('Can only update')) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
}