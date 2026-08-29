const winston = require('winston');
const path = require('path');

const logLevel = process.env.LOG_LEVEL || 'info';
const isProduction = process.env.NODE_ENV === 'production';

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  isProduction 
    ? winston.format.json()
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
);

const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports: [
    new winston.transports.Console(),
    ...(isProduction ? [
      new winston.transports.File({ 
        filename: path.join(process.cwd(), 'logs', 'error.log'), 
        level: 'error' 
      }),
      new winston.transports.File({ 
        filename: path.join(process.cwd(), 'logs', 'combined.log') 
      })
    ] : [])
  ],
  exitOnError: false
});

module.exports = logger;
