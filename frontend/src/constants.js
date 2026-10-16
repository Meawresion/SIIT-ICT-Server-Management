// Values must match the backend enums in backend/prisma/schema.prisma.

export const RESOURCE_TYPES = [
  { value: 'HPC_GPU', short: 'GPU', label: 'HPC/GPU: High-Performance Computing / GPU Cluster Access' },
  { value: 'BIG_DATA', short: 'Big Data', label: 'Big Data Platform / Server Access' },
  { value: 'VM', short: 'VM', label: 'Virtual Machine (VM)' },
  { value: 'LAB_EQUIPMENT', short: 'Lab Equipment', label: 'Specialized Laboratory Equipment' },
  { value: 'AWS_SKILL_BUILDER', short: 'AWS Skill Builder', label: 'AWS Skill Builder Training Course' },
  { value: 'AWS_LEARNER_LAB', short: 'AWS Learner Lab', label: 'AWS Learner Lab' },
];

export const DEGREES = [
  { value: 'UNDERGRADUATE', label: 'Undergraduate (B.Sc./B.Eng.)' },
  { value: 'MASTER', label: "Master's (M.Sc./M.Eng.)" },
  { value: 'DOCTORAL', label: 'Doctoral (Ph.D.)' },
];

export const STATUSES = ['PENDING', 'APPROVED', 'ACTIVE', 'COMPLETED', 'REJECTED'];

export const STATUS_LABEL = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  DRAFT: 'Draft',
};

export const STATUS_HELP = {
  PENDING: 'Waiting for an approver to review.',
  APPROVED: 'Approved. Access is being set up.',
  ACTIVE: 'Access is ready and the borrow period has started.',
  COMPLETED: 'The borrow period has ended.',
  REJECTED: 'Not approved. See the approver’s comment.',
};

export const resourceShort = (v) => RESOURCE_TYPES.find((r) => r.value === v)?.short ?? v;
export const resourceLabel = (v) => RESOURCE_TYPES.find((r) => r.value === v)?.label ?? v;
export const degreeLabel = (v) => DEGREES.find((d) => d.value === v)?.label ?? v;
