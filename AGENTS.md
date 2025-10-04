# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Botholomew is an Agent Framework for general purpose agents built with [Bun](https://bun.sh). It's a monorepo containing a backend API (Bun + TypeScript) and a frontend dashboard (Next.js + React + Bootstrap).

**Stack:**

- Backend: Bun runtime, TypeScript, PostgreSQL (Drizzle ORM), Redis (caching & queues), node-resque (background jobs)
- Frontend: Next.js 15, React 19, TypeScript, Bootstrap 5 + React-Bootstrap, SCSS

## Development Commands

### Running the Project

```bash
# Start both backend and frontend (recommended)
bun run dev

# Start individual services
bun run dev:backend   # Backend API on http://localhost:8080
bun run dev:frontend  # Frontend on http://localhost:3000
```

### Backend Commands

```bash
cd backend

# Start server
bun run dev                    # Development mode with watch
bun run start                  # Production mode

# Database migrations
./botholomew.ts migrate        # Generate and run migrations (NEVER create migration files manually)

# List all actions and routes
./botholomew.ts actions

# Run tests
bun test

# Linting and formatting
bun run lint                   # Check formatting
bun run format                 # Auto-format code
```

### Frontend Commands

```bash
cd frontend

bun run dev      # Development mode with Turbopack
bun run build    # Production build
bun run start    # Production server
bun test         # Run tests
bun run lint     # Check formatting
bun run format   # Auto-format code
```

### Root-Level Commands

```bash
bun run lint     # Lint both frontend and backend
bun run format   # Format both frontend and backend
```

## Code Architecture

### Backend Structure

The backend is built on a custom framework inspired by Actionhero:

**Core Concepts:**

- **Actions** (`/backend/actions/*`): The primary units of work - handle API routes, CLI commands, and background tasks
  - Each Action extends the `Action` class and implements a `run()` method
  - Actions define inputs using Zod schemas, web routes (REST API), and optionally task queues
  - Actions are auto-discovered and registered via `globLoader()`

- **Initializers** (`/backend/initializers/*`): Bootstrap services in a controlled sequence
  - Execute in 3 phases: initialize (setup), start (activate), stop (cleanup)
  - Priority-based ordering (loadPriority, startPriority, stopPriority)
  - Register services on the global `api` object (e.g., `api.db`, `api.redis`, `api.resque`)

- **Models** (`/backend/models/*`): Drizzle ORM schema definitions (database tables)

- **Ops** (`/backend/ops/*`): Business logic layer - reusable operations that work with models
  - Keep Actions thin by moving complex logic to Ops

- **Classes** (`/backend/classes/*`): Core framework classes (API, Action, Connection, Logger, TypedError, etc.)

- **Config** (`/backend/config/*`): Configuration files organized by service

- **API Object (`api`)**: Global singleton that holds all services and provides lifecycle management
  - Access via `import { api } from "./api"`
  - Services registered by initializers: `api.db`, `api.redis`, `api.resque`, `api.actions`, etc.

**Request Flow:**

1. HTTP request arrives at `/backend/servers/web.ts`
2. Routing matches request to an Action based on `web.route` and `web.method`
3. Middleware runs (e.g., SessionMiddleware for authentication)
4. Action input validation via Zod schema
5. Action's `run()` method executes
6. Response serialized to JSON

**Background Jobs:**

- Actions can define `task` properties to run as background jobs
- Enqueued via `api.actions.enqueue()` or `api.actions.enqueueAt()`
- Processed by node-resque workers

### Frontend Structure

**Type Safety:**

- Frontend imports Action types directly from backend: `import type { Action, ActionResponse } from "../../backend/api"`
- Form inputs typed as: `ActionName["inputs"]["_type"]`
- API responses typed as: `ActionResponse<ActionName>`
- **NEVER write your own types - always use backend Action types**

**API Communication:**

- Use `APIWrapper` class for all API calls (`/frontend/lib/api.ts`)
- Example: `APIWrapper.post<SessionCreate>("/session", params)`
- Automatically handles route params, query strings, credentials, error handling

**Pages:** `/frontend/pages/*` - Next.js pages router
**Components:** `/frontend/components/*` - Reusable React components
**Styling:** SCSS files (not plain CSS) in `/frontend/styles/*`

## Development Practices

### Core Principles

- **Minimal, surgical, elegant, and correct** - Before writing code, always make a plan about how to best implement the feature. Then, follow the plan, checking off each step as complete before moving on to the next.
- Use **Bun** for all commands (not npm, node, or yarn)
- **ALWAYS run `bun run typecheck` and `bun lint` after making changes** - Typecheck catches type errors, lint auto-formats code

### Backend-Specific Rules

1. **Error Handling**: Always use `TypedError` class for throwing errors
2. **Database Migrations**:
   - NEVER create migration files manually
   - Run `./botholomew.ts migrate` to generate migrations after model changes
3. **Route Parameters**: Use `/:id` syntax (e.g., `/agent/:id`)
4. **Database Operations**: Type the return value of all read/write operations
5. **Testing**:
   - Use Bun's built-in test framework (not Jest)
   - Real database operations preferred over mocks
   - Use `await api.db.clearDatabase()` to reset DB after each test
   - Create tests instead of restarting the server manually

### Frontend-Specific Rules

1. **Type Definitions**: Load types from backend Actions, never write your own
2. **Form Input Types**: Use `ActionName["inputs"]["_type"]`
   ```typescript
   type SigninFormData = SessionCreate["inputs"]["_type"];
   ```
3. **API Response Types**: Use `ActionResponse<ActionName>`
   ```typescript
   type SigninResponse = ActionResponse<SessionCreate>;
   ```
4. **API Calls**: Use `APIWrapper.post<ActionName>(route, params)`
5. **Styling**: Write SCSS files, not CSS

## Important Files

- `/backend/botholomew.ts` - CLI entry point and command registration
- `/backend/api.ts` - Exports core framework classes and global `api` singleton
- `/backend/classes/API.ts` - API lifecycle management (initialize, start, stop)
- `/backend/classes/Action.ts` - Base Action class definition
- `/backend/initializers/db.ts` - Database connection and migration handling
- `/backend/initializers/actionts.ts` - Action discovery and background job enqueuing
- `/frontend/lib/api.ts` - APIWrapper for type-safe API calls

## Testing

Backend tests use Bun's built-in test framework:

```typescript
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
```

Prefer real database operations over mocks:

```typescript
await api.db.clearDatabase(); // Resets DB state
```

## API Documentation

Once the backend is running:

- Swagger UI: http://localhost:8080/swagger.html
- WebSocket Test: http://localhost:8080/test-ws.html
