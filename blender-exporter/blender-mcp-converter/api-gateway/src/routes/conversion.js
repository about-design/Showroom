import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ConversionService } from '../services/conversionService.js';
import { validateConversionRequest, conversionRequestSchema } from '../middleware/validation.js';
import { createLogger } from '../utils/logger.js';
import {
  ACCEPTED_UPLOAD_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
  TEXTURE_EXTENSIONS,
  STEP_EXTENSIONS,
  OBJ_EXTENSIONS,
  MTL_EXTENSIONS
} from '../utils/uploadUtils.js';

const router = express.Router();
const logger = createLogger('ConversionRouter');
const conversionService = new ConversionService();

// Archives are handled later when scanning existing folders; no expansion needed here.
const expandArchiveUploads = async (req, res, next) => next();

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return defaultValue;
};

const safeJsonValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getPositiveIntOrFallback = (value, fallback) => {
  const parsed = parsePositiveInt(value);
  return parsed ?? fallback;
};

const parseFloatOrFallback = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildConversionOptions = (body = {}) => {
  const opts = {
  embedTextures: parseBool(body.embedTextures, true),
  useAI: parseBool(body.useAI, false),
  useDraco: parseBool(body.useDraco, true),
  outputFormat: body.outputFormat || 'glb',
  // Default scale 0.1 = "Originalgröße" in this project.
  scale: parseFloatOrFallback(body.scale, 0.1),
  decimateRatio: parseFloatOrFallback(body.decimateRatio, 1.0),
  autoLabelParts: parseBool(body.autoLabelParts, false),
  useClaudeAI: parseBool(body.useClaudeAI, false),
  useGTINNaming: parseBool(body.useGTINNaming, false),
  gtin: body.gtin || null,
  articleNumber: body.articleNumber || null,
  optimizeGlb: parseBool(body.optimizeGlb, true),
  overwriteExisting: parseBool(body.overwriteExisting, true),
  batchChunkSize: parsePositiveInt(body.batchChunkSize) || undefined,
  rotateYUp: parseBool(body.rotateYUp, false),
  bakeYUp: parseBool(body.bakeYUp, true),
  importUpAxis: body.importUpAxis || 'AUTO',
  // Optional export rotation (X or Y, 90/180/270); mutually exclusive with rotateYUp
  rotateAxis: (body.rotateAxis === 'X' || body.rotateAxis === 'Y' || body.rotateAxis === 'Z') ? body.rotateAxis : null,
  rotateDegrees: ['90', '180', '270'].includes(String(body.rotateDegrees || '').trim()) ? String(body.rotateDegrees).trim() : null,
  // Scene cleanup (default: remove cameras/lights)
  stripCamerasLights: parseBool(body.stripCamerasLights, true) && !parseBool(body.keepCamerasLights, false),
  keepCamerasLights: parseBool(body.keepCamerasLights, false),
  enablePreflight: parseBool(body.enablePreflight, true),
  colorSaturation: parseFloatOrFallback(body.colorSaturation, 1.0),
  colorBrightness: parseFloatOrFallback(body.colorBrightness, 1.0),
  roughnessMultiplier: parseFloatOrFallback(body.roughnessMultiplier, 1.0),
  metallicMultiplier: parseFloatOrFallback(body.metallicMultiplier, 1.0),
  tessellationQuality: parseFloatOrFallback(body.tessellationQuality, 0.1),
  materialFinish: body.materialFinish || 'auto',

  // === NEW: Color selection / remap / presets ===
  selectedColors: safeJsonValue(body.selectedColors),
  colorOverrides: safeJsonValue(body.colorOverrides),
  colorMaterials: safeJsonValue(body.colorMaterials),
  preserveMtlColors: parseBool(body.preserveMtlColors, false),
  defaultColorOverride: parseBool(body.defaultColorOverride, false),
  exportUsdz: parseBool(body.exportUsdz, true),
  // Hex kann direkt vom Client kommen oder (Showroom) von Vite /__api/convert-product aus GTIN-Stamm + ralColors.json abgeleitet werden.
  defaultColorHex: typeof body.defaultColorHex === 'string' && body.defaultColorHex.trim() ? body.defaultColorHex.trim() : null,

  // === NEW: Mesh fingerprint matching (Option A) ===
  targetMeshSignature: safeJsonValue(body.targetMeshSignature),
  targetMeshSignatureId: body.targetMeshSignatureId || null,
  targetMeshMatchThreshold: parseFloatOrFallback(body.targetMeshMatchThreshold, 0.15),
  targetMeshMaterial: safeJsonValue(body.targetMeshMaterial)
  };
  if (opts.rotateAxis && opts.rotateDegrees) opts.rotateYUp = false;
  return opts;
};

// Default is intentionally high for local/batch usage; override via env var if needed.
const MAX_UPLOAD_FILE_SIZE_MB = getPositiveIntOrFallback(process.env.MAX_UPLOAD_FILE_SIZE_MB, 10240);
const MAX_UPLOAD_FILES = parsePositiveInt(process.env.MAX_UPLOAD_FILES);
const MAX_UPLOAD_FIELDS = getPositiveIntOrFallback(process.env.MAX_UPLOAD_FIELDS, 2000);
const MAX_UPLOAD_PARTS = getPositiveIntOrFallback(
  process.env.MAX_UPLOAD_PARTS,
  Math.max(20000, MAX_UPLOAD_FIELDS + 50000)
); // generous default to avoid choking large batches when no explicit limit is set
const MAX_UPLOAD_FILE_SIZE_BYTES = MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), '..', 'uploads', req.jobId);
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Preserve original filename but sanitize it
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, sanitizedName);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ACCEPTED_UPLOAD_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${ext} not allowed. Allowed types: ${Array.from(ACCEPTED_UPLOAD_EXTENSIONS).join(', ')}`), false);
  }
};

const uploadLimits = {
  fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
  fields: MAX_UPLOAD_FIELDS,
  parts: MAX_UPLOAD_PARTS
};

if (MAX_UPLOAD_FILES !== null) {
  // Respect explicit limits via env var while defaulting to unlimited files otherwise
  uploadLimits.files = MAX_UPLOAD_FILES;
}

const upload = multer({
  storage,
  fileFilter,
  limits: uploadLimits
});

const assignUploadJobId = (req, res, next) => {
  req.jobId = uuidv4();
  logger.info(`Generated job ID: ${req.jobId}`);
  next();
};

/**
 * POST /convert
 * Upload files and start conversion process
 */
router.post('/convert', assignUploadJobId, upload.any(), expandArchiveUploads, validateConversionRequest, async (req, res) => {
  try {
    const { jobId } = req;
    const files = req.files;
    logger.info(`Starting conversion job ${jobId} with ${files.length} uploaded files`);

    // Scan the upload folder after multer wrote files.
    // This enables: ZIP upload (expanded), and robust OBJ->mtllib matching when MTL exists in the folder.
    const scan = await conversionService.scanUploadFolder(jobId, { expandArchives: true });
    const organizedFiles = {
      obj: scan.filesByType.obj,
      step: scan.filesByType.step,
      mtl: scan.filesByType.mtl,
      textures: scan.filesByType.textures
    };
    
    // Validate we have at least one OBJ or STEP file
    const hasValidInputFile = organizedFiles.obj.length > 0 || organizedFiles.step.length > 0;
    if (!hasValidInputFile) {
      return res.status(400).json({
        error: 'No OBJ or STEP file found in upload. Please upload at least one .obj or .step/.stp file.',
        jobId,
        received_files: (files || []).map(f => ({
          name: f.originalname,
          type: path.extname(f.originalname).toLowerCase()
        }))
      });
    }
    
    // Start the conversion job
    logger.info(`Received conversion request for job ${jobId} with body keys: ${Object.keys(req.body || {}).join(', ')}`);
    
    const options = buildConversionOptions(req.body);

    // Ingest uploaded MTL materials into the local library for reuse.
    const libraryStats = await conversionService.ingestMaterialLibraryFromMtlFiles(organizedFiles.mtl);
    const materialLibrary = await conversionService.getMaterialLibrary({ limit: 500 });
    
    logger.info(`Conversion options for job ${jobId}:`, options);
    
    const job = await conversionService.startConversion({
      jobId,
      files: organizedFiles,
      options
    });
    
    const convertibleCount = organizedFiles.obj.length + organizedFiles.step.length;
    const multi = convertibleCount > 1;

    res.status(202).json({
      message: multi ? 'Batch conversion job started' : 'Conversion job started',
      jobId,
      status: 'queued',
      batch: multi,
      files: convertibleCount,
      estimatedTime: multi ? `${convertibleCount * 2}-${convertibleCount * 5} minutes` : '2-5 minutes',
      statusUrl: `/api/v1/status/${jobId}`,
      downloadUrl: multi ? null : `/api/v1/download/${jobId}`
    });
    
  } catch (error) {
    logger.error(`Conversion job ${req.jobId} failed:`, error);
    res.status(500).json({
      error: 'Failed to start conversion job',
      message: error.message,
      jobId: req.jobId
    });
  }
});

/**
 * POST /preflight
 * Upload files and run preflight only (no conversion export).
 * Returns jobId for later confirmation.
 */
router.post('/preflight', assignUploadJobId, upload.any(), expandArchiveUploads, validateConversionRequest, async (req, res) => {
  try {
    const { jobId } = req;
    const files = req.files;

    logger.info(`Starting preflight for upload ${jobId} with ${files.length} uploaded files`);

    // Scan the upload folder after multer wrote files.
    // This ensures OBJ/MTL pairs are discovered and ZIP uploads work for preflight.
    const scan = await conversionService.scanUploadFolder(jobId, { expandArchives: true });
    const organizedFiles = {
      obj: scan.filesByType.obj,
      step: scan.filesByType.step,
      mtl: scan.filesByType.mtl,
      textures: scan.filesByType.textures
    };

    const convertibleCount = organizedFiles.obj.length + organizedFiles.step.length;
    if (convertibleCount === 0) {
      return res.status(400).json({
        error: 'No OBJ or STEP file found in upload. Please upload at least one .obj or .step/.stp file.',
        jobId
      });
    }

    const options = buildConversionOptions(req.body);

    // Ingest uploaded MTL materials into the local library for reuse.
    // This should be available even if preflight is skipped.
    let libraryStats = null;
    let materialLibrary = null;
    try {
      libraryStats = await conversionService.ingestMaterialLibraryFromMtlFiles(organizedFiles.mtl);
      materialLibrary = await conversionService.getMaterialLibrary({ limit: 500 });
    } catch (e) {
      logger.warn(`Failed to ingest/read material library for upload ${jobId}: ${e?.message || e}`);
      libraryStats = {
        added: 0,
        updated: 0,
        total: null,
        error: e?.message || String(e)
      };
      materialLibrary = {
        updatedAt: null,
        materials: []
      };
    }

    // Hard rule: skip preflight for large batches (>10 files)
    if (convertibleCount > 10) {
      return res.status(200).json({
        jobId,
        status: 'preflight_skipped',
        convertibleFiles: convertibleCount,
        materialLibrary,
        materialLibraryStats: libraryStats,
        preflight: {
          enabled: false,
          summary: {
            files: convertibleCount
          },
          warnings: [`Preflight deaktiviert: Batch enthält ${convertibleCount} Dateien (>10)`],
          materials: []
        }
      });
    }

    const preflightResult = await conversionService.runPreflight({
      jobId,
      files: organizedFiles,
      options
    });

    return res.status(200).json({
      jobId,
      status: 'preflight_ready',
      convertibleFiles: preflightResult.convertibleFiles,
      preflight: preflightResult.preflight,
      materialLibrary,
      materialLibraryStats: libraryStats,
      confirmUrl: '/api/v1/convert/confirm'
    });
  } catch (error) {
    logger.error(`Preflight job ${req.jobId} failed:`, error);
    return res.status(500).json({
      error: 'Failed to run preflight',
      message: error.message,
      jobId: req.jobId
    });
  }
});

/**
 * POST /convert/confirm
 * Start conversion for a previously uploaded jobId.
 */
router.post('/convert/confirm', async (req, res) => {
  try {
    const { jobId } = req.body || {};
    if (!jobId || typeof jobId !== 'string') {
      return res.status(400).json({
        error: "Parameter 'jobId' is required and must be a string"
      });
    }

    const { error } = conversionRequestSchema.validate(req.body || {}, {
      allowUnknown: true,
      abortEarly: false
    });

    if (error) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: error.details.map(detail => detail.message)
      });
    }

    const options = buildConversionOptions(req.body || {});
    logger.info(`Confirming conversion for upload jobId ${jobId}`);
    const job = await conversionService.startConversionFromUpload(jobId, options);

    const fileCount = (job.stats?.obj || 0) + (job.stats?.step || 0);
    const multi = fileCount > 1;

    return res.status(202).json({
      message: multi ? 'Batch conversion job started' : 'Conversion job started',
      jobId: job.jobId,
      status: job.status,
      batch: multi,
      files: fileCount,
      archiveExtraction: job.archiveExtractionInfo,
      stats: job.stats,
      statusUrl: `/api/v1/status/${job.jobId}`,
      downloadUrl: multi ? null : `/api/v1/download/${job.jobId}`
    });
  } catch (error) {
    logger.error(`Conversion confirm failed: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to start conversion job',
      message: error.message
    });
  }
});

router.get('/uploads', async (req, res) => {
  try {
    const uploads = await conversionService.listUploadDirectories();
    res.json({ uploads });
  } catch (error) {
    logger.error(`Failed to list upload folders: ${error.message}`);
    res.status(500).json({
      error: 'Failed to list upload folders',
      message: error.message
    });
  }
});

router.post('/convert/from-folder', async (req, res) => {
  try {
    const { folder } = req.body || {};

    if (!folder || typeof folder !== 'string') {
      return res.status(400).json({
        error: "Parameter 'folder' is required and must be a string"
      });
    }

    const { error } = conversionRequestSchema.validate(req.body || {}, {
      allowUnknown: true,
      abortEarly: false
    });

    if (error) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: error.details.map(detail => detail.message)
      });
    }

    const options = buildConversionOptions(req.body || {});
    logger.info(`Received folder conversion request for ${folder}`);
    const job = await conversionService.startConversionFromExistingFolder(folder, options);

    const fileCount = (job.stats?.obj || 0) + (job.stats?.step || 0);
    const multi = fileCount > 1;

    res.status(202).json({
      message: multi ? 'Batch conversion job started from folder' : 'Conversion job started from folder',
      jobId: job.jobId,
      status: job.status,
      batch: multi,
      files: fileCount,
      archiveExtraction: job.archiveExtractionInfo,
      stats: job.stats,
      sourceFolder: folder,
      statusUrl: `/api/v1/status/${job.jobId}`,
      downloadUrl: multi ? null : `/api/v1/download/${job.jobId}`
    });
  } catch (error) {
    logger.error(`Conversion from folder failed: ${error.message}`);
    res.status(500).json({
      error: 'Failed to start conversion job from folder',
      message: error.message
    });
  }
});

/**
 * GET /status/:jobId
 * Get conversion job status
 */
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = await conversionService.getJobStatus(jobId);
    
    if (!status) {
      return res.status(404).json({
        error: 'Job not found',
        jobId
      });
    }
    
    res.json({
      jobId,
      ...status,
      downloadUrl: status.status === 'completed' ? `/api/v1/download/${jobId}` : null
    });
    
  } catch (error) {
    logger.error(`Failed to get status for job ${req.params.jobId}:`, error);
    res.status(500).json({
      error: 'Failed to get job status',
      message: error.message,
      jobId: req.params.jobId
    });
  }
});

/**
 * GET /download/:jobId
 * Download converted GLB file
 */
router.get('/download/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const index = req.query.index ? parseInt(req.query.index) : null;
    const status = await conversionService.getJobStatus(jobId);
    if (!status) {
      return res.status(404).json({ error: 'Job not found', jobId });
    }
    const outputs = status.outputPaths && status.outputPaths.length ? status.outputPaths : (status.outputPath ? [status.outputPath] : []);
    if (!outputs.length) {
      return res.status(404).json({ error: 'Output file not found or job not completed', jobId });
    }
    const idx = index !== null ? index : 0;
    if (idx < 0 || idx >= outputs.length) {
      return res.status(400).json({ error: `Invalid index. Available range: 0..${outputs.length-1}`, jobId });
    }
    const outputPath = outputs[idx];
    
    if (!outputPath) {
      return res.status(404).json({
        error: 'Output file not found or job not completed',
        jobId
      });
    }
    
    // Check if file exists
    try {
      await fs.access(outputPath);
    } catch {
      return res.status(404).json({
        error: 'Output file not found on disk',
        jobId
      });
    }
    
  const filename = path.basename(outputPath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'model/gltf-binary');
    
    // Stream the file
    const stats = await fs.stat(outputPath);
    res.setHeader('Content-Length', stats.size);

    const stream = createReadStream(outputPath);
    stream.on('error', (streamErr) => {
      logger.error(`Stream error while downloading job ${jobId}:`, streamErr);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Failed to download file',
          message: streamErr.message,
          jobId
        });
      } else {
        res.destroy(streamErr);
      }
    });

    stream.pipe(res);

    res.on('finish', () => {
      logger.info(`Downloaded file for job ${jobId}: ${filename} (index=${idx})`);
    });
    
  } catch (error) {
    logger.error(`Failed to download file for job ${req.params.jobId}:`, error);
    res.status(500).json({
      error: 'Failed to download file',
      message: error.message,
      jobId: req.params.jobId
    });
  }
});

/**
 * DELETE /jobs/:jobId
 * Clean up job files and data
 */
router.delete('/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    await conversionService.cleanupJob(jobId);
    
    res.json({
      message: 'Job cleaned up successfully',
      jobId
    });
    
  } catch (error) {
    logger.error(`Failed to cleanup job ${req.params.jobId}:`, error);
    res.status(500).json({
      error: 'Failed to cleanup job',
      message: error.message,
      jobId: req.params.jobId
    });
  }
});

export { router as conversionRouter };