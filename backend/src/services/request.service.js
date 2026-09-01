import prisma from '../lib/prisma.js';

const RESOURCE_TABLES = {
  HPC_GPU: 'hpcGpuRequest',
  BIG_DATA: 'bigDataRequest',
  VM: 'vmRequest',
  LAB_EQUIPMENT: 'labEquipmentRequest',
  AWS_SKILL_BUILDER: 'awsSkillBuilderRequest',
  AWS_LEARNER_LAB: 'awsLearnerLabRequest',
};

export async function createRequest(user_id, data) {
  return prisma.$transaction(async (tx) => {
    // Create the main request
    const request = await tx.resourceRequest.create({
      data: {
        user_id,
        purpose: data.purpose,
        project_description: data.project_description,
        project_supervisor_name: data.project_supervisor_name,
        resource_type: data.resource_type,
        justification: data.justification,
        estimated_start_date: new Date(data.estimated_start_date),
        estimated_end_date: new Date(data.estimated_end_date),
        impact_score: data.impact_score,
        supervisor_confirmation: data.supervisor_confirmation,
        status: 'PENDING',
      },
    });

    // Create the resource-specific detail row
    const resource_table = RESOURCE_TABLES[data.resource_type];
    if (resource_table) {
      const model_name = resource_table.charAt(0).toUpperCase() + resource_table.slice(1) + 'Request';
      
      // Map resource_type to model name
      const models = {
        'HPC_GPU': 'hpcGpuRequest',
        'BIG_DATA': 'bigDataRequest',
        'VM': 'vmRequest',
        'LAB_EQUIPMENT': 'labEquipmentRequest',
        'AWS_SKILL_BUILDER': 'awsSkillBuilderRequest',
        'AWS_LEARNER_LAB': 'awsLearnerLabRequest',
      };
      
      const model_key = models[data.resource_type];
      
      if (model_key === 'hpcGpuRequest') {
        await tx.hpcGpuRequest.create({
          data: { request_id: request.id },
        });
      } else if (model_key === 'bigDataRequest') {
        await tx.bigDataRequest.create({
          data: { request_id: request.id },
        });
      } else if (model_key === 'vmRequest') {
        await tx.vmRequest.create({
          data: { request_id: request.id },
        });
      } else if (model_key === 'labEquipmentRequest') {
        await tx.labEquipmentRequest.create({
          data: { request_id: request.id },
        });
      } else if (model_key === 'awsSkillBuilderRequest') {
        await tx.awsSkillBuilderRequest.create({
          data: { request_id: request.id },
        });
      } else if (model_key === 'awsLearnerLabRequest') {
        await tx.awsLearnerLabRequest.create({
          data: { request_id: request.id },
        });
      }
    }

    return request;
  });
}

export async function getRequestById(request_id, user_id = null) {
  const request = await prisma.resourceRequest.findUnique({
    where: { id: request_id },
    include: {
      user: { include: { account: true } },
      reviewed_by: true,
    },
  });

  if (!request) {
    return null;
  }

  // If user_id is provided, ensure the user owns this request
  if (user_id && request.user_id !== user_id) {
    return null;
  }

  return request;
}

export async function getUserRequests(user_id) {
  return prisma.resourceRequest.findMany({
    where: { user_id },
    include: {
      user: { include: { account: true } },
      reviewed_by: true,
    },
    orderBy: { created_at: 'desc' },
  });
}

export async function updateRequest(request_id, user_id, data) {
  // Verify ownership
  const request = await getRequestById(request_id, user_id);
  if (!request) {
    throw new Error('Request not found or unauthorized');
  }

  // Can only update PENDING requests
  if (request.status !== 'PENDING') {
    throw new Error('Can only update pending requests');
  }

  return prisma.resourceRequest.update({
    where: { id: request_id },
    data: {
      purpose: data.purpose,
      project_description: data.project_description,
      project_supervisor_name: data.project_supervisor_name,
      justification: data.justification,
      estimated_start_date: new Date(data.estimated_start_date),
      estimated_end_date: new Date(data.estimated_end_date),
      impact_score: data.impact_score,
      supervisor_confirmation: data.supervisor_confirmation,
    },
  });
}
