# Design Document: ESLint & Prettier Setup

## Overview

This feature adds ESLint and Prettier to the FarmersMarketplace monorepo. The repo has two packages:

- `backend/` — Node.js/Express (CommonJS, no JSX)
- `frontend/` — React 18 + Vite (ESM, JSX)

Each package gets its own ESLint config tuned to its environment. Prettier config lives at the repo root so both packages share identical formatting rules. `eslint-config-prettier` is used in both ESLint configs to disable any ESLint rules that would conflict with Prettier's output.

The setup is intentionally minimal: no monorepo tooling (Turborepo, Nx, etc.) is introduced. Each package runs its own `lint` and `format` scripts independently.

## Architecture

```
FarmersMarketplace/               ← repo root
├── .prettierrc                   ← shared Prettier config
├── .prettierignore               ← shared Prettier ignore
├── backend/Requirements and Context
Add ESLint with recommended rules to both frontend and backend
Add Prettier for consistent formatting
Add lint and format scripts to both package.json files
Configure .eslintignore and .prettierignore
Tasks
 git checkout -b chore/eslint-prettier
 Install eslint, prettier, eslint-config-prettier in both packages
 Install eslint-plugin-react and eslint-plugin-react-hooks in frontend
 Create .eslintrc.json for backend (Node.js rules)
 Create .eslintrc.json for frontend (React rules)
 Create .prettierrc at repo root
 Add lint and format scripts to both package.json files
 Fix all existing lint errors
Acceptance Criteria
 npm run lint passes with no errors in both packages
 npm run format formats all files consistently
 React hooks rules are enforced in frontend
 No console.log warnings in production code (warn rule)
 .eslintignore excludes node_modules and build output

│   ├── .eslintrc.json            ← backend ESLint config (node env)
│   ├── .eslintignore             ← backend ESLint ignore
│   └── package.json              ← adds lint/format scripts + devDeps
└── frontend/
    ├── .eslintrc.json            ← frontend ESLint config (browser + React)
    ├── .eslintignore             ← frontend ESLint ignore
    └── package.json              ← adds lint/format scripts + devDeps
```

Both packages resolve `.prettierrc` by walking up the directory tree — Prettier's default resolution finds the root file automatically, so no extra configuration is needed to share it.

## Components and Interfaces

### Root Prettier Config (`.prettierrc`)

A single JSON file at `FarmersMarketplace/.prettierrc`. Both `prettier --write` invocations (backend and frontend) will pick it up via Prettier's config resolution.

Key options:
- `singleQuote: true`
- `semi: true`
- `tabWidth: 2`
- `trailingComma: "es5"`
- `printWidth: 100`

### Root Prettier Ignore (`.prettierignore`)

Excludes generated/dependency directories from formatting:
- `node_modules/`
- `dist/`
- `coverage/`
- `**/package-lock.json`

### Backend ESLint Config (`backend/.eslintrc.json`)

Extends `eslint:recommended` and `prettier` (via `eslint-config-prettier`). Targets Node.js CommonJS source.

```json
{
  "env": { "node": true, "es2021": true },
  "extends": ["eslint:recommended", "prettier"],
  "parserOptions": { "ecmaVersion": 2021, "sourceType": "module" },
  "rules": {
    "no-console": "warn",
    "no-unused-vars": "error"
  }
}
```

> Note: `sourceType: "module"` is set per requirements even though the backend currently uses CommonJS `require()`. ESLint will still parse the files correctly; the setting affects how ESLint treats top-level `import`/`export` syntax.

### Backend ESLint Ignore (`backend/.eslintignore`)

```
node_modules/
coverage/
```

### Frontend ESLint Config (`frontend/.eslintrc.json`)

Extends `eslint:recommended`, `plugin:react/recommended`, `plugin:react-hooks/recommended`, and `prettier`.

```json
{
  "env": { "browser": true, "es2021": true },
  "extends": [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "prettier"
  ],
  "plugins": ["react", "react-hooks"],
  "parserOptions": { "ecmaVersion": 2021, "sourceType": "module", "ecmaFeatures": { "jsx": true } },
  "settings": { "react": { "version": "detect" } },
  "rules": {
    "no-console": "warn",
    "no-unused-vars": "error",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn"
  }
}
```

### Frontend ESLint Ignore (`frontend/.eslintignore`)

```
node_modules/
dist/
coverage/
```

### Package Scripts

Backend `package.json` additions:
```json
"lint": "eslint src/ scripts/",
"format": "prettier --write src/ scripts/"
```

Frontend `package.json` additions:
```json
"lint": "eslint src/",
"format": "prettier --write src/"
```

### Dev Dependencies

Backend new devDependencies:
- `eslint`
- `prettier`
- `eslint-config-prettier`

Frontend new devDependencies:
- `eslint`
- `prettier`
- `eslint-config-prettier`
- `eslint-plugin-react`
- `eslint-plugin-react-hooks`

## Data Models

This feature introduces only configuration files — no runtime data models. The relevant "data" is the shape of the config files:

**`.prettierrc` schema** (Prettier config object):
```ts
{
  singleQuote: boolean,
  semi: boolean,
  tabWidth: number,
  trailingComma: "none" | "es5" | "all",
  printWidth: number
}
```

**`.eslintrc.json` schema** (ESLint config object):
```ts
{
  env: Record<string, boolean>,
  extends: string[],
  plugins?: string[],
  parserOptions: { ecmaVersion: number, sourceType: string, ecmaFeatures?: object },
  settings?: object,
  rules: Record<string, "off" | "warn" | "error">
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Backend lint exits clean

*For any* state of the backend source files that has been formatted with Prettier and has no unused variables or undeclared identifiers, running `npm run lint` in `backend/` should exit with code 0 and report zero errors.

**Validates: Requirements 1.6, 7.1**

### Property 2: Frontend lint exits clean

*For any* state of the frontend source files that has been formatted with Prettier and has no unused variables, undeclared identifiers, or hooks violations, running `npm run lint` in `frontend/` should exit with code 0 and report zero errors.

**Validates: Requirements 2.8, 7.2**

### Property 3: Format idempotence

*For any* source file, running `npm run format` twice should produce the same file content as running it once — i.e., the second run makes no changes.

**Validates: Requirements 3.3**

### Property 4: Ignored paths are not linted

*For any* file matched by a `.eslintignore` pattern (e.g., a file inside `node_modules/` or `dist/`), running `npm run lint` should not process or report errors for that file.

**Validates: Requirements 4.4**

### Property 5: ESLint config structure validity

*For any* `.eslintrc.json` file in this setup, parsing it as JSON and validating its fields against the required schema (env flags, extends array, rules object) should succeed without missing or malformed entries.

**Validates: Requirements 1.1–1.5, 2.1–2.7**

## Error Handling

**Missing `.prettierrc`**: If the root `.prettierrc` is absent, Prettier falls back to its built-in defaults, which differ from the project's chosen style. Mitigation: the file is committed to the repo and its presence is verified in the testing strategy.

**ESLint config parse errors**: A malformed `.eslintrc.json` causes ESLint to exit with a fatal error rather than lint errors. Mitigation: configs are validated as valid JSON during setup.

**Rule conflicts between ESLint and Prettier**: Without `eslint-config-prettier` as the last entry in `extends`, ESLint formatting rules can conflict with Prettier's output, causing `lint` to fail on correctly-formatted files. Mitigation: `prettier` is always the last entry in `extends`.

**Existing lint errors in source files**: The existing codebase may have `no-unused-vars` or `no-console` violations. Requirement 7.3 mandates these are fixed as part of this feature. The fix strategy is: run `npm run lint` after setup, address each reported error, then re-run to confirm zero errors.

**`sourceType: "module"` on CommonJS backend**: The backend uses `require()` but `sourceType` is set to `"module"` per requirements. ESLint handles this gracefully — it won't flag `require()` calls as errors under `eslint:recommended`. If issues arise, `sourceType` can be changed to `"commonjs"` without affecting any other requirement.

## Testing Strategy

This feature is infrastructure/configuration — there is no runtime application logic to unit test. Testing is done by executing the tooling itself and asserting on exit codes and output.

### Unit / Example Tests

These are one-shot checks run manually (or in CI) after setup:

1. **Config file presence**: Assert that `.prettierrc`, `.prettierignore`, `backend/.eslintrc.json`, `backend/.eslintignore`, `frontend/.eslintrc.json`, and `frontend/.eslintignore` all exist.
2. **Config file validity**: Parse each JSON config file and assert it contains the required keys and values (env flags, extends entries, rule severities).
3. **Script presence**: Assert that `backend/package.json` and `frontend/package.json` each contain `lint` and `format` script entries with the correct commands.
4. **Dependency presence**: Assert that the required devDependencies appear in each `package.json`.

### Property-Based Tests

Property-based testing is used to verify the behavioral properties above. The recommended library is **fast-check** (JavaScript), which integrates naturally with the existing Vitest setup in the frontend and Jest in the backend.

Each property test runs a minimum of 100 iterations.

**Property 3 — Format idempotence** is the highest-value property test for this feature:

```
// Feature: eslint-prettier-setup, Property 3: Format idempotence
// For any source file, formatting twice produces the same result as formatting once.
fc.assert(
  fc.property(arbitraryJsSource, (source) => {
    const once = prettier.format(source, prettierConfig);
    const twice = prettier.format(once, prettierConfig);
    return once === twice;
  }),
  { numRuns: 100 }
);
```

**Property 5 — ESLint config structure validity** is implemented as a parameterized example test (one per config file) rather than a randomized property, since the config files are static artifacts:

```
// Feature: eslint-prettier-setup, Property 5: ESLint config structure validity
for (const configPath of [backendConfig, frontendConfig]) {
  const config = JSON.parse(fs.readFileSync(configPath));
  assert(Array.isArray(config.extends));
  assert(config.extends.at(-1) === 'prettier');
  assert(typeof config.rules['no-unused-vars'] !== 'undefined');
}
```

Properties 1, 2, and 4 are validated by running the actual CLI tools (`eslint`, `prettier`) and asserting on exit codes — these are integration-style checks best run in CI rather than as unit property tests.

### CI Integration

Add the following steps to the CI pipeline after `npm install`:

```yaml
- run: npm run lint    # in backend/
- run: npm run lint    # in frontend/
- run: npm run format -- --check   # in backend/ (dry-run)
- run: npm run format -- --check   # in frontend/ (dry-run)
```

`prettier --check` exits non-zero if any file would be changed, making it suitable for CI gating without modifying files.
