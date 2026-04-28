# Requirements Document

## Introduction

The FarmersMarketplace codebase consists of a Node.js/Express backend and a React/Vite frontend. Currently there is no unified linting or formatting enforcement, which leads to inconsistent code style and uncaught common errors. This feature adds ESLint and Prettier configuration to both packages, enforces consistent formatting at the repo root, and ensures all existing code passes the configured rules with zero warnings.

## Glossary

- **ESLint**: A static analysis tool for identifying and reporting on patterns in JavaScript/JSX code.
- **Prettier**: An opinionated code formatter that enforces a consistent style.
- **eslint-config-prettier**: An ESLint config that disables rules that conflict with Prettier.
- **eslint-plugin-react**: ESLint rules specific to React components.
- **eslint-plugin-react-hooks**: ESLint rules that enforce the Rules of Hooks.
- **Backend**: The Node.js/Express application located in `backend/`.
- **Frontend**: The React/Vite application located in `frontend/`.
- **Lint_Script**: The `npm run lint` command defined in a `package.json`.
- **Format_Script**: The `npm run format` command defined in a `package.json`.
- **Build_Output**: Compiled or generated files in `build/`, `dist/`, or `coverage/` directories.

## Requirements

### Requirement 1: ESLint Configuration for Backend

**User Story:** As a backend developer, I want ESLint configured with Node.js-appropriate rules, so that common JavaScript errors and style issues are caught automatically.

#### Acceptance Criteria

1. THE Backend SHALL have an `.eslintrc.json` that extends `eslint:recommended` and `prettier`.
2. THE Backend `.eslintrc.json` SHALL set the `node` and `es2021` environments to `true`.
3. THE Backend `.eslintrc.json` SHALL set `no-console` to `"warn"`.
4. THE Backend `.eslintrc.json` SHALL set `no-unused-vars` to `"error"` with `argsIgnorePattern: "^_"`.
5. THE Backend `.eslintrc.json` SHALL set `prefer-const` to `"error"` and `no-var` to `"error"`.
6. THE Backend SHALL have `eslint` and `eslint-config-prettier` listed as `devDependencies` in `backend/package.json`.

### Requirement 2: ESLint Configuration for Frontend

**User Story:** As a frontend developer, I want ESLint configured with React and hooks rules, so that React-specific errors and hook misuse are caught automatically.

#### Acceptance Criteria

1. THE Frontend SHALL have an `.eslintrc.json` that extends `eslint:recommended`, `plugin:react/recommended`, `plugin:react-hooks/recommended`, and `prettier`.
2. THE Frontend `.eslintrc.json` SHALL set the `browser`, `es2021`, and `node` environments to `true`.
3. THE Frontend `.eslintrc.json` SHALL include `react` and `react-hooks` in the `plugins` array.
4. THE Frontend `.eslintrc.json` SHALL set `react/react-in-jsx-scope` to `"off"` (React 17+ JSX transform).
5. THE Frontend `.eslintrc.json` SHALL set `no-console` to `"warn"`.
6. THE Frontend SHALL have `eslint`, `eslint-config-prettier`, `eslint-plugin-react`, and `eslint-plugin-react-hooks` listed as `devDependencies` in `frontend/package.json`.

### Requirement 3: Prettier Configuration

**User Story:** As a developer, I want a single Prettier configuration at the repo root, so that all files across both packages are formatted consistently.

#### Acceptance Criteria

1. THE Repository SHALL have a `.prettierrc` at the root defining `semi`, `trailingComma`, `singleQuote`, `printWidth`, `tabWidth`, and `useTabs`.
2. THE Repository SHALL have a `.prettierignore` at the root that excludes `node_modules/`, `build/`, `dist/`, `coverage/`, and lock files.
3. WHEN the Format_Script is run in either package, THE Format_Script SHALL apply the root `.prettierrc` rules to all non-ignored source files.

### Requirement 4: Lint and Format Scripts

**User Story:** As a developer, I want `lint` and `format` scripts in both `package.json` files, so that I can run checks and formatting with a single command.

#### Acceptance Criteria

1. THE Backend `package.json` SHALL define a `lint` script that runs `eslint . --max-warnings 0`.
2. THE Backend `package.json` SHALL define a `format` script that runs `prettier --write .` using the root `.prettierignore`.
3. THE Frontend `package.json` SHALL define a `lint` script that runs `eslint . --max-warnings 0`.
4. THE Frontend `package.json` SHALL define a `format` script that runs `prettier --write .` using the root `.prettierignore`.
5. WHEN the Lint_Script is run in either package, THE Lint_Script SHALL exit with code `0` when there are no errors or warnings.
6. IF the Lint_Script encounters any ESLint error or warning, THEN THE Lint_Script SHALL exit with a non-zero code.

### Requirement 5: Ignore File Configuration

**User Story:** As a developer, I want `.eslintignore` and `.prettierignore` files configured correctly, so that generated files and dependencies are never linted or formatted.

#### Acceptance Criteria

1. THE Backend `.eslintignore` SHALL exclude `node_modules/`, `build/`, `dist/`, `coverage/`, and migration files.
2. THE Frontend `.eslintignore` (or root `.eslintignore`) SHALL exclude `node_modules/`, `build/`, `dist/`, `coverage/`, and Vite/Playwright config files.
3. THE Root `.prettierignore` SHALL exclude `node_modules/`, `build/`, `dist/`, `coverage/`, `*.json`, `*.md`, and lock files.
4. WHEN ESLint is run in either package, THE ESLint SHALL not process any file matched by the applicable `.eslintignore`.

### Requirement 6: Zero Lint Errors on Existing Code

**User Story:** As a developer, I want all existing source files to pass the configured ESLint rules with no errors and no warnings, so that the lint check is immediately useful as a CI gate.

#### Acceptance Criteria

1. WHEN the Lint_Script is run in `backend/`, THE Lint_Script SHALL complete with exit code `0` and zero reported errors or warnings.
2. WHEN the Lint_Script is run in `frontend/`, THE Lint_Script SHALL complete with exit code `0` and zero reported errors or warnings.
3. IF a `console.log` statement exists in production source code, THEN THE ESLint SHALL emit a `no-console` warning, causing the Lint_Script to fail due to `--max-warnings 0`.
4. WHEN the Format_Script is run in either package, THE Format_Script SHALL produce no diff on already-formatted files (idempotent).
