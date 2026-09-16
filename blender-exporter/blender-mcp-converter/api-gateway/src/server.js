import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';
import { conversionRouter } from './routes/conversion.js';
import { automationRouter } from './routes/automation.js';
import aiRoutes from './routes/ai.js';
import gtinRoutes from './routes/gtin.js';
import { colorMappingRouter } from './routes/colorMapping.js';
import { startCleanupScheduler, stopCleanupScheduler } from './utils/cleanup.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createEnsureLocalOutputsMiddleware } from './middleware/ensureLocalOutputs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const logger = createLogger('Server');

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const JSON_LIMIT_MB = parsePositiveInt(process.env.MAX_JSON_BODY_SIZE_MB, 1024);
const FORM_LIMIT_MB = parsePositiveInt(process.env.MAX_FORM_BODY_SIZE_MB, JSON_LIMIT_MB);
const URLENCODED_PARAM_LIMIT = parsePositiveInt(process.env.MAX_URLENCODED_PARAMS, 5000);
const RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const RATE_LIMIT_MAX = parsePositiveInt(process.env.RATE_LIMIT_MAX, 200);
const RATE_LIMIT_ENABLED = process.env.DISABLE_RATE_LIMIT !== 'true';

// Security and middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Allow configured origins
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    
    // Allow localhost and local network (192.168.x.x, 10.x.x.x, etc.)
    const isLocalNetwork = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+)(:\d+)?$/.test(origin);
    
    if (allowedOrigins.includes(origin) || isLocalNetwork) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(null, true); // Still allow in development
    }
  },
  credentials: true,
  // Some clients are picky about 204 for preflight; use 200 for compatibility.
  optionsSuccessStatus: 200
}));

if (RATE_LIMIT_ENABLED) {
  const limiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again later.'
  });
  app.use(limiter);
} else {
  logger.warn('Rate limiting disabled via DISABLE_RATE_LIMIT environment variable');
}

// Body parsing middleware
app.use(express.json({ limit: `${JSON_LIMIT_MB}mb` }));
app.use(express.urlencoded({ 
  extended: true, 
  limit: `${FORM_LIMIT_MB}mb`,
  parameterLimit: URLENCODED_PARAM_LIMIT
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Health check endpoint for frontend
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// MCP Server health check endpoint
app.get('/api/health/mcp', async (req, res) => {
  try {
    const axios = await import('axios');
    const response = await axios.default.get('http://localhost:8001/health', {
      timeout: 5000
    });
    
    res.json({
      status: 'healthy',
      service: 'mcp-server',
      data: response.data
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'mcp-server',
      error: error.message
    });
  }
});

// API routes
app.use('/api/v1', conversionRouter);
app.use('/api/v1/automation', automationRouter);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/gtin', gtinRoutes);
app.use('/api/v1/color-mapping', colorMappingRouter);

// Serve static files from outputs directory
const outputsDir = path.resolve(process.env.BLENDER_OUTPUT_DIR || path.join(__dirname, '../../outputs'));
const outputsRouter = express.Router();
outputsRouter.use(createEnsureLocalOutputsMiddleware(outputsDir));
outputsRouter.use(express.static(outputsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.glb')) {
      res.setHeader('Content-Type', 'model/gltf-binary');
    } else if (filePath.endsWith('.gltf')) {
      res.setHeader('Content-Type', 'model/gltf+json');
    } else if (filePath.endsWith('.usdz')) {
      // Required for iOS AR Quick Look.
      res.setHeader('Content-Type', 'model/vnd.usdz+zip');
    }
  }
}));
app.use('/outputs', outputsRouter);

// Get file stats for outputs directory
app.get('/api/v1/files/stats', async (req, res) => {
  try {
    const files = await fs.readdir(outputsDir);
    const glbFiles = files.filter(f => f.endsWith('.glb'));
    
    const fileStats = await Promise.all(
      glbFiles.map(async (filename) => {
        const filePath = path.join(outputsDir, filename);
        const stats = await fs.stat(filePath);
        return {
          name: filename,
          size: stats.size,
          mtime: stats.mtime,
          ctime: stats.ctime
        };
      })
    );
    
    res.json(fileStats);
  } catch (error) {
    logger.error('Error fetching file stats:', error);
    res.status(500).json({ error: 'Failed to fetch file stats' });
  }
});

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  stopCleanupScheduler();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  stopCleanupScheduler();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Blender MCP API Gateway running on port ${PORT}`);
  logger.info(`📖 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🌐 Network access enabled on all interfaces (0.0.0.0)`);
  startCleanupScheduler();
});

export default app;