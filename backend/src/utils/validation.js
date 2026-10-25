import { z } from 'zod';

export const UserProfileSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required').max(100),
  // student_id and degree are not accepted: the API takes them from the SIIT email (D25).
  program: z.string().trim().min(1, 'Program is required').max(50),
  advisor_name: z.string().trim().min(1, 'Advisor name is required').max(100),
  phone_number: z.string().trim().min(1, 'Phone number is required').max(15),
});

// Approvers have no student fields: their name (pre-filled from Google) and a contact phone.
export const ApproverProfileSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required').max(100),
  phone_number: z.string().trim().max(15).optional().default(''),
});

const RequestFields = z.object({
  project_name: z.string().trim().min(1).max(255).optional(),
  project_supervisor_email: z.union([z.string().email().max(100), z.literal('')]).optional(),
  extra_details: z.record(z.unknown()).optional(),
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
});

export const CreateRequestSchema = RequestFields.refine(
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

export const ReviewRequestSchema = z.object({
  review_comment: z.string().min(1, 'Review comment is required'),
});
