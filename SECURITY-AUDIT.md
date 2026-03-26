# Dependency Vulnerability Audit

**Date:** 2026-03-26  
**Tool:** `npm audit`

---

## Backend (`backend/`)

**Result:** 0 vulnerabilities found. No action required.

---

## Frontend (`frontend/`)

**Result before fix:** 4 moderate severity vulnerabilities  
**Result after fix:** 0 vulnerabilities

### Vulnerabilities Fixed

| Package   | Severity | CVE / Advisory                          | Fix Applied         |
|-----------|----------|-----------------------------------------|---------------------|
| `esbuild` | Moderate | GHSA-67mh-4wv8-2f99 (CWE-346)          | Upgraded via `vite` |
| `vite`    | Moderate | Depends on vulnerable `esbuild <=0.24.2`| `^5.1.6` → `^6.2.0` |
| `vite-node` | Moderate | Depends on vulnerable `vite`          | Upgraded via `vitest` |
| `vitest`  | Moderate | Depends on vulnerable `vite`/`vite-node`| `^1.4.0` → `^3.1.0` |

### Notes

- All vulnerabilities were in **dev dependencies only** — no production runtime risk.
- The `esbuild` advisory (GHSA-67mh-4wv8-2f99) allows any website to send requests to the dev server and read responses. Risk is limited to local development environments.
- Fixes required **major version bumps** (`vite` 5→6, `vitest` 1→3) due to the vulnerable range covering all prior minor/patch releases.
- No packages require manual upgrade beyond what was applied here.
