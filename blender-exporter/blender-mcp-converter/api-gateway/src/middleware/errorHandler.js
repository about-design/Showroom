import { createLogger } from '../utils/logger.js';

const logger = createLogger('ErrorHandler');

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getPositiveIntOrFallback = (value, fallback) => {
  const parsed = parsePositiveInt(value);
  return parsed ?? fallback;
};

const MAX_UPLOAD_FILE_SIZE_MB = getPositiveIntOrFallback(process.env.MAX_UPLOAD_FILE_SIZE_MB, 10240);
const MAX_UPLOAD_FILES = parsePositiveInt(process.env.MAX_UPLOAD_FILES);
const MAX_UPLOAD_FIELDS = getPositiveIntOrFallback(process.env.MAX_UPLOAD_FIELDS, 2000);

/**
 * Global error handling middleware
 */
export const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    jobId: req.jobId
  });

  // Multer file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'File too large',
      message: `File size exceeds the ${MAX_UPLOAD_FILE_SIZE_MB}MB limit`,
      jobId: req.jobId
    });
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    const fileLimitMessage = MAX_UPLOAD_FILES !== null
      ? `Maximum ${MAX_UPLOAD_FILES} files allowed per request`
      : 'Too many files were provided in a single request';
    return res.status(413).json({
      error: 'Too many files',
      message: fileLimitMessage,
      jobId: req.jobId
    });
  }

  if (err.code === 'LIMIT_FIELD_COUNT') {
    return res.status(413).json({
      error: 'Too many fields',
      message: `Maximum ${MAX_UPLOAD_FIELDS} form fields allowed per request`,
      jobId: req.jobId
    });
  }

  if (err.code === 'LIMIT_PART_COUNT') {
    const maxUploadParts = getPositiveIntOrFallback(
      process.env.MAX_UPLOAD_PARTS,
      Math.max(20000, MAX_UPLOAD_FIELDS + 50000)
    );
    return res.status(413).json({
      error: 'Too many multipart parts',
      message: `Maximum ${maxUploadParts} multipart parts allowed per request`,
      jobId: req.jobId
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: 'Unexpected file field',
      message: err.message,
      jobId: req.jobId
    });
  }

  // File type validation errors
  if (err.message.includes('File type') && err.message.includes('not allowed')) {
    return res.status(400).json({
      error: 'Invalid file type',
      message: err.message,
      jobId: req.jobId
    });
  }

  // Default server error
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong' 
      : err.message,
    jobId: req.jobId
  });
};