const { enforceHttps, hsts } = require('../src/middleware/https');

function mockReqRes(proto, host = 'example.com', url = '/api/v1/health') {
  const req = {
    headers: { 'x-forwarded-proto': proto, host },
    protocol: proto,
    originalUrl: url,
  };
  const res = {
    redirected: null,
    headers: {},
    redirect(code, location) {
      this.redirected = { code, location };
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('enforceHttps middleware', () => {
  const OLD_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
  });

  it('skips redirect in development', () => {
    process.env.NODE_ENV = 'development';
    const { req, res, next } = mockReqRes('http');
    enforceHttps(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.redirected).toBeNull();
  });

  it('redirects HTTP to HTTPS in production', () => {
    process.env.NODE_ENV = 'production';
    const { req, res, next } = mockReqRes('http');
    enforceHttps(req, res, next);
    expect(res.redirected).toEqual({
      code: 301,
      location: 'https://example.com/api/v1/health',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next for HTTPS requests in production', () => {
    process.env.NODE_ENV = 'production';
    const { req, res, next } = mockReqRes('https');
    enforceHttps(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.redirected).toBeNull();
  });
});

describe('hsts middleware', () => {
  const OLD_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
  });

  it('does not set HSTS header outside production', () => {
    process.env.NODE_ENV = 'development';
    const { req, res, next } = mockReqRes('https');
    hsts(req, res, next);
    expect(res.headers['Strict-Transport-Security']).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('sets HSTS header in production', () => {
    process.env.NODE_ENV = 'production';
    const { req, res, next } = mockReqRes('https');
    hsts(req, res, next);
    expect(res.headers['Strict-Transport-Security']).toMatch(/max-age=31536000/);
    expect(res.headers['Strict-Transport-Security']).toMatch(/includeSubDomains/);
    expect(res.headers['Strict-Transport-Security']).toMatch(/preload/);
    expect(next).toHaveBeenCalled();
  });
});
