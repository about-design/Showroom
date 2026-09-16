import express from 'express';
import multer from 'multer';
import { getGTINService } from '../services/gtinService.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('GTINRoutes');

// Multer configuration for GTIN database upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedMimeTypes.includes(file.mimetype) || 
        file.originalname.match(/\.(csv|xlsx)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and XLSX files are allowed'));
    }
  }
});

/**
 * GET /api/v1/gtin/filename?gtin=4260123456789
 * Get GLB filename for a GTIN code
 */
router.get('/filename', async (req, res) => {
  try {
    const { gtin, articleNumber } = req.query;

    if (!gtin && !articleNumber) {
      return res.status(400).json({
        success: false,
        error: 'Provide gtin or articleNumber query parameter'
      });
    }

    const gtinService = getGTINService();

    if (gtin) {
      const validation = gtinService.validateGTIN(gtin);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error
        });
      }
    }

    const result = await gtinService.getFilename(gtin, { articleNumber });

    res.json(result);
  } catch (error) {
    logger.error('GTIN filename lookup failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/gtin/search?q=pfosten
 * Search GTIN database
 */
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'q query parameter required'
      });
    }

    const gtinService = getGTINService();
    const result = await gtinService.search(q, parseInt(limit));

    res.json(result);
  } catch (error) {
    logger.error('GTIN search failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/gtin/validate
 * Validate GTIN format
 */
router.post('/validate', (req, res) => {
  try {
    const { gtin } = req.body;

    if (!gtin) {
      return res.status(400).json({
        valid: false,
        error: 'gtin field required'
      });
    }

    const gtinService = getGTINService();
    const validation = gtinService.validateGTIN(gtin);

    res.json(validation);
  } catch (error) {
    logger.error('GTIN validation failed:', error);
    res.status(500).json({
      valid: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/gtin/config
 * Get GTIN service configuration
 */
router.get('/config', (req, res) => {
  try {
    const gtinService = getGTINService();
    const validation = gtinService.validateConfiguration();

    res.json(validation);
  } catch (error) {
    logger.error('GTIN config retrieval failed:', error);
    res.status(500).json({
      valid: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/gtin/upload
 * Upload GTIN database (CSV/XLSX)
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const gtinService = getGTINService();
    const result = await gtinService.uploadDatabase(req.file);

    if (result.success) {
      logger.info(`GTIN database uploaded: ${result.rowCount} rows`);
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    logger.error('GTIN database upload failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
