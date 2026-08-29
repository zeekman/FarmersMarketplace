# Contributing to Farmers Marketplace

Thank you for your interest in contributing! This guide covers everything you need to get started.

For reporting security vulnerabilities, see [SECURITY.md](./SECURITY.md).  
For testnet invocation examples, see [docs/local-invoke.md](./docs/local-invoke.md).

---

## 1. Setup

### Rust Toolchain

Install Rust stable and the `wasm32-unknown-unknown` target:

```bash
rustup install stable
rustup target add wasm32-unknown-unknown
```

### Stellar CLI

Install the Stellar CLI (required to build and deploy Soroban contracts):

```bash
cargo install --locked stellar-cli --features opt
```

Verify versions:

```bash
rustc --version        # 1.78+ recommended
stellar --version      # 21.x or 22.x
```

---

## 2. Build

Build the Soroban escrow contract:

```bash
stellar contract build
# or equivalently:
cargo build --target wasm32-unknown-unknown --release
```

The compiled WASM is written to `target/wasm32-unknown-unknown/release/`.

---

## 3. Tests

Run the full test suite with all features enabled:

```bash
cargo test --all-features
```

Run property / fuzz tests specifically:

```bash
cargo test --all-features -- fuzz
```

For backend (Node.js) tests:

```bash
cd backend
npm test
```

---

## 4. Lint

All of the following must pass before opening a PR:

```bash
# Format check
cargo fmt --check

# Clippy (zero warnings policy)
cargo clippy -- -D warnings

# Dependency audit
cargo audit

# JS lint
cd backend && npm run lint
cd frontend && npm run lint
```

---

## 5. Branch Naming & Commit Format

### Branch naming

| Prefix       | Use for                                      |
|--------------|----------------------------------------------|
| `feat/`      | New features                                 |
| `fix/`       | Bug fixes                                    |
| `chore/`     | Maintenance, dependency updates              |
| `docs/`      | Documentation only                           |
| `security/`  | Security patches                             |

Examples:

```
feat/payment-id-validation
fix/escrow-timeout-boundary
docs/contributing-guide
security/upgrade-openssl
```

### Commit messages — Conventional Commits

Format: `type(scope): short description`

```
feat(payment-processor): add payment_id format validation in create_payment
fix(escrow): handle partial refund edge case when amount equals balance
docs(contract): update README with stream rate-decrease examples
chore(deps): bump soroban-sdk from 21.0.0 to 22.0.0
```

- `type` must be one of: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `security`
- `scope` is the affected module or contract name
- Description is imperative mood, lowercase, no period

---

## 6. PR Requirements

Before marking a PR ready for review:

- [ ] All tests pass (`cargo test --all-features` / `npm test`)
- [ ] No new Clippy warnings (`cargo clippy -- -D warnings`)
- [ ] Code is formatted (`cargo fmt --check`)
- [ ] Dependencies are audited (`cargo audit`)
- [ ] `CHANGELOG.md` entry added under `[Unreleased]`
- [ ] PR description links the issue being closed (`Closes #NNN`)
- [ ] At least one reviewer assigned

PRs that fail CI checks will not be merged.

---

## 7. Issue Workflow & Labels

### Labels

| Label          | Meaning                                          |
|----------------|--------------------------------------------------|
| `bug`          | Something is broken                              |
| `feat`         | New feature request                              |
| `docs`         | Documentation improvement                        |
| `security`     | Security-related issue or fix                    |
| `good first issue` | Suitable for first-time contributors         |
| `blocked`      | Waiting on external dependency or decision       |
| `needs-repro`  | Bug report needs a minimal reproduction case     |

### Issue templates

Use the appropriate template when opening an issue:

- **Bug report** — steps to reproduce, expected vs actual behaviour, environment details
- **Feature request** — problem statement, proposed solution, acceptance criteria
- **Security vulnerability** — follow the process in [SECURITY.md](./SECURITY.md) instead of opening a public issue

### Workflow

1. Check existing issues and PRs before opening a new one.
2. For large changes, open a discussion or draft PR first.
3. Reference the issue number in your branch name and commit message.
4. Keep PRs focused — one logical change per PR.
