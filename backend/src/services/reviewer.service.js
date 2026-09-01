import prisma from '../lib/prisma.js';

export async function getAllRequests(filters = {}) {
  const where = {};

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.resource_type) {
    where.resource_type = filters.resource_type;
  }

  if (filters.student_id) {
    where.user = {
      student_id: filters.student_id,
    };
  }

  return prisma.resourceRequest.findMany({
    where,
    include: {
      user: { include: { account: true } },
      reviewed_by: true,
    },
    orderBy: { created_at: 'desc' },
  });
}

export async function getRequestForReview(request_id) {
  return prisma.resourceRequest.findUnique({
    where: { id: request_id },
    include: {
      user: { include: { account: true } },
      reviewed_by: true,
    },
  });
}

export async function approveRequest(request_id, reviewer_account_id, review_comment) {
  const request = await getRequestForReview(request_id);
  
  if (!request) {
    throw new Error('Request not found');
  }

  if (request.status !== 'PENDING') {
    throw new Error('Invalid state transition');
  }

  return prisma.resourceRequest.update({
    where: { id: request_id },
    data: {
      status: 'APPROVED',
      reviewed_by_account_id: reviewer_account_id,
      reviewed_at: new Date(),
      review_comment,
    },
  });
}

export async function rejectRequest(request_id, reviewer_account_id, review_comment) {
  const request = await getRequestForReview(request_id);
  
  if (!request) {
    throw new Error('Request not found');
  }

  if (request.status !== 'PENDING') {
    throw new Error('Invalid state transition');
  }

  return prisma.resourceRequest.update({
    where: { id: request_id },
    data: {
      status: 'REJECTED',
      reviewed_by_account_id: reviewer_account_id,
      reviewed_at: new Date(),
      review_comment,
    },
  });
}

export async function activateRequest(request_id, reviewer_account_id, review_comment = null) {
  const request = await getRequestForReview(request_id);
  
  if (!request) {
    throw new Error('Request not found');
  }

  if (request.status !== 'APPROVED') {
    throw new Error('Invalid state transition');
  }

  return prisma.resourceRequest.update({
    where: { id: request_id },
    data: {
      status: 'ACTIVE',
      reviewed_by_account_id: reviewer_account_id,
      reviewed_at: new Date(),
      ...(review_comment && { review_comment }),
    },
  });
}

export async function completeRequest(request_id, reviewer_account_id, review_comment = null) {
  const request = await getRequestForReview(request_id);
  
  if (!request) {
    throw new Error('Request not found');
  }

  if (request.status !== 'ACTIVE') {
    throw new Error('Invalid state transition');
  }

  return prisma.resourceRequest.update({
    where: { id: request_id },
    data: {
      status: 'COMPLETED',
      reviewed_by_account_id: reviewer_account_id,
      reviewed_at: new Date(),
      ...(review_comment && { review_comment }),
    },
  });
}
