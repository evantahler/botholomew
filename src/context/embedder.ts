// Re-exports the real embedder implementation from `embedder-impl.ts`.
//
// Why the indirection: tests that touch code importing from this file (e.g.,
// `src/chat/agent.ts`, `src/worker/prompt.ts`) use Bun's `mock.module()` to
// stub the embedder so they don't hit OpenAI. Bun's module mocks are
// process-wide and can leak into subsequent test files. By keeping the real
// implementation in `embedder-impl.ts`, `test/context/embedder.test.ts` can
// import the real embedder from a path that nothing mocks.
export * from "./embedder-impl.ts";
