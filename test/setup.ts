// No global test setup is needed now that the embedding pipeline lives in
// membot and is warmed lazily per-test (via setupTestMembot in test/helpers.ts).
// The previous setup pre-loaded a shared @huggingface/transformers cache;
// that responsibility now belongs to membot's own test harness.
export {};
