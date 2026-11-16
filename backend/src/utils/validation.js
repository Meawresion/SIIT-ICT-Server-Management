import { z } from 'zod';

export const UserProfileSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required').max(100),
  // student_id and degree are not accepted: the API takes them from the SIIT email (D25).
  program: z.string().trim().min(1, 'Program is required').max(50),
  advisor_name: z.string().trim().min(1, 'Advisor name is required').max(100),
  phone_number: z.string().trim().min(1, 'Phone number is required').max(15),
});

// Staff who request resources (not approvers): no student ID, degree or advisor.
export const StaffProfileSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required').max(100),
  department: z.string().trim().min(1, 'Department is required').max(50),
  phone_number: z.string().trim().min(1, 'Phone number is required').max(15),
});

// Approvers have no student fields: their name (pre-filled from Google) and a contact phone.
export const ApproverProfileSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required').max(100),
  phone_number: z.string().trim().max(15).optional().default(''),
});

const RequestFields = z.object({
  purpose: z.string().trim().min(1, 'Purpose is required').max(255),
  project_description: z.string().min(1, 'Project description is required'),
  project_supervisor_name: z.string().trim().min(1, 'Project supervisor name is required').max(100),
  resource_type: z.enum([
    'HPC_GPU',
    'BIG_DATA',
    'VM',
    'LAB_EQUIPMENT',
    'AWS_SKILL_BUILDER',
    'AWS_LEARNER_LAB',
  ]),
  justification: z.string().min(1, 'Justification is required'),
  estimated_start_date: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    'Invalid start date'
  ),
  estimated_end_date: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    'Invalid end date'
  ),
  impact_score: z.number().int().min(1).max(10),
  supervisor_confirmation: z.enum(['CONFIRMED', 'NOT_CONFIRMED']),
  // FR-3.1: e.g. GPU memory, software, dataset size.
  technical_requirements: z.string().trim().max(2000).optional(),
});

export const CreateRequestSchema = RequestFields.extend({
  // The draft the request was submitted from (FR-3.2): deleted with the submit.
  draft_id: z.number().int().positive().max(4294967295).optional(),
}).refine(
  (data) => new Date(data.estimated_end_date) >= new Date(data.estimated_start_date),
  {
    message: 'End date must be after or equal to start date',
    path: ['estimated_end_date'],
  }
);

export const UpdateRequestSchema = RequestFields.partial().refine(
  data => !data.estimated_start_date || !data.estimated_end_date || new Date(data.estimated_end_date) >= new Date(data.estimated_start_date),
  { message: 'End date must be after or equal to start date', path: ['estimated_end_date'] }
);

// FR-8.3: a later end date for a request in use.
export const ExtensionRequestSchema = z.object({
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date').refine(d => !isNaN(Date.parse(d)), 'Invalid date'),
  reason: z.string().trim().min(1, 'Say why you need more time').max(1000),
});

export const ReviewRequestSchema = z.object({
  review_comment: z.string().min(1, 'Review comment is required'),
  // D28: approving while the student has overlapping requests needs this, or the API answers 409.
  confirm_overlap: z.boolean().optional(),
});

// FR-3.2, FR-3.3: a draft may be incomplete, so every field is optional; the limits match the request.
const draftDay = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => !isNaN(Date.parse(d)), 'Invalid date'), z.literal('')]);
export const DraftSchema = z.object({
  purpose: z.string().max(255).optional(),
  project_description: z.string().max(10000).optional(),
  project_supervisor_name: z.string().max(100).optional(),
  resource_type: z.union([RequestFields.shape.resource_type, z.literal('')]).optional(),
  justification: z.string().max(10000).optional(),
  technical_requirements: z.string().max(2000).optional(),
  estimated_start_date: draftDay.optional(),
  estimated_end_date: draftDay.optional(),
  impact_score: z.coerce.number().int().min(1).max(10).optional(),
  supervisor_confirmation: z.enum(['CONFIRMED', 'NOT_CONFIRMED']).optional(),
});
