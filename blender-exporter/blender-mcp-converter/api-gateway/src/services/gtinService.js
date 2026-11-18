import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('GTINService');

/**
 * Service for GTIN-based filename generation via MCP Server
 */
export class GTINService {
  constructor() {
    this.mcpServerUrl = process.env.MCP_SERVER_URL || 'http://localhost:8001';
    this.enabled = process.env.GTIN_ENABLED === 'true';
  }

  /**
   * Check if GTIN naming service is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Get filename for a GTIN code
   * @param {string} gtin - GTIN code (e.g., 4260123456789)
   * @param {string} fallbackName - Fallback filename if GTIN not found
   * @returns {Promise<Object>} Filename result
   */
  async getFilename(gtin, options = {}) {
    const { fallbackName = 'output', articleNumber } = options;

    if (!this.enabled) {
      logger.debug('GTIN service disabled, using fallback filename');
      return {
        success: false,
        filename: `${fallbackName}.glb`,
        usingFallback: true,
        reason: 'GTIN service disabled',
        productName: null
      };
    }

    const hasGtin = typeof gtin === 'string' && gtin.trim().length > 0;
    const hasArticle = typeof articleNumber === 'string' && articleNumber.trim().length > 0;

    if (!hasGtin && !hasArticle) {
      logger.warn('GTIN filename lookup requires at least gtin or articleNumber');
      return {
        success: false,
        filename: `${fallbackName}.glb`,
        usingFallback: true,
        reason: 'Missing identifier',
        productName: null
      };
    }

    const params = {};
    if (hasGtin) params.gtin = gtin.trim();
    if (hasArticle) params.articleNumber = articleNumber.trim();

    try {
      logger.debug(`Looking up GTIN filename: ${JSON.stringify(params)}`);

      const response = await axios.get(`${this.mcpServerUrl}/gtin/filename`, {
        params,
        timeout: 5000
      });

      const data = response.data || {};

      if (data.success && data.filename) {
        logger.info(`GTIN filename resolved: ${data.filename}`);
        return {
          success: true,
          filename: data.filename,
          usingFallback: !!data.usingFallback,
          matchSource: data.matchSource || null,
          entry: data.entry || null,
          productName: data.entry?.product_name || null,
          requested: data.requested || params
        };
      }

      const reason = data.error || 'GTIN lookup failed';
      logger.warn(`GTIN lookup failed (${JSON.stringify(params)}): ${reason}`);

      return {
        success: false,
        filename: `${fallbackName}.glb`,
        usingFallback: true,
        reason,
        entry: data.entry || null,
        productName: data.entry?.product_name || null,
        requested: data.requested || params
      };
    } catch (error) {
      logger.error(`GTIN service request failed for ${JSON.stringify(params)}:`, error.message);
      
      return {
        success: false,
        filename: `${fallbackName}.glb`,
        usingFallback: true,
        reason: error.message,
        productName: null,
        requested: params
      };
    }
  }

  /**
   * Search for GTIN entries
   * @param {string} query - Search query (GTIN or product name)
   * @param {number} limit - Max results (default: 10)
   * @returns {Promise<Object>} Search results
   */
  async search(query, limit = 10) {
    if (!this.enabled) {
      return {
        success: false,
        matches: [],
        error: 'GTIN service disabled'
      };
    }

    try {
      logger.debug(`Searching GTIN database for: ${query}`);

      const response = await axios.get(`${this.mcpServerUrl}/gtin/search`, {
        params: { q: query },
        timeout: 5000
      });

      const matches = response.data.matches.slice(0, limit);

      logger.info(`GTIN search for "${query}" returned ${matches.length} results`);

      return {
        success: true,
        matches,
        query,
        count: matches.length
      };
    } catch (error) {
      logger.error(`GTIN search failed for "${query}":`, error.message);
      
      return {
        success: false,
        matches: [],
        error: error.message
      };
    }
  }

  /**
   * Validate GTIN format
   * @param {string} gtin - GTIN code to validate
   * @returns {Object} Validation result
   */
  validateGTIN(gtin) {
    if (!gtin || typeof gtin !== 'string') {
      return {
        valid: false,
        error: 'GTIN must be a string'
      };
    }

    // Remove whitespace
    const cleanGtin = gtin.trim().replace(/\s+/g, '');

    // Check length (GTIN-8, GTIN-12, GTIN-13, GTIN-14)
    const validLengths = [8, 12, 13, 14];
    if (!validLengths.includes(cleanGtin.length)) {
      return {
        valid: false,
        error: `GTIN must be 8, 12, 13, or 14 digits (got ${cleanGtin.length})`
      };
    }

    // Check if all characters are digits
    if (!/^\d+$/.test(cleanGtin)) {
      return {
        valid: false,
        error: 'GTIN must contain only digits'
      };
    }

    // TODO: Implement checksum validation (optional)
    
    return {
      valid: true,
      gtin: cleanGtin,
      length: cleanGtin.length
    };
  }

  /**
   * Validate configuration
   * @returns {Object} Configuration status
   */
  validateConfiguration() {
    const issues = [];
    const warnings = [];

    if (!this.enabled) {
      warnings.push('GTIN service is disabled (GTIN_ENABLED=false)');
    }

    if (!this.mcpServerUrl) {
      issues.push('MCP_SERVER_URL is not configured');
    }

    // Check if GTIN database path is set in MCP server
    const dbPath = process.env.GTIN_DATABASE_PATH;
    if (this.enabled && !dbPath) {
      warnings.push(
        'GTIN_DATABASE_PATH not found in environment. ' +
        'MCP server may use default path.'
      );
    }

    return {
      valid: issues.length === 0,
      enabled: this.enabled,
      issues,
      warnings,
      config: {
        mcpServerUrl: this.mcpServerUrl,
        databasePath: dbPath || 'default'
      }
    };
  }

  /**
   * Upload GTIN database to MCP server
   * @param {Object} file - Multer file object
   * @returns {Promise<Object>} Upload result
   */
  async uploadDatabase(file) {
    if (!this.enabled) {
      return {
        success: false,
        error: 'GTIN service is disabled'
      };
    }

    if (!file || !file.buffer) {
      return {
        success: false,
        error: 'Invalid file object'
      };
    }

    try {
      logger.info(`Uploading GTIN database: ${file.originalname} (${file.size} bytes)`);

      const FormData = (await import('form-data')).default;
      const formData = new FormData();
      formData.append('file', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype
      });

      const response = await axios.post(
        `${this.mcpServerUrl}/gtin/upload`,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 30000,
          maxContentLength: 10 * 1024 * 1024,
          maxBodyLength: 10 * 1024 * 1024
        }
      );

      const data = response.data || {};

      if (data.success) {
        logger.info(`GTIN database uploaded successfully: ${data.rowCount} rows`);
        return {
          success: true,
          rowCount: data.rowCount || 0,
          filename: data.filename || file.originalname,
          message: data.message || 'Database uploaded successfully'
        };
      }

      return {
        success: false,
        error: data.error || 'Upload failed'
      };
    } catch (error) {
      logger.error(`GTIN database upload failed:`, error.message);
      
      if (error.response) {
        return {
          success: false,
          error: error.response.data?.error || error.message
        };
      }

      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Singleton instance
let gtinServiceInstance = null;

/**
 * Get GTIN service singleton
 * @returns {GTINService}
 */
export function getGTINService() {
  if (!gtinServiceInstance) {
    gtinServiceInstance = new GTINService();
  }
  return gtinServiceInstance;
}

export default GTINService;
