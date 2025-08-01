# Frontend Testing

This directory contains smoke tests for the frontend application.

## Smoke Tests

The smoke tests verify that:

- The Next.js development server starts successfully
- The index page loads and returns a 200 status
- The page contains expected content (Botholomew branding)
- Proper HTML structure is present
- Correct content-type headers are returned

## Running Tests

### Run all tests

```bash
bun test
```

### Run only smoke tests

```bash
bun test:smoke
```

### Run specific smoke test file

```bash
bun test smoke.test.ts
```

## Test Details

The smoke test (`smoke.test.ts`) does the following:

1. **Server Startup**: Spawns a Next.js development server on port 3001
2. **Health Check**: Verifies the server process is running
3. **Page Load**: Fetches the index page and checks for 200 status
4. **Content Verification**: Ensures the page contains expected text content
5. **Header Validation**: Confirms proper content-type headers
6. **Structure Check**: Validates basic HTML structure is present
7. **Cleanup**: Properly terminates the server process

## Notes

- The test uses port 3001 to avoid conflicts with other development servers
- The test includes a 10-second timeout for server startup
- The server is automatically cleaned up after tests complete
- Tests use bun's built-in testing framework for optimal performance
