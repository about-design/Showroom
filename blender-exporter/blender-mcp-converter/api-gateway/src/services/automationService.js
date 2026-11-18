import pkg from 'bullmq';
const { Queue, Worker } = pkg;
import Redis from 'ioredis';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AutomationService');

export class AutomationService {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100
    });

    this.automationQueue = new Queue('blender-automation', {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 25,
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    });

    this.mcpServerUrl = process.env.MCP_SERVER_URL || 'http://localhost:8001';

    this.initializeWorker();
  }

  initializeWorker() {
    this.worker = new Worker(
      'blender-automation',
      async (job) => this.processAutomationJob(job),
      {
        connection: this.redis,
        concurrency: parseInt(process.env.AUTOMATION_WORKER_CONCURRENCY || '1', 10)
      }
    );

    this.worker.on('completed', (job) => {
      logger.info(`Automation job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      logger.error(`Automation job ${job?.id} failed: ${err?.message}`, { stack: err?.stack });
    });
  }

  async startAutomation(automationData) {
    const { jobId, blendFile, recipe, recipeFile, options } = automationData;

    try {
      logger.info(`Queueing automation job ${jobId}`);

      const job = await this.automationQueue.add(
        'run-automation',
        {
          jobId,
          blendFile,
          recipe: recipe || null,
          recipeFile: recipeFile || null,
          options: options || {}
        },
        {
          jobId,
          delay: 0
        }
      );

      await this.redis.hset(
        `automation:${jobId}`,
        'status', 'queued',
        'createdAt', new Date().toISOString(),
        'blendFile', blendFile,
        'recipeSource', recipe ? 'inline' : (recipeFile ? 'file' : 'unknown'),
        'options', JSON.stringify(options || {})
      );

      return {
        id: job.id,
        jobId,
        status: 'queued'
      };
    } catch (error) {
      logger.error(`Failed to queue automation job ${jobId}: ${error.message}`);
      throw error;
    }
  }

  async processAutomationJob(job) {
    const { jobId, blendFile, recipe, recipeFile, options } = job.data;

    try {
      await this.updateJobStatus(jobId, 'processing', { progress: 10 });
      logger.info(`Processing automation job ${jobId}`);

      const payload = {
        method: 'blender-automation',
        params: {
          jobId,
          blendFile,
          options: options || {}
        }
      };

      if (recipe) {
        payload.params.recipe = recipe;
      }

      if (recipeFile) {
        payload.params.recipeFile = recipeFile;
      }

      const response = await axios.post(`${this.mcpServerUrl}/mcp/call`, payload, {
        timeout: parseInt(process.env.AUTOMATION_TIMEOUT_MS || '600000', 10),
        headers: { 'Content-Type': 'application/json' }
      });

      await this.updateJobStatus(jobId, 'processing', { progress: 80 });

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'MCP server reported automation failure');
      }

      const result = response.data.result || {};
      const outputs = result.outputs || [];
      const logs = result.logs || [];

      await this.redis.hset(
        `automation:${jobId}`,
        'result', JSON.stringify(result),
        'outputs', JSON.stringify(outputs),
        'logs', JSON.stringify(logs),
        'outputDir', result.outputDir || '',
        'completedAt', new Date().toISOString()
      );

      await this.updateJobStatus(jobId, 'completed', {
        progress: 100,
        result
      });

      logger.info(`Automation job ${jobId} finished`);
      return result;
    } catch (error) {
      logger.error(`Automation job ${jobId} failed: ${error.message}`);

      await this.updateJobStatus(jobId, 'failed', {
        error: error.message,
        failedAt: new Date().toISOString()
      });

      throw error;
    }
  }

  async getJobStatus(jobId) {
    try {
      const jobData = await this.redis.hgetall(`automation:${jobId}`);

      if (!jobData || !jobData.status) {
        return null;
      }

      return {
        status: jobData.status,
        progress: jobData.progress ? Number(jobData.progress) : 0,
        createdAt: jobData.createdAt,
        completedAt: jobData.completedAt,
        failedAt: jobData.failedAt,
        blendFile: jobData.blendFile,
        recipeSource: jobData.recipeSource,
        options: jobData.options ? JSON.parse(jobData.options) : {},
        logs: jobData.logs ? JSON.parse(jobData.logs) : [],
        outputs: jobData.outputs ? JSON.parse(jobData.outputs) : [],
        outputDir: jobData.outputDir,
        result: jobData.result ? JSON.parse(jobData.result) : null,
        error: jobData.error
      };
    } catch (error) {
      logger.error(`Failed to fetch automation job status for ${jobId}: ${error.message}`);
      throw error;
    }
  }

  async updateJobStatus(jobId, status, additionalData = {}) {
    const updateData = {
      status,
      updatedAt: new Date().toISOString()
    };

    for (const [key, value] of Object.entries(additionalData)) {
      if (typeof value === 'object' && value !== null) {
        updateData[key] = JSON.stringify(value);
      } else {
        updateData[key] = value;
      }
    }

    await this.redis.hset(`automation:${jobId}`, updateData);
  }

  async cleanupJob(jobId) {
    try {
      logger.info(`Cleaning automation job ${jobId}`);
      const jobKey = `automation:${jobId}`;
      const jobData = await this.redis.hgetall(jobKey);

      if (jobData && Object.keys(jobData).length > 0) {
        const outputsBase = process.env.BLENDER_OUTPUT_DIR
          ? path.resolve(process.env.BLENDER_OUTPUT_DIR)
          : path.resolve(process.cwd(), '..', 'outputs');
        const ensureInside = (targetPath) => {
          if (!targetPath) return false;
          const resolved = path.resolve(targetPath);
          const relative = path.relative(outputsBase, resolved);
          return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
        };

        const removeFile = async (targetPath) => {
          try {
            if (!ensureInside(targetPath)) return;
            await fs.rm(path.resolve(targetPath), { force: true });
            logger.info(`Removed automation artifact: ${targetPath}`);
          } catch (err) {
            logger.warn(`Failed to remove artifact ${targetPath}: ${err.message}`);
          }
        };

        if (jobData.outputs) {
          try {
            const outputs = JSON.parse(jobData.outputs);
            if (Array.isArray(outputs)) {
              for (const output of outputs) {
                if (output && typeof output.path === 'string') {
                  await removeFile(output.path);
                }
              }
            }
          } catch (err) {
            logger.warn(`Failed to parse outputs for job ${jobId}: ${err.message}`);
          }
        }

        if (jobData.outputDir && ensureInside(jobData.outputDir)) {
          try {
            await fs.rm(path.resolve(jobData.outputDir), { recursive: true, force: true });
            logger.info(`Removed automation output directory: ${jobData.outputDir}`);
          } catch (err) {
            logger.warn(`Failed to remove output directory ${jobData.outputDir}: ${err.message}`);
          }
        }
      }

      await this.redis.del(jobKey);
    } catch (error) {
      logger.error(`Failed to cleanup automation job ${jobId}: ${error.message}`);
      throw error;
    }
  }

  async close() {
    if (this.worker) {
      await this.worker.close();
    }
    if (this.redis) {
      this.redis.disconnect();
    }
  }
}
