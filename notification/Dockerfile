# The notification service as a Lambda container image.
FROM public.ecr.aws/lambda/nodejs:22.2026.10.12.12
COPY package.json package-lock.json ${LAMBDA_TASK_ROOT}/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY index.mjs ${LAMBDA_TASK_ROOT}/
CMD ["index.lambdaHandler"]
