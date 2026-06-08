/**
 * The reflection ("dream") instructions. Shared by the built-in `/dream` chat
 * command and the `botholomew dream` CLI so both run the exact same
 * consolidation. The CLI appends a precise time window (and, for `--dry-run`,
 * a propose-only directive) after this body.
 *
 * This is intentionally a built-in constant — not a seeded `skills/*.md` file —
 * so reflection behaves consistently and can't be silently broken by edits.
 */
export const DREAM_PROMPT_BODY = `You are about to *dream*: review your recent conversations and consolidate what you learned into durable memory.

Work through these steps, using your existing tools:

1. **Recall.** Use \`list_threads\` and \`search_threads\` to find recent conversations (chat sessions and worker ticks), then \`view_thread\` to read the ones that look substantive. Focus on the most recent window — by default the last day or so, or everything since your most recent prior reflection (look for \`reflections/\` in the knowledge store with \`membot_tree\`).

2. **Distill.** Pull out the durable facts, decisions, outcomes, and preferences worth keeping — not the chatter. Write a concise reflection into the knowledge store at \`reflections/<UTC-date>.md\` (e.g. \`reflections/2026-06-07.md\`) using \`membot_write\`. Note the project these came from so reflections from different projects don't blur together. Store genuinely reusable facts under their natural \`logical_path\` too, not only in the reflection log.

3. **Self-edit.** Read \`prompts/goals.md\` and \`prompts/beliefs.md\` with \`prompt_read\`. If your recent work justifies it, apply focused updates with \`prompt_edit\` (git-style line patches) — add a newly learned belief, mark a goal done, refine a stale one. Make small, well-justified edits; don't rewrite wholesale. \`prompt_edit\` refuses files marked \`agent-modification: false\`, which is fine — skip them.

4. **Report.** Finish with a short audit summary: which threads you reviewed, what you stored in the knowledge store, and which prompt edits you made (or chose not to make).`;
