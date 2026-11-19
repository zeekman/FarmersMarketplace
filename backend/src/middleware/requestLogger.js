const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');
const { redactLogValue } = require('../utils/logRedaction');

const SENSITIVE_QUERY_PARAM = /([?&](?:token|ticket|secret|password|mnemonic|seed)=)[^&#]*/gi;

module.exports = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  const details = {
    requestId,
    method: req.method,
    url: req.url.replace(SENSITIVE_QUERY_PARAM, '$1[REDACTED]'),
  };
  if (process.env.LOG_REQUEST_BODY === 'true') details.body = redactLogValue(req.body);
  logger.info('request', redactLogValue(details));
  next();
};
