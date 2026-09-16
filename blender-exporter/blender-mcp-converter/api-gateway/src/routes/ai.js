import express from 'express';
import { getClaudeService } from '../services/claudeService.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('ClaudeRoutes');

/**
 * GET /api/v1/ai/health
 * Check Claude AI availability
 */
router.get('/health', async (req, res) => {
  try {
    const claudeService = getClaudeService();
    const health = await claudeService.checkHealth();

    res.json({
      enabled: claudeService.enabled,
      ...health
    });
  } catch (error) {
    logger.error('Claude health check failed:', error);
    res.status(500).json({
      enabled: false,
      available: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/ai/classify
 * Classify a single mesh (direct API call, not via Blender)
 */
router.post('/classify', async (req, res) => {
  try {
    const { meshFeatures, previewImage } = req.body;

    if (!meshFeatures) {
      return res.status(400).json({
        success: false,
        error: 'meshFeatures required'
      });
    }

    const claudeService = getClaudeService();
    const result = await claudeService.classifyMesh(meshFeatures, previewImage);

    res.json(result);
  } catch (error) {
    logger.error('Mesh classification failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/ai/classify-batch
 * Classify multiple meshes in batch
 */
router.post('/classify-batch', async (req, res) => {
  try {
    const { meshFeaturesList, maxPerRequest = 5 } = req.body;

    if (!Array.isArray(meshFeaturesList) || meshFeaturesList.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'meshFeaturesList must be a non-empty array'
      });
    }

    const claudeService = getClaudeService();
    const result = await claudeService.classifyBatch(meshFeaturesList, maxPerRequest);

    res.json(result);
  } catch (error) {
    logger.error('Batch classification failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/ai/config
 * Get Claude AI configuration status
 */
router.get('/config', (req, res) => {
  try {
    const claudeService = getClaudeService();
    const validation = claudeService.validateConfiguration();

    res.json(validation);
  } catch (error) {
    logger.error('Config validation failed:', error);
    res.status(500).json({
      valid: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/ai/estimate-cost
 * Estimate cost for AI classification
 */
router.post('/estimate-cost', (req, res) => {
  try {
    const {
      meshCount = 1,
      useVision = false,
      useBatch = true
    } = req.body;

    const claudeService = getClaudeService();
    const estimate = claudeService.estimateCost(meshCount, useVision, useBatch);

    res.json(estimate);
  } catch (error) {
    logger.error('Cost estimation failed:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * GET /api/v1/ai/usage
 * Get usage statistics (placeholder for now)
 */
router.get('/usage', async (req, res) => {
  try {
    const claudeService = getClaudeService();
    const stats = await claudeService.getUsageStats();

    res.json(stats);
  } catch (error) {
    logger.error('Usage stats retrieval failed:', error);
    res.status(500).json({
      enabled: false,
      error: error.message
    });
  }
});

export default router;
