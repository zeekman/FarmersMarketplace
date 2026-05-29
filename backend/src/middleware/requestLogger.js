const { v4: uuidv4 } = require('uuid');

module.exports = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  console.log(JSON.stringify({
    requestId,
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString(),
  }));
  next();
};
