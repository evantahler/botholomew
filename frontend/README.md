# Botholomew Frontend

A modern Next.js frontend for the Botholomew Agent Framework, built with React, TypeScript, and Bootstrap.

## Features

- **Server Status Monitoring**: Real-time server status with auto-refresh
- **WebSocket Integration**: Live WebSocket connection status and message handling
- **Message Logging**: Interactive message log with filtering and management
- **Responsive Design**: Mobile-friendly Bootstrap-based UI
- **TypeScript**: Full type safety throughout the application

## Tech Stack

- **Next.js 15**: React framework with App Router
- **React 19**: Latest React with hooks and modern patterns
- **TypeScript**: Type-safe development
- **Bootstrap 5**: CSS framework for responsive design
- **React-Bootstrap**: Bootstrap components for React
- **Bun**: Fast JavaScript runtime and package manager

## Getting Started

### Prerequisites

- Node.js 18+ or Bun
- Botholomew backend running

### Environment Configuration

Create a `.env.local` file in the frontend directory:

```bash
# Copy the example file
cp .env.example .env.local

# Edit the file to set your server hostname
NEXT_PUBLIC_SERVER_HOSTNAME=http://localhost:8080
```

**Note:** The `NEXT_PUBLIC_` prefix is required for Next.js to expose the variable to the client-side code.

### Installation

```bash
# Install dependencies
bun install

# Run development server
bun run dev

# Build for production
bun run build

# Start production server
bun run start
```

### Development

The development server will start on `http://localhost:3000` by default.

## Project Structure

```
├── app/                   # Next.js App Router
│   ├── layout.tsx         # Root layout with Bootstrap CSS
│   ├── page.tsx           # Main dashboard page
│   └── globals.css        # Global styles
├── components/            # React components
│   ├── ServerStatus.tsx   # Server status monitoring
│   ├── WebSocketStatus.tsx # WebSocket connection status
│   └── MessageLog.tsx     # Message logging component
├── public/                # Static assets
│   ├── swagger.html       # Swagger UI
│   ├── test-ws.html       # WebSocket test page
│   └── css/               # Additional CSS files
└── package.json           # Dependencies and scripts
```

## Components

### ServerStatus

Monitors the backend server status with:

- Real-time status updates
- Auto-refresh every 30 seconds
- Detailed server metrics display
- Error handling and retry logic

### WebSocketStatus

Manages WebSocket connections with:

- Connection status monitoring
- Automatic reconnection
- Message handling
- Event callbacks for integration

### MessageLog

Provides message logging functionality:

- Real-time message display
- Message filtering by type
- Auto-scroll to latest messages
- Message management (clear, remove)
- Configurable message limits

## API Integration

The frontend integrates with the Botholomew backend API:

- **Server Status**: `GET /api/status`
- **WebSocket**: `WS /ws`
- **Swagger UI**: `/swagger.html`
- **WebSocket Test**: `/test-ws.html`

### Configuration

The frontend uses environment variables to configure server endpoints:

- `NEXT_PUBLIC_SERVER_HOSTNAME`: The base URL of the backend server (default: `http://localhost:8080`)

The configuration is handled by the `lib/config.ts` utility which provides:

- `getApiUrl()`: Helper for API endpoints
- `getWebSocketUrl()`: Helper for WebSocket connections
- Consistent server hostname usage across all environments

## Styling

The application uses Bootstrap 5 with custom styling:

- Custom primary color matching the original theme
- Responsive grid layout
- Modern card-based design
- Custom animations and hover effects

## Development Notes

- All components are client-side rendered with `'use client'` directive
- TypeScript interfaces ensure type safety
- React hooks for state management
- Forward refs for component communication
- ESLint configured for code quality

## Deployment

The application can be deployed to any platform that supports Next.js:

```bash
# Build the application
bun run build

# Start the production server
bun run start
```

For static deployment, the application can be exported as static files:

```bash
# Add to next.config.ts
const nextConfig = {
  output: 'export',
  trailingSlash: true,
};
```
