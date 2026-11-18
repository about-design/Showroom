import winston from 'winston';
import util from 'util';

/**
 * Create a Winston logger instance
 * @param {string} service - Service name for the logger
 * @returns {winston.Logger} Configured logger instance
 */
export const createLogger = (service = 'App') => {
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
        let log = `${timestamp} [${service}] ${level}: ${message}`;
        if (stack) {
          log += `\n${stack}`;
        }
        if (Object.keys(meta).length > 0) {
            const seen = new WeakSet();
            const safeString = (value) => {
              try {
                return JSON.stringify(value, (key, val) => {
                  if (typeof val === 'object' && val !== null) {
                    if (seen.has(val)) return '[Circular]';
                    seen.add(val);
                  }
                  return val;
                });
              } catch (e) {
                return util.inspect(value, { depth: 2, colors: false });
              }
            };
            log += ` ${safeString(meta)}`;
        }
        return log;
      })
    ),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ 
        filename: 'logs/error.log', 
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5
      }),
      new winston.transports.File({ 
        filename: 'logs/combined.log',
        maxsize: 5242880, // 5MB
        maxFiles: 5
      })
    ]
  });

  // Create logs directory if it doesn't exist
  import('fs').then(fs => {
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }
  });

  return logger;
};