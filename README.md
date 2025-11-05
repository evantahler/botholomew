# Botholomew

Botholomew is an Agent Framework for general purpose agents. It is based on [Actionhero](https://github.com/actionhero/actionhero) and [bun-actionhero](https://github.com/evantahler/bun-actionhero) and is built with [Bun](https://bun.sh).

This is a monorepo containing both the backend API and frontend dashboard.

## Project Overview

Botholomew is a modern, full-stack AI agent framework designed to create, manage, and execute general-purpose AI agents.

### 🤖 Key Features

**Agent Management System**
- Create & configure custom AI agents with specific models (GPT-4o, GPT-3.5-turbo, etc.)
- Multi-agent architecture with parent-child delegation capabilities
- Toolkit integration via Arcade.ai for extended functionality
- User isolation with proper authentication and authorization

**Technical Architecture**
- **Backend**: Bun runtime, TypeScript, PostgreSQL with Drizzle ORM, Redis
- **Frontend**: Next.js, React 19, TypeScript, Bootstrap 5
- **APIs**: RESTful endpoints with WebSocket support

**Core Components**
- **Agent Execution System**: OpenAI-powered agent execution with automatic toolkit loading
- **Smart Delegation**: Hierarchical task delegation between agents
- **Error Recovery**: Built-in retry logic with failure analysis
- **Result Evaluation**: AI-powered judging to determine task success

**Workflows & Integration**
- Multi-step workflow execution with status tracking
- Arcade.ai integration for external toolkits and services
- OAuth2-based authorization for external services
- Multiple OpenAI models with advanced prompt engineering

## Project Structure

```
botholomew/
├── backend/          # Bun-based API server
│   ├── actions/      # API endpoint implementations
│   ├── models/       # Database models (Drizzle)
│   ├── ops/          # Business logic operations
│   ├── middleware/   # Authentication & validation
│   ├── initializers/ # Service initialization (Arcade, OpenAI)
│   └── __tests__/    # Comprehensive test suite
├── frontend/         # Next.js React application
│   ├── components/   # Reusable React components
│   ├── pages/        # Application pages/routes
│   ├── lib/          # Client-side utilities
│   └── public/       # Static assets
└── package.json      # Monorepo configuration
```

## Development Features

Botholomew emphasizes modern development practices:

- **Type Safety**: Full TypeScript coverage across frontend and backend
- **Testing**: Comprehensive test suite with mocked dependencies
- **Code Quality**: Prettier for formatting, ESLint for linting
- **Developer Tools**: Hot reload, API documentation via Swagger
- **Monorepo**: Unified dependency management and scripts
- **Error Handling**: Structured error types with proper HTTP status codes
- **Security**: Session-based authentication with middleware protection
- **Performance**: Bun runtime for fast execution, Redis for caching

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

### Core Technologies
- **Runtime**: Bun for fast JavaScript/TypeScript execution
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Cache/Queues**: Redis for caching and background job processing
- **WebSocket**: Real-time bidirectional communication
- **API**: RESTful endpoints with comprehensive validation

### Key Features
- **Agent Management**: CRUD operations for AI agents with user isolation
- **Toolkit Integration**: Dynamic loading of Arcade.ai toolkits
- **Workflow Engine**: Multi-step workflow execution with status tracking
- **Authentication**: Session-based auth with middleware protection
- **Error Handling**: Comprehensive error types with proper HTTP status codes
- **Testing**: Full test suite with mocked dependencies
- **API Documentation**: Swagger UI for endpoint exploration

## Frontend

The frontend is a Next.js application with:

### Core Technologies
- **Framework**: Next.js 15 with App Router
- **UI**: React 19 + TypeScript for type-safe component development
- **Styling**: Bootstrap 5 + React-Bootstrap for responsive design
- **Real-time**: WebSocket integration for live updates

### Key Features
- **Agent Dashboard**: Create, edit, and manage AI agents
- **Toolkit Management**: Authorize and configure external toolkits
- **Workflow Monitoring**: Real-time workflow execution status
- **Server Status**: Live server health monitoring
- **Message Logging**: Interactive message log with filtering
- **Responsive Design**: Mobile-friendly Bootstrap-based UI
- **Environment Config**: Dynamic server configuration (`NEXT_PUBLIC_SERVER_HOSTNAME`)

## Database Schema

Botholomew uses PostgreSQL with the following core entities:

### Core Tables
- **`agents`**: AI agent configurations (name, model, prompts, toolkits, etc.)
- **`users`**: User management with authentication
- **`toolkit_authorizations`**: User permissions for external tool access
- **`workflows`**: Multi-step workflow definitions
- **`workflow_runs`**: Workflow execution instances with status tracking
- **`workflow_run_steps`**: Individual step execution within workflows

### Key Features
- **User Isolation**: All entities are scoped to individual users
- **Toolkit Security**: Explicit authorization required for external tool access
- **Workflow Tracking**: Complete audit trail of workflow executions
- **Type Safety**: Drizzle ORM ensures type-safe database operations
- **Migrations**: Version-controlled schema changes

## API Documentation

Once the backend is running, you can access:

- Swagger UI: `http://localhost:8080/swagger.html`
- WebSocket Test: `http://localhost:8080/test-ws.html`
