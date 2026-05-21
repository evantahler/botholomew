import { existsSync, readFileSync } from "node:fs";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

export interface FakeTurn {
  /** Optional regex matched against the most recent user-authored text. */
  match?: string;
  /** Full reply text; auto-chunked if `chunks` is absent. */
  text?: string;
  /** Explicit text chunks; overrides auto-chunking. */
  chunks?: string[];
  /** Characters per auto-chunk when `chunks` is absent. */
  chunkSize?: number;
  /** Delay between chunks in milliseconds. */
  delayMs?: number;
  /** Initial wait before the first chunk emits, in milliseconds. */
  preDelayMs?: number;
  /** Optional tool calls to emit after text. */
  toolCalls?: Array<{
    id?: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  /** Optional usage/cache reporting. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  providerMetadata?: Record<string, Record<string, unknown>>;
}

export interface FakeFixture {
  turns: FakeTurn[];
}

let loadedFixture: FakeFixture | null = null;
let loadedFixturePath: string | undefined;
let sequentialIndex = 0;

function loadFixture(): FakeFixture {
  const fixturePath = process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE;
  if (loadedFixture && loadedFixturePath === fixturePath) {
    return loadedFixture;
  }
  loadedFixturePath = fixturePath;
  sequentialIndex = 0;
  if (!fixturePath) {
    loadedFixture = { turns: [] };
    return loadedFixture;
  }
  if (!existsSync(fixturePath)) {
    throw new Error(
      `BOTHOLOMEW_FAKE_LLM_FIXTURE points to missing file: ${fixturePath}`,
    );
  }
  loadedFixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FakeFixture;
  return loadedFixture;
}

function selectTurn(lastUserText: string): FakeTurn {
  const fixture = loadFixture();
  if (fixture.turns.length === 0) {
    return { text: "(fake LLM: no fixture turns configured)" };
  }
  for (let i = sequentialIndex; i < fixture.turns.length; i++) {
    const t = fixture.turns[i];
    if (t?.match && new RegExp(t.match, "i").test(lastUserText)) {
      sequentialIndex = i + 1;
      return t;
    }
  }
  if (sequentialIndex < fixture.turns.length) {
    const t = fixture.turns[sequentialIndex];
    sequentialIndex++;
    if (t) return t;
  }
  return fixture.turns[fixture.turns.length - 1] ?? { text: "" };
}

function chunkText(text: string, size: number): string[] {
  if (size <= 0 || text.length === 0) return text ? [text] : [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function extractLastUserText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return "";
  for (let i = prompt.length - 1; i >= 0; i--) {
    const m = prompt[i] as { role?: string; content?: unknown };
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        const p = part as { type?: string; text?: unknown };
        if (p.type === "text" && typeof p.text === "string") return p.text;
      }
    }
  }
  return "";
}

function isTitleGeneratorCall(prompt: unknown): boolean {
  if (!Array.isArray(prompt)) return false;
  for (const m of prompt) {
    const msg = m as { role?: string; content?: unknown };
    if (msg.role === "system" && typeof msg.content === "string") {
      return /title generator/i.test(msg.content);
    }
  }
  return false;
}

// biome-ignore lint/suspicious/noExplicitAny: V3StreamPart union too wide to enumerate
type StreamPart = any;

function buildStreamParts(turn: FakeTurn): StreamPart[] {
  const parts: StreamPart[] = [{ type: "stream-start", warnings: [] }];
  const text = turn.text ?? turn.chunks?.join("") ?? "";
  const chunks = turn.chunks ?? chunkText(text, turn.chunkSize ?? 6);

  const textId = "txt_0";
  if (text) {
    parts.push({ type: "text-start", id: textId });
    for (const chunk of chunks) {
      parts.push({ type: "text-delta", id: textId, delta: chunk });
    }
    parts.push({ type: "text-end", id: textId });
  }

  if (turn.toolCalls) {
    for (const tc of turn.toolCalls) {
      const id = tc.id ?? `toolu_${Math.random().toString(36).slice(2, 14)}`;
      parts.push({ type: "tool-input-start", id, toolName: tc.name });
      parts.push({
        type: "tool-call",
        toolCallId: id,
        toolName: tc.name,
        input: JSON.stringify(tc.input),
      });
    }
  }

  const unified = turn.toolCalls?.length ? "tool-calls" : "stop";
  const inTok = turn.usage?.inputTokens ?? 100;
  const outTok =
    turn.usage?.outputTokens ?? Math.max(1, Math.floor(text.length / 4));
  parts.push({
    type: "finish",
    finishReason: { unified, raw: unified },
    usage: {
      inputTokens: {
        total: inTok,
        noCache: inTok,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: { total: outTok, text: outTok, reasoning: 0 },
      totalTokens: inTok + outTok,
    },
    providerMetadata: turn.providerMetadata,
  });

  return parts;
}

export function createFakeLanguageModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    provider: "fake",
    modelId: "botholomew-fake-llm",
    doStream: async (options) => {
      const titleCall = isTitleGeneratorCall(options.prompt);
      const turn: FakeTurn = titleCall
        ? { text: "Chat session", delayMs: 0 }
        : selectTurn(extractLastUserText(options.prompt));

      const parts = buildStreamParts(turn);
      return {
        stream: simulateReadableStream({
          chunks: parts,
          initialDelayInMs: turn.preDelayMs ?? null,
          chunkDelayInMs: turn.delayMs ?? null,
        }),
      };
    },
    doGenerate: async (options) => {
      const titleCall = isTitleGeneratorCall(options.prompt);
      const turn: FakeTurn = titleCall
        ? { text: "Chat session" }
        : selectTurn(extractLastUserText(options.prompt));
      const text = turn.text ?? turn.chunks?.join("") ?? "";
      const content: Array<Record<string, unknown>> = [];
      if (text) content.push({ type: "text", text });
      if (turn.toolCalls) {
        for (const tc of turn.toolCalls) {
          const id =
            tc.id ?? `toolu_${Math.random().toString(36).slice(2, 14)}`;
          content.push({
            type: "tool-call",
            toolCallId: id,
            toolName: tc.name,
            input: JSON.stringify(tc.input),
          });
        }
      }
      const unified = turn.toolCalls?.length ? "tool-calls" : "stop";
      const inTok = turn.usage?.inputTokens ?? 100;
      const outTok =
        turn.usage?.outputTokens ?? Math.max(1, Math.floor(text.length / 4));
      return {
        content: content as never,
        finishReason: { unified, raw: unified },
        usage: {
          inputTokens: {
            total: inTok,
            noCache: inTok,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: outTok, text: outTok, reasoning: 0 },
          totalTokens: inTok + outTok,
        },
        warnings: [],
      };
    },
  });
}
