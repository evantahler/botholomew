# Botholomew

Botholomew is an Agent Framework for general purpose agents. It is based on [Actionhero](https://github.com/actionhero/actionhero) and [bun-actionhero](https://github.com/evantahler/bun-actionhero) and is built with [Bun](https://bun.sh).

This is a monorepo containing both the backend API and frontend dashboard.

## Project Structure

```
botholomew/
├── backend/          # API server (Bun + TypeScript)
├── frontend/         # Next.js dashboard (React + Bootstrap)
├── package.json      # Monorepo configuration
└── README.md         # This file
```

## Prerequisites

Ensure you have [Bun](https://bun.sh), [Redis](https://redis.io/), and [Postgres](https://www.postgresql.org/) installed.

## Setup

### 1. Create Databases

```bash
createdb botholomew
createdb botholomew_test
```

### 2. Setup Environment

```bash
# Backend environment
cp backend/.env.example backend/.env
# And update the values, especially the database connection strings

# Frontend environment
cp frontend/.env.example frontend/.env.local
# Update the server hostname if needed (default: http://localhost:8080)
# This will be used for all API and WebSocket connections
```

### 3. Install Dependencies

```bash
# Install all dependencies for the monorepo
bun install
```

## Development

### Start Both Frontend and Backend

```bash
# Start both services in development mode
bun run dev
```

This will start:

- Backend API server on `http://localhost:8080`
- Frontend dashboard on `http://localhost:3000`

### Start Individual Services

```bash
# Backend only
bun run dev:backend

# Frontend only
bun run dev:frontend
```

### Production

```bash
# Build both services
bun run build

# Start both services in production mode
bun run start
```

## Available Scripts

| Command                | Description                                         |
| ---------------------- | --------------------------------------------------- |
| `bun run dev`          | Start both frontend and backend in development mode |
| `bun run dev:backend`  | Start only the backend in development mode          |
| `bun run dev:frontend` | Start only the frontend in development mode         |
| `bun run build`        | Build both frontend and backend for production      |
| `bun run start`        | Start both services in production mode              |
| `bun run lint`         | Run linting on both frontend and backend            |
| `bun run format`       | Format code in both frontend and backend            |
| `bun run clean`        | Clean all node_modules and lock files               |

## Backend

The backend is a Bun-based API server with:

- TypeScript
- PostgreSQL with Drizzle ORM
- Redis for caching and queues
- WebSocket support
- RESTful API endpoints

## Frontend

The frontend is a Next.js application with:

- React 19 + TypeScript
- Bootstrap 5 + React-Bootstrap
- Real-time server status monitoring
- WebSocket integration
- Message logging system
- Environment-based server configuration (`NEXT_PUBLIC_SERVER_HOSTNAME`)

## API Documentation

Once the backend is running, you can access:

- Swagger UI: `http://localhost:8080/swagger.html`
- WebSocket Test: `http://localhost:8080/test-ws.html`
