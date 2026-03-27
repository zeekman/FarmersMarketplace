# Requirements Document

## Introduction

This feature adds ESLint and Prettier to the FarmersMarketplace monorepo (Node.js/Express backend and React/Vite frontend). The goal is to enforce consistent code style and catch common errors across both packages, with shared Prettier configuration at the repo root and package-specific ESLint configurations.

## Glossary

- **Backend**: The Node.js/Express application located in `FarmersMarketplace/backend/`
- **Frontend**: The React/Vite application located in `FarmersMarketplace/frontend/`
- **ESLint**: Static analysis tool that identifies and reports patterns in JavaScript/JSX code
- **Prettier**: Opinionated code formatter that enforces consistent style
- **eslint-config-prettier**: ESLint config that disables rules conflicting with Prettier
- **Lint_Script**: The `npm run lint` command defined in a package's `package.json`
- **Format_Script**: The `npm run format` command defined in a package's `package.json`
- **Root**: The `FarmersMarketplace/` directory containing both packages

## Requirements

### Requirement 1: ESLint Configuration for Backend

**User Story:** As a developer, I want ESLint configured for the backend, so that Node.js-specific issues and code quality problems are caught automatically.

#### Acceptance Criteria

1. THE Backend SHALL include an `.eslintrc.json` file at `backend/.eslintrc.json` that extends `eslint:recommended` and `prettier`
2. THE Backend `.eslintrc.json` SHALL set `env.node` to `true` and `env.es2021` to `true`
3. THE Backend `.eslintrc.json` SHALL set `parserOptions.ecmaVersion` to `2021` and `sourceType` to `module`
4. THE Backend `.eslintrc.json` SHALL configure the `no-console` rule to `warn`
5. THE Backend `.eslintrc.json` SHALL configure the `no-unused-vars` rule to `error`
6. WHEN `npm run lint` is executed in the `backend/` directory, THE Lint_Script SHALL exit with code `0` when no lint errors are present

### Requirement 2: ESLint Configuration for Frontend

**User Story:** As a developer, I want ESLint configured for the frontend, so that React-specific issues and hooks violations are caught automatically.

#### Acceptance Criteria

1. THE Frontend SHALL include an `.eslintrc.json` file at `frontend/.eslintrc.json` that extends `eslint:recommended`, `plugin:react/recommended`, `plugin:react-hooks/recommended`, and `prettier`
2. THE Frontend `.eslintrc.json` SHALL set `env.browser` to `true` and `env.es2021` to `true`
3. THE Frontend `.eslintrc.json` SHALL configure `plugins` to include `react` and `react-hooks`
4. THE Frontend `.eslintrc.json` SHALL set `settings.react.version` to `detect`
5. THE Frontend `.eslintrc.json` SHALL configure the `no-console` rule to `warn`
6. THE Frontend `.eslintrc.json` SHALL configure the `no-unused-vars` rule to `error`
7. THE Frontend `.eslintrc.json` SHALL configure `react-hooks/rules-of-hooks` to `error` and `react-hooks/exhaustive-deps` to `warn`
8. WHEN `npm run lint` is executed in the `frontend/` directory, THE Lint_Script SHALL exit with code `0` when no lint errors are present

### Requirement 3: Prettier Configuration

**User Story:** As a developer, I want a shared Prettier configuration at the repo root, so that all JavaScript and JSX files are formatted consistently across both packages.

#### Acceptance Criteria

1. THE Root SHALL include a `.prettierrc` file with shared formatting rules covering `singleQuote`, `semi`, `tabWidth`, `trailingComma`, and `printWidth`
2. WHEN `npm run format` is executed in either the `backend/` or `frontend/` directory, THE Format_Script SHALL format all targeted source files using the root `.prettierrc` configuration
3. THE Format_Script SHALL be idempotent — running it twice on already-formatted files SHALL produce no further changes

### Requirement 4: Ignore Files

**User Story:** As a developer, I want ESLint and Prettier to skip generated and dependency directories, so that lint and format commands run only on source files.

#### Acceptance Criteria

1. THE Backend SHALL include a `.eslintignore` file that excludes `node_modules/` and `coverage/`
2. THE Frontend SHALL include a `.eslintignore` file that excludes `node_modules/`, `dist/`, and `coverage/`
3. THE Root SHALL include a `.prettierignore` file that excludes `node_modules/`, `dist/`, `coverage/`, and `package-lock.json` files
4. WHEN `npm run lint` is executed, THE Lint_Script SHALL not process any files matched by the `.eslintignore` patterns

### Requirement 5: Package Scripts

**User Story:** As a developer, I want `lint` and `format` scripts in both `package.json` files, so that I can run code quality checks with a single command.

#### Acceptance Criteria

1. THE Backend `package.json` SHALL include a `lint` script that runs `eslint src/ scripts/`
2. THE Backend `package.json` SHALL include a `format` script that runs `prettier --write src/ scripts/`
3. THE Frontend `package.json` SHALL include a `lint` script that runs `eslint src/`
4. THE Frontend `package.json` SHALL include a `format` script that runs `prettier --write src/`
5. WHEN `npm run lint` is executed in either package, THE Lint_Script SHALL complete without errors on a clean codebase

### Requirement 6: Dependency Installation

**User Story:** As a developer, I want all required ESLint and Prettier packages installed as dev dependencies, so that the tooling works out of the box after cloning the repo.

#### Acceptance Criteria

1. THE Backend `package.json` SHALL list `eslint`, `prettier`, and `eslint-config-prettier` as `devDependencies`
2. THE Frontend `package.json` SHALL list `eslint`, `prettier`, `eslint-config-prettier`, `eslint-plugin-react`, and `eslint-plugin-react-hooks` as `devDependencies`
3. WHEN `npm install` is run in either package directory, THE package manager SHALL install all lint and format tooling without errors

### Requirement 7: Zero Lint Errors on Existing Codebase

**User Story:** As a developer, I want all existing source files to pass linting after setup, so that the CI pipeline is green from day one.

#### Acceptance Criteria

1. WHEN `npm run lint` is executed in the `backend/` directory after setup, THE Lint_Script SHALL report zero errors
2. WHEN `npm run lint` is executed in the `frontend/` directory after setup, THE Lint_Script SHALL report zero errors
3. IF existing source files contain lint errors, THEN THE developer SHALL fix those errors as part of this feature before marking it complete
