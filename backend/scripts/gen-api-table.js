'use strict';

const fs = require('fs');
const path = require('path');
const swaggerSpec = require('../src/swagger');

const output = path.join(__dirname, '../../docs/API.md');
const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
const authLabel = (operation) => operation.security?.length ? 'Bearer' : '—';
const escape = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const rows = [];

for (const [route, pathItem] of Object.entries(swaggerSpec.paths || {}).sort(([a], [b]) => a.localeCompare(b))) {
  for (const method of methods) {
    const operation = pathItem[method];
    if (!operation) continue;
    rows.push(`| ${method.toUpperCase()} | ${escape(route)} | ${authLabel(operation)} | ${escape(operation.summary || operation.description || '')} |`);
  }
}

const content = '# Farmers Marketplace API\n\n'
  + 'Generated from the OpenAPI specification exposed at `backend/src/swagger.js`. '
  + 'Do not edit this table manually; run `npm run docs:api` from `backend/`.\n\n'
  + '| Method | Path | Auth | Summary |\n| --- | --- | --- | --- |\n'
  + rows.join('\n') + '\n';
const conventions = '\n## Conventions\n\n'
  + 'Paginated list endpoints return `{ success, data, page, limit, total }`, use a stable `created_at DESC, id DESC` ordering where those columns exist, and include `Link: <…>; rel="next"` when another page is available. '
  + 'SSE endpoints emit a `shutdown` event before the server closes the connection during graceful shutdown.\n';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, content + conventions);
