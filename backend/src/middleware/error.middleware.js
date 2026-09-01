export function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Validation error (from Zod)
  if (err.name === 'ZodError') {
    return res.status(400).json({
      message: 'Validation error',
      errors: err.errors,
    });
  }

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      message: 'Unique constraint violation',
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      message: 'Record not found',
    });
  }

  // Generic application errors
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      message: err.message,
    });
  }

  // Unknown error
  res.status(500).json({
    message: 'Internal server error',
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    message: 'Not found',
  });
}
