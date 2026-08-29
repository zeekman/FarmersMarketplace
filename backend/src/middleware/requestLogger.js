const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');

module.exports = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  logger.info('request', {
    requestId,
    method: req.method,
    url: req.url,
  });
  next();
};
