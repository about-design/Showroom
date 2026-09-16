import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ClaudeService');

/**
 * Service for interacting with Claude AI via MCP Server
 */
export class ClaudeService {
  constructor() {
    this.mcpServerUrl = process.env.MCP_SERVER_URL || 'http://localhost:8001';
    this.enabled = process.env.CLAUDE_ENABLED === 'true';
    this.confidenceThreshold = parseFloat(process.env.CLAUDE_CONFIDENCE_THRESHOLD || '0.85');
  }

  /**
   * Check if Claude AI is available and configured
   * @returns {Promise<Object>} Health status
   */
  async checkHealth() {
    try {
      const response = await axios.get(`${this.mcpServerUrl}/ai/health`, {
        timeout: 5000
      });
      
      return {
        available: response.data.status === 'ready',
        model: response.data.model,
        visionEnabled: response.data.vision_enabled,
        status: response.data.status
      };
    } catch (error) {
      logger.warn('Claude AI health check failed:', error.message);
      return {
        available: false,
        status: 'unavailable',
        error: error.message
      };
    }
  }

  /**
   * Classify a single mesh using Claude AI
   * @param {Object} meshFeatures - Extracted mesh features
   * @param {string} previewImage - Optional base64 preview image
   * @returns {Promise<Object>} Classification result
   */
  async classifyMesh(meshFeatures, previewImage = null) {
    if (!this.enabled) {
      throw new Error('Claude AI is disabled. Set CLAUDE_ENABLED=true in environment');
    }

    try {
      logger.debug(`Classifying mesh: ${meshFeatures.object_name}`);

      const response = await axios.post(
        `${this.mcpServerUrl}/ai/classify-mesh`,
        {
          mesh_features: meshFeatures,
          preview_image: previewImage
        },
        {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (response.data.status === 'success') {
        const classification = response.data.classification;
        
        logger.info(
          `Mesh ${meshFeatures.object_name} classified as ${classification.classification} ` +
          `(confidence: ${(classification.confidence * 100).toFixed(1)}%)`
        );

        return {
          success: true,
          classification: classification.classification,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
          suggestedName: classification.suggested_name,
          alternatives: classification.alternative_labels || []
        };
      } else {
        throw new Error(response.data.error || 'Classification failed');
      }
    } catch (error) {
      logger.error(`Mesh classification failed for ${meshFeatures.object_name}:`, error.message);
      
      return {
        success: false,
        error: error.message,
        classification: null,
        confidence: 0
      };
    }
  }

  /**
   * Classify multiple meshes in batch mode
   * @param {Array<Object>} meshFeaturesList - Array of mesh features
   * @param {number} maxPerRequest - Max meshes per API request (default: 5)
   * @returns {Promise<Object>} Batch classification results
   */
  async classifyBatch(meshFeaturesList, maxPerRequest = 5) {
    if (!this.enabled) {
      throw new Error('Claude AI is disabled');
    }

    try {
      logger.info(`Batch classifying ${meshFeaturesList.length} meshes (max ${maxPerRequest} per request)`);

      const response = await axios.post(
        `${this.mcpServerUrl}/ai/classify-batch`,
        {
          mesh_features_list: meshFeaturesList,
          max_per_request: maxPerRequest
        },
        {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (response.data.status === 'success') {
        const { classifications, total_meshes, cost_estimate_usd } = response.data;

        logger.info(
          `Batch classification completed: ${total_meshes} meshes, ` +
          `estimated cost: $${cost_estimate_usd.toFixed(4)}`
        );

        return {
          success: true,
          classifications,
          totalMeshes: total_meshes,
          costEstimate: cost_estimate_usd
        };
      } else {
        throw new Error(response.data.error || 'Batch classification failed');
      }
    } catch (error) {
      logger.error('Batch classification failed:', error.message);
      
      return {
        success: false,
        error: error.message,
        classifications: [],
        totalMeshes: 0,
        costEstimate: 0
      };
    }
  }

  /**
   * Validate environment configuration for Claude AI
   * @returns {Object} Validation result
   */
  validateConfiguration() {
    const issues = [];
    const warnings = [];

    // Check if Claude is enabled
    if (!this.enabled) {
      warnings.push('Claude AI is disabled (CLAUDE_ENABLED=false)');
    }

    // Check MCP server URL
    if (!this.mcpServerUrl) {
      issues.push('MCP_SERVER_URL is not configured');
    }

    // Check confidence threshold
    if (this.confidenceThreshold < 0.5 || this.confidenceThreshold > 1.0) {
      warnings.push(
        `Confidence threshold ${this.confidenceThreshold} is outside recommended range (0.5-1.0)`
      );
    }

    // Check if CLAUDE_API_KEY is set (via MCP server)
    const apiKeySet = !!process.env.CLAUDE_API_KEY;
    if (this.enabled && !apiKeySet) {
      warnings.push(
        'CLAUDE_API_KEY not found in environment. ' +
        'MCP server may use its own configuration.'
      );
    }

    return {
      valid: issues.length === 0,
      enabled: this.enabled,
      issues,
      warnings,
      config: {
        mcpServerUrl: this.mcpServerUrl,
        confidenceThreshold: this.confidenceThreshold,
        apiKeyConfigured: apiKeySet
      }
    };
  }

  /**
   * Estimate cost for classifying N meshes
   * @param {number} meshCount - Number of meshes
   * @param {boolean} useVision - Include vision API cost
   * @param {boolean} useBatch - Use batch processing
   * @returns {Object} Cost estimate
   */
  estimateCost(meshCount, useVision = false, useBatch = true) {
    // Pricing (November 2024)
    const textOnlyCostPerMesh = 0.004; // ~$0.004 per mesh
    const visionCostPerMesh = 0.0048;  // ~20% more with vision
    
    const costPerMesh = useVision ? visionCostPerMesh : textOnlyCostPerMesh;
    
    // Batch processing reduces overhead by ~30%
    const batchDiscount = useBatch ? 0.7 : 1.0;
    
    const totalCost = meshCount * costPerMesh * batchDiscount;
    
    return {
      meshCount,
      useVision,
      useBatch,
      costPerMesh: costPerMesh * batchDiscount,
      totalCost: parseFloat(totalCost.toFixed(4)),
      currency: 'USD',
      breakdown: {
        baseCost: meshCount * costPerMesh,
        batchDiscount: useBatch ? (meshCount * costPerMesh * 0.3) : 0,
        finalCost: totalCost
      }
    };
  }

  /**
   * Get usage statistics (if tracking is enabled)
   * @returns {Promise<Object>} Usage stats
   */
  async getUsageStats() {
    // TODO: Implement usage tracking with Redis
    // For now, return placeholder
    return {
      enabled: false,
      message: 'Usage tracking not yet implemented',
      dailyCalls: 0,
      monthlyCalls: 0,
      estimatedMonthlyCost: 0
    };
  }
}

// Singleton instance
let claudeServiceInstance = null;

/**
 * Get Claude service singleton
 * @returns {ClaudeService}
 */
export function getClaudeService() {
  if (!claudeServiceInstance) {
    claudeServiceInstance = new ClaudeService();
  }
  return claudeServiceInstance;
}

export default ClaudeService;
