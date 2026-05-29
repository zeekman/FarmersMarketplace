# Requirements Document

## Introduction

This feature adds a Docker Compose setup to the FarmersMarketplace project so that developers can start the entire stack (Node.js/Express backend + React/Vite frontend) with a single `docker-compose up` command. The setup supports hot reload via volume mounts, persists the SQLite database via a named volume, and is documented in the README.

## Glossary

- **Compose_Stack**: The set of services defined in `docker-compose.yml` at the repository root, managed by Docker Compose.
- **Backend_Service**: The Node.js/Express service running on port 4000, using `nodemon` for hot reload in development.
- **Frontend_Service**: The React/Vite development server running on port 3000.
- **Named_Volume**: A Docker-managed volume used to persist `market.db` across container restarts.
- **Bind_Mount**: A host directory mounted into a container so that source code changes are reflected immediately without rebuilding the image.
- **env_file**: A Docker Compose directive that loads environment variables from a `.env` file into a service container.
- **Hot_Reload**: The automatic detection and application of source code changes without restarting the container process.

---

## Requirements

### Requirement 1: Backend Dockerfile

**User Story:** As a developer, I want a Dockerfile for the backend, so that the backend service can be built and run in a reproducible container.

#### Acceptance Criteria

1. THE Backend_Service SHALL use the `node:20-alpine` base image.
2. THE Backend_Service SHALL install production and development dependencies via `npm install` during the image build.
3. WHEN the container starts, THE Backend_Service SHALL execute `npm run dev` to launch the server with `nodemon`.
4. THE Backend_Service SHALL expose port 4000.

---

### Requirement 2: Frontend Dockerfile

**User Story:** As a developer, I want a Dockerfile for the frontend in dev mode, so that the Vite development server runs inside a container with hot reload.

#### Acceptance Criteria

1. THE Frontend_Service SHALL use the `node:20-alpine` base image.
2. THE Frontend_Service SHALL install dependencies via `npm install` during the image build.
3. WHEN the container starts, THE Frontend_Service SHALL execute `npm run dev` to launch the Vite dev server.
4. THE Frontend_Service SHALL expose port 3000.
5. THE Frontend_Service SHALL bind to `0.0.0.0` so that the Vite server is reachable from outside the container.

---

### Requirement 3: Docker Compose Orchestration

**User Story:** As a developer, I want a `docker-compose.yml` at the repository root, so that I can start the entire stack with a single command.

#### Acceptance Criteria

1. THE Compose_Stack SHALL define a `backend` service and a `frontend` service.
2. WHEN `docker-compose up` is executed, THE Compose_Stack SHALL start both the Backend_Service and the Frontend_Service.
3. THE Backend_Service SHALL be accessible at `http://localhost:4000` on the host machine.
4. THE Frontend_Service SHALL be accessible at `http://localhost:3000` on the host machine.
5. THE Compose_Stack SHALL load environment variables for the Backend_Service from `./backend/.env` via `env_file`.
6. THE Compose_Stack SHALL use a named volume to persist `market.db` at the path where the backend writes the database file.
7. THE Frontend_Service SHALL declare a dependency on the Backend_Service so that the backend starts first.

---

### Requirement 4: Hot Reload via Bind Mounts

**User Story:** As a developer, I want source code changes to be reflected inside running containers, so that I do not need to rebuild or restart containers during development.

#### Acceptance Criteria

1. THE Compose_Stack SHALL mount `./backend/src` into the Backend_Service container so that source file changes trigger `nodemon` to reload the process.
2. THE Compose_Stack SHALL mount `./frontend/src` into the Frontend_Service container so that source file changes trigger Vite's HMR.
3. WHEN a file inside `./backend/src` is modified on the host, THE Backend_Service SHALL reload without a container restart.
4. WHEN a file inside `./frontend/src` is modified on the host, THE Frontend_Service SHALL apply the change via Hot_Reload without a container restart.

---

### Requirement 5: Database Persistence

**User Story:** As a developer, I want `market.db` to survive container restarts, so that I do not lose data between development sessions.

#### Acceptance Criteria

1. THE Compose_Stack SHALL define a named volume (e.g., `db_data`) mapped to the directory where the Backend_Service writes `market.db`.
2. WHEN the Backend_Service container is stopped and restarted, THE Compose_Stack SHALL retain all previously written data in `market.db`.

---

### Requirement 6: README Documentation

**User Story:** As a developer, I want the README to document the Docker setup, so that I can get the stack running without prior knowledge of the project.

#### Acceptance Criteria

1. THE README SHALL include a "Docker Setup" section with step-by-step instructions for starting the Compose_Stack.
2. THE README SHALL document that the Frontend_Service is accessible at `http://localhost:3000` and the Backend_Service at `http://localhost:4000`.
3. THE README SHALL instruct developers to copy `backend/.env.example` to `backend/.env` and populate required values before running `docker-compose up`.
4. IF a developer has not installed Docker, THEN THE README SHALL reference the Docker installation prerequisite.
