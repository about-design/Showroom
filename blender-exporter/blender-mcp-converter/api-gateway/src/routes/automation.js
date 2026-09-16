import express from 'express';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AutomationService } from '../services/automationService.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('AutomationRouter');
const automationService = new AutomationService();

router.post('/run', async (req, res) => {
  const {
    jobId: providedJobId,
    blendFile,
    recipe,
    recipeFile,
    options
  } = req.body || {};

  if (!blendFile || typeof blendFile !== 'string') {
    return res.status(400).json({
      error: 'blendFile is required and must be a string'
    });
  }

  if (!recipe && !recipeFile) {
    return res.status(400).json({
      error: 'Either recipe or recipeFile must be provided'
    });
  }

  if (recipe && typeof recipe !== 'object') {
    return res.status(400).json({
      error: 'recipe must be a JSON object when provided'
    });
  }

  if (recipeFile && typeof recipeFile !== 'string') {
    return res.status(400).json({
      error: 'recipeFile must be a string when provided'
    });
  }

  if (options && typeof options !== 'object') {
    return res.status(400).json({
      error: 'options must be an object when provided'
    });
  }

  const jobId = providedJobId && typeof providedJobId === 'string' ? providedJobId : uuidv4();

  try {
    await automationService.startAutomation({
      jobId,
      blendFile,
      recipe: recipe || null,
      recipeFile: recipeFile || null,
      options: options || {}
    });

    logger.info(`Automation job ${jobId} accepted`);

    res.status(202).json({
      message: 'Automation job queued',
      jobId,
      status: 'queued',
      statusUrl: `/api/v1/automation/status/${jobId}`,
      resultUrl: `/api/v1/automation/status/${jobId}`
    });
  } catch (error) {
    logger.error(`Failed to start automation job ${jobId}: ${error.message}`);
    res.status(500).json({
      error: 'Failed to queue automation job',
      message: error.message,
      jobId
    });
  }
});

router.get('/status/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const status = await automationService.getJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        error: 'Automation job not found',
        jobId
      });
    }

    res.json({
      jobId,
      ...status
    });
  } catch (error) {
    logger.error(`Failed to fetch automation job status ${jobId}: ${error.message}`);
    res.status(500).json({
      error: 'Failed to fetch automation job status',
      message: error.message,
      jobId
    });
  }
});

router.get('/download/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const indexParam = req.query.index;

  try {
    const status = await automationService.getJobStatus(jobId);
    if (!status) {
      return res.status(404).json({
        error: 'Automation job not found',
        jobId
      });
    }

    const outputs = Array.isArray(status.outputs) ? status.outputs.filter(Boolean) : [];
    if (!outputs.length) {
      return res.status(404).json({
        error: 'No automation outputs available',
        jobId
      });
    }

    const index = indexParam !== undefined ? Number.parseInt(indexParam, 10) : 0;
    if (!Number.isFinite(index) || index < 0 || index >= outputs.length) {
      return res.status(400).json({
        error: `Invalid index. Available range: 0..${outputs.length - 1}`,
        jobId
      });
    }

    const output = outputs[index];
    if (!output?.path) {
      return res.status(404).json({
        error: 'Output path missing for selected entry',
        jobId
      });
    }

    const resolvedPath = path.resolve(output.path);
    await fs.access(resolvedPath);

    const filename = path.basename(resolvedPath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const ext = path.extname(filename).toLowerCase();
    const contentTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.exr': 'image/x-exr',
      '.bmp': 'image/bmp'
    };
    if (contentTypes[ext]) {
      res.setHeader('Content-Type', contentTypes[ext]);
    }

    const stats = await fs.stat(resolvedPath);
    res.setHeader('Content-Length', stats.size);

    createReadStream(resolvedPath)
      .on('error', (error) => {
        logger.error(`Stream error for automation download ${jobId}: ${error.message}`);
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Failed to stream automation output',
            message: error.message,
            jobId
          });
        } else {
          res.destroy(error);
        }
      })
      .pipe(res)
      .on('finish', () => {
        logger.info(`Served automation output for job ${jobId}: ${filename} (index=${index})`);
      });
  } catch (error) {
    logger.error(`Failed to download automation output ${jobId}: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to download automation output',
        message: error.message,
        jobId
      });
    }
  }
});

router.delete('/jobs/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    await automationService.cleanupJob(jobId);

    res.json({
      message: 'Automation job metadata removed',
      jobId
    });
  } catch (error) {
    logger.error(`Failed to cleanup automation job ${jobId}: ${error.message}`);
    res.status(500).json({
      error: 'Failed to cleanup automation job',
      message: error.message,
      jobId
    });
  }
});

export const automationRouter = router;
