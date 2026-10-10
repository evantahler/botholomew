# Phase 22 — LLM-assisted ingestion

> **Goal:** A project that connects a model and opts in gets smarter ingestion — images and embedded figures get
> captions, scanned PDFs and messy structured text get converted, and untitled files get a written description —
> on the project's own model, inside a budget an admin set, with every token recorded. A project that does not
> opt in loses nothing: ingestion stays deterministic and complete.

> **Status: planned, not built.** Stage F — Memory, later. Depends on [phase 5](./phase-05-bots.md) (BYOK
> connections and the named model registry), [phase 6](./phase-06-durable-bot-loop.md) (`backend/llm/`,
> `usage_events`, budgets, the fake model server), and [phase 9](./phase-09-memory-search-and-ingestion.md) (the
> converters, the describer, ingest jobs). Re-running on uploads gets better with
> [phase 23](./phase-23-original-bytes-and-blob-policy.md).

[Phase 9](./phase-09-memory-search-and-ingestion.md) ports membot's converters without the parts that call a
model, and that is the right default: every file becomes searchable markdown with no key, no spend, and nothing
leaving the deployment. It also leaves three holes membot filled with a model. An image is a placeholder. A
scanned PDF is `(scanned PDF, N bytes — no recognizable text)`. A file without a heading gets a description that
is its first two hundred characters. Search over those is search over noise.

membot fills them with a platform-wide `ANTHROPIC_API_KEY`. 2.0 has no platform key — models are BYOK, per
project — so every model call here goes through `backend/llm/` on the project's own connection, is off until an
admin turns it on, and degrades to exactly phase 9's output whenever it cannot run. The interesting decisions are
where it is allowed to spend, how much, and what it is never allowed to do: membot's own converter refuses to ask
a model to "convert" opaque binary bytes, because that path invents documents from file names, and that refusal
stays.

## Scope

**In:** columns on phase 4's `memory_settings` (opt-in, model choice, budgets, caps, excluded prefixes);
`backend/llm/ingestion.ts` with membot's three prompts; vision captions for images embedded
in HTML and DOCX, capped per document; model conversion of scanned PDFs (native document input only) and of
structured text; model-written descriptions when a file has no title; the caption path standalone image files will
use; model capability flags on `project_models`; the budget check, `usage_events` with `kind = 'ingestion'`, and threshold
notifications; enrichment provenance on every version; degraded-file tracking; `memory:enrich` to re-run; the
settings UI, CLI, user docs, and tests on the fake model server.

**Out:** a platform key, ever; cross-encoder reranking (later, unphased); a model choosing how to *fetch* (phases
19–21 stay deterministic); model-assisted chunking; audio and video; rendering PDF pages to images for models
without document input; any bot tool that spends the ingestion budget on demand.

## What already exists

| Piece | What it gives this work | Where |
|---|---|---|
| Image captions | `convertImage`: the retrieval-oriented caption prompt, the 4 MB vision ceiling, a 60 s per-call timeout, deterministic placeholders | [src/ingest/converter/image.ts](https://github.com/evantahler/membot/blob/main/src/ingest/converter/image.ts) |
| Embedded images | `extractDataUriImages` / `inlineImageCaptions`: one captioning path for HTML and DOCX, a per-document cap (default 20), caption blocks under `<!-- image: alt -->` | [src/ingest/converter/images-inline.ts](https://github.com/evantahler/membot/blob/main/src/ingest/converter/images-inline.ts) |
| Model conversion | `convertWithLlm`: the normalizing system prompt, "return clean markdown verbatim", fence stripping, raw-input fallback | [src/ingest/converter/llm.ts](https://github.com/evantahler/membot/blob/main/src/ingest/converter/llm.ts) |
| Where conversion may use a model | The dispatch table, and the rule that an unknown binary is never sent to a model | [src/ingest/converter/index.ts](https://github.com/evantahler/membot/blob/main/src/ingest/converter/index.ts) |
| Describer | H1-derived description first (`describer_skip_when_titled`), model second, deterministic last | [src/ingest/describer.ts](https://github.com/evantahler/membot/blob/main/src/ingest/describer.ts) |
| The LLM boundary | One importer of the AI SDK; models resolved at boundaries; the fast role | [src/llm/](https://github.com/evantahler/botholomew/tree/v1/src/llm), [src/config/models.ts](https://github.com/evantahler/botholomew/blob/v1/src/config/models.ts) |
| Capability probing | Per-model capability detection with an explicit override | [src/llm/capabilities.ts](https://github.com/evantahler/botholomew/blob/v1/src/llm/capabilities.ts) |
| Usage normalization | Cache-aware token accounting across providers | [src/llm/usage.ts](https://github.com/evantahler/botholomew/blob/v1/src/llm/usage.ts) |
| Pricing discipline | "A wrong price is worse than a missing one, and a silent zero is worst" | `toolexec:backend/ops/ModelPriceOps.ts` |
| Connections, `project_models` | The project's encrypted key and its `default` / `fast` models | [phase 5](./phase-05-bots.md) |
| `usage_events`, budgets, fake model server | The ledger and the test double | [phase 6](./phase-06-durable-bot-loop.md) |

## What this must not weaken

1. **BYOK only.** No ingestion call uses a platform key; an `ANTHROPIC_API_KEY` in the worker's environment is
   ignored (membot reads it — 2.0 must not).
2. **Off means off.** With enrichment disabled no document content leaves the deployment, and ingestion output is
   byte-identical to phase 9's.
3. **A model never invents a document.** Opaque binaries are never sent; only formats the provider natively
   reads (images, PDFs as documents) or text.
4. **Ingestion never fails because a model did.** Every model path has a deterministic fallback and a recorded
   reason.
5. **Spend is bounded and visible.** No call is made that the budget check refused, and every call is a
   `usage_events` row.
6. **Fetched stays fenced.** Text a model wrote about untrusted content is itself untrusted.
7. **No edit is overwritten** by a re-run.

## Design

### Opt-in, per project, and what it means

`memory_settings.llmEnabled` is false by default and only an admin can set it. Enabling it shows the sentence the
person is agreeing to, with the provider read from the connection: *document text, images, and scanned pages
from this project's memory will be sent to Anthropic under this project's key*. Three switches follow —
captions, conversion, descriptions — and `llmExcludePrefixes` (`hr/`, `legal/`) keeps whole subtrees
deterministic. Reserved namespaces (`skills/`, `prompts/`, `bots/`) are never enriched: they are authored
markdown with their own titles. Privacy is the project's business — the project is the boundary — so this is a
setting, not a platform rule; the platform's job is to make the default private and the choice explicit.

### One model, resolved where ingestion starts

The ingestion model is `memory_settings.llmModel`, a name in phase 5's registry, or the project's `fast` model
when unset. It is resolved once per ingest job, so an unknown name fails before any call, following v1's rule
that a function hard-wired to a role resolves internally. `project_models` gains `supportsImages` and
`supportsPdf`, defaulted from a curated list in `backend/llm/capabilities.ts` and overridable per model, as v1's
`supports_tools` is. Captions need images, scanned-PDF conversion needs PDF input; when the chosen model lacks a
capability that path degrades with reason `unsupported_by_model`, and the settings page says which paths the
current model can serve.

### Where each path runs

The model never replaces a converter; it fills holes the deterministic pass leaves, and the deterministic pass
always runs first.

| Hole | Deterministic (phase 9) | With a model |
|---|---|---|
| Images inside HTML / DOCX | Placeholders | Captions in document order, up to `llmMaxImageCaptionsPerDocument` (20); the rest get membot's "caption skipped" placeholder |
| Scanned PDF — fewer than 50 extracted characters per page | `(scanned PDF, …)` | The PDF as a native document, first `llmMaxPdfPagesPerDocument` (50) pages, output prefixed `<!-- converted from a scanned PDF by <model name>; may contain errors -->` |
| JSON / XML / YAML / CSV | A fenced code block (phase 9) | membot's normalizer, inputs up to 48 000 characters |
| No H1 in the opening | First heading + 200-character prefix | A one-paragraph description (membot's describer prompt, first 4 000 characters) |

A file with an H1 never calls the describer — membot's `describer_skip_when_titled`, fixed on rather than a
setting, because it is the main throughput and cost win in bulk ingest and turning it off buys little.

Standalone image files stay refused here, for phase 9's stated reason: without the original kept, accepting one
would discard the only copy and call it success. `captionImage` is built and tested now and becomes their surrogate
when [phase 23](./phase-23-original-bytes-and-blob-policy.md) keeps originals and opens image uploads.

Calls have membot's 60 s timeout and one retry on `429` / `5xx`. The ingest job's convert step runs on `default`
rather than `embed` whenever enrichment is on, so a slow provider never holds the CPU-bound embedding slots;
in-flight calls per project are capped by `llmConcurrency` (2), a Redis semaphore whose script lives in
`backend/lua/`.

### Budget, attribution, and the honest price

Before each call, `IngestionBudgetOps.allow(projectId, estimate)` checks this month's `kind = 'ingestion'`
usage plus the estimate (characters ÷ 4 plus `max_tokens` for text; a per-image and per-page token figure from
the provider table) against `llmMonthlyTokenBudget`, against `llmMonthlyBudgetUsd` when the model is priced, and
against the project's overall budget from phase 6. A refusal falls back with reason `budget`; admins are notified
once at 80% and once at 100% each month. An unpriced model is held to the token budget and the settings page shows
its spend as "unpriced" — never as $0.00.

Spend is attributed to the **project's ingestion budget**, not to the bot whose `memory_add` started the job:
the row's `botId` is null, so phase 6's per-bot sum never sees it while its per-project sum does. A
bot's conversation budget measures what it decides to do; charging it for the size of a PDF somebody linked would
make a bot's ability to talk depend on other people's files. The `usage_events` row still records
`requestedByUserId` / `requestedByBotId`, the job, and the path, so the usage dashboard can answer "who caused
this".

### Provenance and trust

Every version records `enrichment`: the model name, captions made and skipped, pages converted, whether the
structured text was normalized, whether the description was written by a model, and `degraded` with its reason
(`budget`, `unsupported_by_model`, `error`, `timeout`). The info panel shows it ("captions and description by
`fast` · 12 images"). The ingestion model sees content that may carry instructions; it has no tools, its output is
only ever stored text, and a version derived from an untrusted source stays `untrusted`
([phase 19](./phase-19-url-ingest.md)). The worst a hostile page can do is mislead its own caption, and that
caption is fenced.

### Re-running on demand

`memory:enrich` re-runs enrichment on a path or prefix (at most 500 files) with `dryRun` (default true) returning
the file count and a spend estimate. It writes a new version — `systemActor = 'enrich'`, note
`enrich: captions, description` — only when the surrogate or description actually changed, and only when the
current version is still the machine-written one; a file someone edited since is skipped and reported, never
overwritten. Descriptions can always be redone from the stored surrogate. Captions and conversion need the
original bytes: a remote or router file is re-fetched through [phase 20](./phase-20-upstream-refresh.md)'s forced
refresh; an upload is skipped with "re-upload to caption" until
[phase 23](./phase-23-original-bytes-and-blob-policy.md) keeps originals. `--degraded` targets files whose last
enrichment degraded — the "we ran out of budget last week" case.

## Steps

### 1. Schema — `backend/schema/{memory_settings,memory_files,project_models,usage_events}.ts`

Phase 4's `memory_settings` gains `llmEnabled` (false), `llmModel` (nullable registry name), `llmCaptions`, `llmConversion`, `llmDescriptions` (true),
`llmExcludePrefixes text[]`, `llmMonthlyBudgetUsd numeric` (5), `llmMonthlyTokenBudget integer` (2 000 000),
`llmMaxImageCaptionsPerDocument` (20), `llmMaxPdfPagesPerDocument` (50), and `llmConcurrency` (2).
`memory_files` gains `enrichment jsonb`; `systemActor` and `operation` gain `enrich`. `project_models` gains `supportsImages`,
`supportsPdf`. `usage_events.kind` (phase 6: `model_step`) gains `ingestion`, with new nullable `ingestJobId`,
`logicalPath`, `requestedByUserId`, and `requestedByBotId`; index `(projectId, kind, createdAt)` for the monthly
sum.

### 2. LLM — `backend/llm/ingestion.ts`, `backend/llm/capabilities.ts`

`captionImage`, `convertScannedPdf`, `normalizeStructured`, and `describeFile`, each taking the project's
resolved ingestion model and returning `{ text, usage } | { degraded }`, never throwing. membot's three prompts
are ported verbatim, so a quality difference is a model difference, not a prompt one. Provider image and
document limits live in `capabilities.ts`.

### 3. Ops — `backend/ops/{IngestionEnrichOps,IngestionBudgetOps}.ts`

- `enricherFor(projectId, job)` — `null` when disabled or excluded; otherwise the object phase 9's converters call
  where membot calls `convertImage` / `convertWithLlm` / `describe`.
- `IngestionBudgetOps.allow`, `record`, `monthToDate`, `notifyThresholds`.
- `enrichPaths(projectId, selector, { kinds, dryRun, degradedOnly })` — the re-run.

### 4. Actions — `backend/actions/memory/*.ts`

| Action | Route | Middleware | Audited | MCP |
|---|---|---|---|---|
| `memory-settings:view` (phase 4, widened) | `GET /memory/settings` | `ProjectMemberMiddleware()` | — | Yes |
| `memory-settings:edit` (phase 4, widened) | `POST /memory/settings` | `AdminMiddleware()` | Yes | Yes |
| `memory:enrich` | `POST /memory/enrich` | member + `canWritePath` | Yes (when not `dryRun`) | Yes |
| `memory:enrich-list` | `GET /memory/enrich/degraded` | `ProjectMemberMiddleware()` | — | Yes |

`memory:stats` gains month-to-date ingestion spend and the degraded count.

### 5. Bot tools

None new, deliberately: spending the ingestion budget is a person's call. `memory_info` reports `enrichment`, and
`memory_add` simply benefits from whatever the project has enabled.

### 6. Frontend — `frontend/src/components/settings/sections/MemoryIngestion.tsx`

Settings → **Memory ingestion**: the opt-in with its provider sentence, the model picker showing which paths it
supports, the three switches, excluded prefixes, both budgets with month-to-date spend, and the degraded list with
**Re-run**. The file info panel shows enrichment provenance; the file menu gains **Re-run enrichment** with its
estimate.

### 7. CLI — `cli/src/commands/memory.ts`

| Command | Notes |
|---|---|
| `botholomew memory settings [--llm on\|off] [--model name] [--budget-usd n] [--budget-tokens n] [--exclude prefix…]` | Show, or edit as admin |
| `botholomew memory enrich <path\|prefix> [--captions] [--convert] [--describe] [--degraded] [--apply]` | Dry run unless `--apply` |

### 8. User docs — `frontend/src/content/docs/memory.md`, `frontend/src/content/docs/security.md`

"Smarter ingestion with your model": what each path does, what is sent where, defaults, budgets, degraded files,
and re-running. `security.md` states that ingestion sends content only to the project's own provider, only when
an admin enables it.

### 9. Tests — `backend/__tests__/actions/memory-enrich.test.ts`

Against phase 6's fake model server, which accepts image and document parts:

- Disabled: ingesting an HTML page with five data-URI images makes **zero** model requests, and the surrogate
  equals phase 9's.
- Enabled: a page with 25 images makes 20 caption calls and five skip placeholders; a titled markdown file makes
  no describer call; an untitled one makes one.
- A scanned PDF goes to the model only when `supportsPdf`; otherwise it degrades with `unsupported_by_model`. An
  unknown binary is never sent.
- An exhausted token budget falls back with `degraded: budget` and notifies admins once; an unpriced model shows
  "unpriced", never zero.
- Every call writes one `usage_events` row with `kind = 'ingestion'` and the requesting bot, and the bot's own
  budget is unchanged.
- An `ANTHROPIC_API_KEY` in the environment with no project connection produces no call.
- An excluded prefix and `prompts/` make no calls; a timeout and a `500` fall back, after one retry for the `500`.
- `memory:enrich` writes a version only on change, skips an edited file, and refuses captions on a pre-originals
  upload with the re-upload hint; `dryRun` writes nothing.
- A caption of a fetched page's image is stored on an `untrusted` version.

## Verification

```bash
cd backend && bun run migrations && bun run lint && bun test
cd ../frontend && bun run lint && bun run build && bun test
cd ../cli && bun run lint && bun test
cd .. && bun dev
```

Manually, with a real provider connection on the project:

1. Upload a DOCX with screenshots and a scanned PDF with enrichment off: placeholders, as before.
2. Settings → Memory ingestion: enable, read the provider sentence, set a $1 budget. Re-upload both: the DOCX has
   captions where its images were, the PDF has text under the "may contain errors" note, and search finds words
   that appear only in the screenshots.
3. The info panel names the model and counts; Settings shows month-to-date spend matching the usage events.
4. Lower the budget below current spend and upload another scanned PDF: it lands deterministically, appears in
   the degraded list, and **Re-run** after raising the budget converts it.

Then the edge cases:

- Switch the ingestion model to one without PDF input: scanned PDFs degrade with that reason; captions still work.
- Exclude `finance/` and upload there: no calls.
- Edit an enriched file, then **Re-run**: skipped and reported.

## Definition of done

- [ ] `memory_settings` columns for opt-in, model, switches, exclusions, budgets, and caps; admin-only edits, audited
- [ ] `backend/llm/ingestion.ts` with membot's prompts; capability flags on `project_models`
- [ ] Captions (files and embedded, capped), scanned-PDF conversion (native input only), structured normalization, untitled descriptions
- [ ] Deterministic first and always as fallback; opaque binaries never sent; no platform or environment key
- [ ] Budget check before every call, `usage_events` with `kind = 'ingestion'`, threshold notifications, honest "unpriced"
- [ ] Enrichment provenance and degraded reasons on every version; `untrusted` carried
- [ ] `memory:enrich` with dry run, change-only versions, edit protection; `--degraded`
- [ ] Settings UI, info-panel provenance, CLI, user docs, tests as listed

## Learnings from the build

Not built yet. This section records what turns out to be load-bearing once the phase ships; until then the plan
above is the only account.
