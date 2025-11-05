# Streaming Responses Implementation Plan

## Overview
Implement real-time streaming responses for agent executions using WebSockets. This will allow users to see agent output as it's generated, rather than waiting for the complete result.

## Architecture

### Current Flow
1. Frontend sends HTTP POST to `/agent/:id/run`
2. Backend executes agent synchronously
3. Backend returns complete result as JSON
4. Frontend displays complete result

### New Streaming Flow
1. Frontend establishes WebSocket connection
2. Frontend sends streaming action request via WebSocket
3. Backend executes agent with streaming support
4. Backend sends incremental updates via WebSocket
5. Frontend displays updates in real-time
6. Backend sends final result when complete

## Implementation Steps

### Phase 1: Backend Infrastructure

#### 1.1 Update Action Class
- Add optional `streaming?: boolean` property to `ActionConstructorInputs`
- Actions can declare if they support streaming
- Default to `false` for backward compatibility

#### 1.2 Extend Connection Class
- Add `streamingCallback?: (chunk: any) => Promise<void>` method
- Add `sendStreamingChunk(chunk: StreamingChunk)` method
- Handle streaming state management

#### 1.3 Define Streaming Message Protocol
Create types for streaming messages:
```typescript
type StreamingMessageType = 
  | "stream:start"
  | "stream:chunk" 
  | "stream:done"
  | "stream:error";

type StreamingChunk = {
  messageId: string | number;
  type: StreamingMessageType;
  data?: any;
  error?: any;
};
```

#### 1.4 Update WebServer WebSocket Handler
- Extend `handleWebsocketAction` to detect streaming actions
- If action supports streaming, call `connection.actStreaming()` instead of `connection.act()`
- Send streaming chunks back to client as they arrive

#### 1.5 Create Streaming Action Runner
- Add `actStreaming()` method to Connection class
- Similar to `act()` but:
  - Calls action's `runStreaming()` if available
  - Passes callback for sending chunks
  - Handles streaming errors gracefully

### Phase 2: Agent Streaming Support

#### 2.1 Investigate @openai/agents Streaming
- Check if `@openai/agents` library supports streaming
- If yes: Use library's streaming API
- If no: Implement wrapper around OpenAI SDK streaming directly

#### 2.2 Create Streaming AgentRun Function
- Create `agentRunStreaming()` in `AgentOps.ts`
- Accept streaming callback parameter
- Stream agent output chunks as they arrive
- Stream status updates (starting, processing, completed)
- Stream rationale and final result

#### 2.3 Create Streaming AgentRun Action
- Create `AgentRunStreaming` action class
- Extend `AgentRun` action
- Set `streaming: true`
- Implement `runStreaming()` method that uses `agentRunStreaming()`

### Phase 3: Frontend Infrastructure

#### 3.1 Create WebSocket Client Wrapper
- Create `frontend/lib/websocket.ts`
- Manage WebSocket connection lifecycle
- Handle reconnection logic
- Provide type-safe API for sending/receiving messages

#### 3.2 Extend APIWrapper
- Add `streaming<T>()` method for streaming actions
- Returns async generator or event emitter
- Handles WebSocket connection setup

#### 3.3 Create Streaming Hook
- Create `useStreamingAgentRun()` React hook
- Manages WebSocket connection
- Provides state: `{ streaming, chunks, result, error }`
- Handles cleanup on unmount

### Phase 4: Frontend UI Updates

#### 4.1 Update Agent View Page (`frontend/pages/agents/[id].tsx`)
- Add "Stream" toggle option
- When streaming enabled:
  - Use WebSocket instead of HTTP POST
  - Display chunks as they arrive
  - Show streaming indicator
  - Update result display incrementally

#### 4.2 Update Agent Edit Page (`frontend/pages/agents/edit/[id].tsx`)
- Same updates as view page
- Allow testing with streaming

#### 4.3 Create Streaming UI Components
- `StreamingIndicator` component
- `StreamingOutput` component (displays incremental updates)
- `StreamingControls` component (start/stop streaming)

### Phase 5: Testing & Error Handling

#### 5.1 Backend Tests
- Test streaming WebSocket messages
- Test error handling in streaming
- Test connection cleanup

#### 5.2 Frontend Tests
- Test WebSocket connection handling
- Test streaming UI updates
- Test error recovery

#### 5.3 Error Scenarios
- Handle WebSocket disconnection
- Handle agent execution errors during streaming
- Handle network timeouts
- Provide fallback to non-streaming mode

## Technical Details

### WebSocket Message Format

**Client → Server:**
```json
{
  "messageType": "action",
  "messageId": "unique-id",
  "action": "agent:run:stream",
  "params": {
    "id": 123,
    "additionalContext": "..."
  }
}
```

**Server → Client (Streaming):**
```json
{
  "messageId": "unique-id",
  "type": "stream:start",
  "data": {}
}
```

```json
{
  "messageId": "unique-id",
  "type": "stream:chunk",
  "data": {
    "chunk": "partial output...",
    "status": "processing"
  }
}
```

```json
{
  "messageId": "unique-id",
  "type": "stream:done",
  "data": {
    "status": "completed",
    "result": "final result",
    "rationale": "..."
  }
}
```

### Action Interface Changes

```typescript
export abstract class Action {
  // ... existing properties
  streaming?: boolean;
  
  // Existing method (unchanged)
  abstract run(
    params: ActionParams<Action>,
    connection?: Connection,
  ): Promise<any>;
  
  // New optional streaming method
  runStreaming?(
    params: ActionParams<Action>,
    connection: Connection,
    onChunk: (chunk: any) => Promise<void>,
  ): Promise<void>;
}
```

### Connection Changes

```typescript
export class Connection {
  // ... existing properties
  
  async actStreaming(
    actionName: string,
    params: FormData,
    method: Request["method"],
    url: string,
    onChunk: (chunk: StreamingChunk) => Promise<void>,
  ): Promise<void>;
}
```

## Migration Strategy

1. **Backward Compatible**: All existing actions continue to work without streaming
2. **Opt-in**: Streaming is opt-in per action (via `streaming: true`)
3. **Dual Mode**: Agent run pages support both streaming and non-streaming
4. **Graceful Degradation**: If WebSocket fails, fallback to HTTP POST

## Success Criteria

- [ ] Agent runs can stream output in real-time via WebSocket
- [ ] Frontend displays streaming output incrementally
- [ ] Error handling works correctly for streaming
- [ ] Backward compatibility maintained
- [ ] Tests pass for streaming functionality
- [ ] UI provides clear feedback during streaming

## Files to Create/Modify

### Backend
- `backend/classes/Action.ts` - Add streaming support
- `backend/classes/Connection.ts` - Add streaming methods
- `backend/servers/web.ts` - Handle streaming WebSocket messages
- `backend/ops/AgentOps.ts` - Add `agentRunStreaming()` function
- `backend/actions/agent.ts` - Add `AgentRunStreaming` action
- `backend/__tests__/actions/agent-streaming.test.ts` - Streaming tests

### Frontend
- `frontend/lib/websocket.ts` - WebSocket client wrapper
- `frontend/lib/api.ts` - Add streaming support
- `frontend/lib/hooks/useStreamingAgentRun.ts` - React hook
- `frontend/pages/agents/[id].tsx` - Add streaming UI
- `frontend/pages/agents/edit/[id].tsx` - Add streaming UI
- `frontend/components/StreamingOutput.tsx` - Streaming display component

## Next Steps

1. Start with Phase 1 (Backend Infrastructure)
2. Test WebSocket message handling
3. Move to Phase 2 (Agent Streaming)
4. Implement frontend in Phase 3 & 4
5. Add tests and polish in Phase 5
