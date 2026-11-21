'use strict';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePagination(req, options = {}) {
  const maxLimit = Number.isInteger(options.maxLimit) ? options.maxLimit : MAX_LIMIT;
  const defaultLimit = Number.isInteger(options.defaultLimit) ? options.defaultLimit : DEFAULT_LIMIT;
  const pageValue = Number.parseInt(req?.query?.page, 10);
  const limitValue = Number.parseInt(req?.query?.limit, 10);
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : DEFAULT_PAGE;
  const limit = Number.isInteger(limitValue) && limitValue > 0
    ? Math.min(maxLimit, limitValue)
    : Math.min(maxLimit, defaultLimit);
  return { page, limit, offset: (page - 1) * limit };
}

function setNextLink(req, res, { page, limit, total }) {
  if ((page * limit) >= total) return;
  const url = new URL(`${req.protocol}://${req.get('host')}${req.originalUrl}`);
  url.searchParams.set('page', String(page + 1));
  url.searchParams.set('limit', String(limit));
  res.set('Link', `<${url.pathname}${url.search}>; rel="next"`);
}

function sendPaginated(res, req, data, pagination) {
  const { page, limit, total } = pagination;
  setNextLink(req, res, pagination);
  return res.json({ success: true, data, page, limit, total });
}

module.exports = { parsePagination, setNextLink, sendPaginated, MAX_LIMIT };
