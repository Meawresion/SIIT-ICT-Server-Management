import { z } from 'zod';

export const UserProfileSchema = z.object({
  student_id: z.string().min(1, 'Student ID is required'),
  degree: z.enum(['UNDERGRADUATE', 'MASTER', 'DOCTORAL']),
  program: z.string().min(1, 'Program is required'),
  advisor_name: z.string().min(1, 'Advisor name is required'),
  phone_number: z.string().min(1, 'Phone number is required'),
});

export const CreateRequestSchema = z.object({
  purpose: z.string().min(1, 'Purpose is required'),
  project_description: z.string().min(1, 'Project description is required'),
  project_supervisor_name: z.string().min(1, 'Project supervisor name is required').nullable().optional(),
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
}).refine(
  (data) => new Date(data.estimated_end_date) >= new Date(data.estimated_start_date),
  {
    message: 'End date must be after or equal to start date',
    path: ['estimated_end_date'],
  }
);

export const UpdateRequestSchema = z.object({
  purpose: z.string().min(1, 'Purpose is required').optional(),
  project_description: z.string().min(1, 'Project description is required').optional(),
  project_supervisor_name: z.string().nullable().optional(),
  resource_type: z.enum([
    'HPC_GPU',
    'BIG_DATA',
    'VM',
    'LAB_EQUIPMENT',
    'AWS_SKILL_BUILDER',
    'AWS_LEARNER_LAB',
  ]).optional(),
  justification: z.string().min(1, 'Justification is required').optional(),
  estimated_start_date: z.string().optional(),
  estimated_end_date: z.string().optional(),
  impact_score: z.number().int().min(1).max(10).optional(),
  supervisor_confirmation: z.enum(['CONFIRMED', 'NOT_CONFIRMED']).optional(),
});

export const ReviewRequestSchema = z.object({
  review_comment: z.string().min(1, 'Review comment is required'),
});
