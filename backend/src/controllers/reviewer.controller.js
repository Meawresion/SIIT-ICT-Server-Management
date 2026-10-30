import { parseId } from '../utils/db-mapping.js';
import {
  getAllRequests,
  getRequestForReview,
  approveRequest,
  rejectRequest,
  activateRequest,
  completeRequest,
} from '../services/reviewer.service.js';
import { retryProvisioning } from '../services/provisioning.service.js';
import { exportCsv } from '../services/export.service.js';
import { decideExtension } from '../services/extension.service.js';
import { ReviewRequestSchema } from '../utils/validation.js';
import { parsePage } from '../utils/paging.js';

export async function listRequests(req, res, next) {
  try {
    const { status, resource_type, student_id } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (resource_type) filters.resource_type = resource_type;
    if (student_id) filters.student_id = student_id;

    const { rows, total } = await getAllRequests(filters, parsePage(req.query));

    res.set('X-Total-Count', String(total));
    res.json(rows.map(r => ({
      id: r.id,
      purpose: r.purpose,
      resource_type: r.resource_type,
      status: r.status,
      student_name: r.user.account.full_name,
      student_id: r.user.student_id,
      extension_asked: Boolean(r.extension),
      // FR-9.2: the Active Requests view shows the period and the GPU node.
      estimated_start_date: r.estimated_start_date,
      estimated_end_date: r.estimated_end_date,
      gpu_node: r.extra_details?.gpu_node ?? null,
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

    const request = await getRequestForReview(parseId(id));

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
      technical_requirements: request.technical_requirements,
      extension: request.extension,
      status: request.status,
      review_comment: request.review_comment,
      reviewed_at: request.reviewed_at,
      created_at: request.created_at,
      overlaps: request.overlaps,
      events: request.events,
      provisioning: request.provisioning,
      student: {
        id: request.user.id,
        name: request.user.account.full_name,
        email: request.user.account.primary_email,
        student_id: request.user.student_id,
        degree: request.user.degree,
        program: request.user.program,
        advisor_name: request.project_supervisor_name,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function approveRequestHandler(req, res, next) {
  try {
    const { id } = req.params;
    const reviewer_account_id = req.auth.account_id;

    const validation = ReviewRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: 'Validation error',
        errors: validation.error.errors,
      });
    }

    const { review_comment, confirm_overlap } = validation.data;
    const request = await approveRequest(parseId(id), reviewer_account_id, review_comment, { confirm_overlap });

    res.json({
      id: request.id,
      status: request.status,
      reviewed_at: request.reviewed_at,
    });
  } catch (err) {
    if (err.overlaps) {
      return res.status(409).json({ message: err.message, overlaps: err.overlaps });
    }
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
    const reviewer_account_id = req.auth.account_id;

    const validation = ReviewRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: 'Validation error',
        errors: validation.error.errors,
      });
    }

    const request = await rejectRequest(parseId(id), reviewer_account_id, validation.data.review_comment);

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
    const reviewer_account_id = req.auth.account_id;

    const request = await activateRequest(parseId(id), reviewer_account_id);

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

// D4: a new job after a failed setup or revoke; the request keeps its status.
export async function retryProvisioningHandler(req, res, next) {
  try {
    const job = await retryProvisioning(parseId(req.params.id), req.auth.account_id);
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
}

export async function completeRequestHandler(req, res, next) {
  try {
    const { id } = req.params;
    const reviewer_account_id = req.auth.account_id;

    const request = await completeRequest(parseId(id), reviewer_account_id);

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

// FR-9.3: GET /api/reviewer/export?type=requests|events&from=YYYY-MM-DD&to=YYYY-MM-DD[&status=ACTIVE]
export async function exportHandler(req, res, next) {
  try {
    const { filename, csv } = await exportCsv(req.query);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

// FR-8.3: { review_comment } -> the request's id, status and end date.
const extensionHandler = (approve) => async (req, res, next) => {
  try {
    const validation = ReviewRequestSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: 'Validation error', errors: validation.error.errors });
    const request = await decideExtension(parseId(req.params.id), req.auth.account_id, approve, validation.data.review_comment);
    res.json({ id: request.id, status: request.status, estimated_end_date: request.estimated_end_date });
  } catch (err) {
    next(err);
  }
};
export const approveExtensionHandler = extensionHandler(true);
export const rejectExtensionHandler = extensionHandler(false);
