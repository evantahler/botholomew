import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

export interface FakeTurn {
  /** Optional regex matched against the most recent user-authored text. */
  match?: string;
  /** Full reply text; auto-chunked if `chunks` is absent. */
  text?: string;
  /** Explicit token chunks; overrides auto-chunking. */
  chunks?: string[];
  /** Characters per auto-chunk when `chunks` is absent. */
  chunkSize?: number;
  /** Delay between chunks in milliseconds. */
  delayMs?: number;
  /** Optional tool calls to emit after text. */
  toolCalls?: Array<{
    id?: string;
    name: string;
    input: Record<string, unknown>;
  }>;
}

export interface FakeFixture {
  turns: FakeTurn[];
}

let loadedFixture: FakeFixture | null = null;
let loadedFixturePath: string | undefined;
let sequentialIndex = 0;

function loadFixture(): FakeFixture {
  const fixturePath = process.env.BOTHOLOMEW_FAKE_LLM_FIXTURE;
  // Reload (and reset the sequential cursor) whenever the fixture path
  // changes — tests rotate fixtures between cases, and callers can swap
  // fixtures mid-session without restarting the process.
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
  // Only consider turns at or after the cursor, so that multi-turn fixtures
  // (e.g. text → tool_use → follow-up text) advance past a matched turn even
  // when the agent's next iteration shows the same user text.
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
  // Out of turns — repeat the last one so the agent loop doesn't spin.
  return fixture.turns[fixture.turns.length - 1] ?? { text: "" };
}

function chunkText(text: string, size: number): string[] {
  if (size <= 0 || text.length === 0) return text ? [text] : [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function buildFinalMessage(
  text: string,
  toolCalls?: FakeTurn["toolCalls"],
): Message {
  const content: Array<Record<string, unknown>> = [];
  if (text) content.push({ type: "text", text, citations: null });
  if (toolCalls) {
    for (const tc of toolCalls) {
      content.push({
        type: "tool_use",
        id: tc.id ?? `toolu_${Math.random().toString(36).slice(2, 14)}`,
        name: tc.name,
        input: tc.input,
      });
    }
  }
  return {
    id: `msg_${Math.random().toString(36).slice(2, 14)}`,
    type: "message",
    role: "assistant",
    model: "botholomew-fake-llm",
    content,
    stop_reason: toolCalls?.length ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: Math.max(1, Math.floor(text.length / 4)),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      service_tier: "standard",
      server_tool_use: null,
    },
  } as unknown as Message;
}

class FakeMessageStream extends EventEmitter {
  private resolveFinal: (m: Message) => void = () => {};
  private readonly finalPromise: Promise<Message>;

  constructor(private readonly turn: FakeTurn) {
    super();
    this.finalPromise = new Promise<Message>((resolve) => {
      this.resolveFinal = resolve;
    });
    queueMicrotask(() => this.run());
  }

  private async run(): Promise<void> {
    const text = this.turn.text ?? this.turn.chunks?.join("") ?? "";
    const chunks =
      this.turn.chunks ?? chunkText(text, this.turn.chunkSize ?? 6);
    const delay = this.turn.delayMs ?? 40;
    for (const chunk of chunks) {
      this.emit("text", chunk);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
    const final = buildFinalMessage(text, this.turn.toolCalls);
    for (const block of final.content) {
      if ((block as { type: string }).type === "tool_use") {
        this.emit("contentBlock", block as ToolUseBlock);
      }
    }
    this.resolveFinal(final);
  }

  finalMessage(): Promise<Message> {
    return this.finalPromise;
  }
}

function extractLastUserText(
  messages: Array<{ role?: string; content?: unknown }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

function isTitleGeneratorCall(system: unknown): boolean {
  return typeof system === "string" && /title generator/i.test(system);
}

export function createFakeAnthropicClient(): Anthropic {
  return {
    messages: {
      stream(params: {
        system?: unknown;
        messages: Array<{ role?: string; content?: unknown }>;
      }) {
        // Title generation runs in parallel with runChatTurn; don't let it
        // consume a fixture turn meant for the main conversation.
        if (isTitleGeneratorCall(params.system)) {
          return new FakeMessageStream({ text: "Chat session", delayMs: 0 });
        }
        const turn = selectTurn(extractLastUserText(params.messages));
        return new FakeMessageStream(turn);
      },
      async create(params: {
        system?: unknown;
        messages: Array<{ role?: string; content?: unknown }>;
      }): Promise<Message> {
        if (isTitleGeneratorCall(params.system)) {
          return buildFinalMessage("Chat session");
        }
        const turn = selectTurn(extractLastUserText(params.messages));
        return buildFinalMessage(
          turn.text ?? turn.chunks?.join("") ?? "",
          turn.toolCalls,
        );
      },
    },
  } as unknown as Anthropic;
}
