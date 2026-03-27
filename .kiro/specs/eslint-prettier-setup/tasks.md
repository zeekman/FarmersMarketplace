# Implementation Plan: ESLint & Prettier Setup

## Overview

Install and configure ESLint and Prettier across the monorepo — shared Prettier config at the root, package-specific ESLint configs for backend (Node.js) and frontend (React/Vite) — then fix any existing lint errors so both packages pass with zero errors.

## Tasks

- [-] 1. Install dependencies
  - Add `eslint`, `prettier`, and `eslint-config-prettier` as devDependencies in `backend/package.json`
  - Add `eslint`, `prettier`, `eslint-config-prettier`, `eslint-plugin-react`, and `eslint-plugin-react-hooks` as devDependencies in `frontend/package.json`
  - Run `npm install` in both `backend/` and `frontend/` directories
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 2. Create root Prettier config files
  - [ ] 2.1 Create `FarmersMarketplace/.prettierrc` with `singleQuote: true`, `semi: true`, `tabWidth: 2`, `trailingComma: "es5"`, `printWidth: 100`
    - _Requirements: 3.1_
  - [ ] 2.2 Create `FarmersMarketplace/.prettierignore` excluding `node_modules/`, `dist/`, `coverage/`, and `**/package-lock.json`
    - _Requirements: 4.3_

- [ ] 3. Create backend ESLint config files
  - [ ] 3.1 Create `backend/.eslintrc.json` extending `eslint:recommended` and `prettier`, with `env.node: true`, `env.es2021: true`, `parserOptions.ecmaVersion: 2021`, `sourceType: "module"`, `no-console: "warn"`, `no-unused-vars: "error"`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ] 3.2 Create `backend/.eslintignore` excluding `node_modules/` and `coverage/`
    - _Requirements: 4.1_
  - [ ]* 3.3 Write property test for ESLint config structure validity (Property 5)
    - **Property 5: ESLint config structure validity**
    - Parse `backend/.eslintrc.json` and assert `extends` is an array, last entry is `"prettier"`, and `no-unused-vars` rule is defined
    - **Validates: Requirements 1.1–1.5**

- [ ] 4. Create frontend ESLint config files
  - [ ] 4.1 Create `frontend/.eslintrc.json` extending `eslint:recommended`, `plugin:react/recommended`, `plugin:react-hooks/recommended`, and `prettier`, with `env.browser: true`, `env.es2021: true`, plugins `react` and `react-hooks`, `settings.react.version: "detect"`, `no-console: "warn"`, `no-unused-vars: "error"`, `react-hooks/rules-of-hooks: "error"`, `react-hooks/exhaustive-deps: "warn"`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [ ] 4.2 Create `frontend/.eslintignore` excluding `node_modules/`, `dist/`, and `coverage/`
    - _Requirements: 4.2_
  - [ ]* 4.3 Write property test for ESLint config structure validity (Property 5)
    - **Property 5: ESLint config structure validity**
    - Parse `frontend/.eslintrc.json` and assert `extends` is an array, last entry is `"prettier"`, `react-hooks/rules-of-hooks` rule is defined, and `settings.react.version` is `"detect"`
    - **Validates: Requirements 2.1–2.7**

- [ ] 5. Add lint and format scripts to package.json files
  - [ ] 5.1 Add `"lint": "eslint src/ scripts/"` and `"format": "prettier --write src/ scripts/"` to `backend/package.json`
    - _Requirements: 5.1, 5.2_
  - [ ] 5.2 Add `"lint": "eslint src/"` and `"format": "prettier --write src/"` to `frontend/package.json`
    - _Requirements: 5.3, 5.4_

- [ ] 6. Checkpoint — verify config files and scripts are wired up
  - Ensure all six config files exist (`.prettierrc`, `.prettierignore`, `backend/.eslintrc.json`, `backend/.eslintignore`, `frontend/.eslintrc.json`, `frontend/.eslintignore`)
  - Ensure both `package.json` files contain `lint` and `format` script entries
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Fix existing lint errors in backend source files
  - Run `npm run lint` in `backend/` and address every reported error
  - Fix `no-unused-vars` errors by removing or prefixing unused variables with `_`
  - Fix any other `eslint:recommended` violations found in `src/` and `scripts/`
  - _Requirements: 7.1, 7.3_

- [ ] 8. Fix existing lint errors in frontend source files
  - Run `npm run lint` in `frontend/` and address every reported error
  - Fix `no-unused-vars` errors, hooks violations (`react-hooks/rules-of-hooks`), and any `eslint:recommended` violations in `src/`
  - _Requirements: 7.2, 7.3_

- [ ] 9. Verify format idempotence
  - [ ] 9.1 Run `npm run format` in both `backend/` and `frontend/`, then run again and confirm no files change on the second pass
    - _Requirements: 3.2, 3.3_
  - [ ]* 9.2 Write property test for format idempotence (Property 3)
    - **Property 3: Format idempotence**
    - Use `fast-check` to generate arbitrary JS source strings, format once with the root `.prettierrc`, format again, and assert both outputs are equal
    - Run a minimum of 100 iterations
    - **Validates: Requirements 3.3**

- [ ] 10. Final checkpoint — zero lint errors in both packages
  - Run `npm run lint` in `backend/` — must exit with code 0 and zero errors
  - Run `npm run lint` in `frontend/` — must exit with code 0 and zero errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster setup
- Property tests use `fast-check` with the existing Vitest (frontend) and Jest (backend) test runners
- `prettier` must always be the last entry in `extends` in both ESLint configs to avoid rule conflicts
- The root `.prettierrc` is resolved automatically by Prettier's directory-walking config resolution — no extra config needed in each package
