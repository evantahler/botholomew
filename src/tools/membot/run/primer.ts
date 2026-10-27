export const HOST_API_PRIMER = `membot_run host API. Source is a JavaScript or type-stripped TypeScript function body.
Top-level await and return are supported. There is no Node, Bun, require, import, fetch, fs, process, or network.
Only the files and mcp globals below exist. Values crossing the sandbox must be JSON-serializable.

files — membot index (logical_path is a DB key, not a filesystem path):
  files.readJson(logicalPath) -> unknown
  files.readText(logicalPath) -> string
  files.writeJson(logicalPath, value, changeNote?) -> { logical_path, version_id, size_bytes }
  files.writeText(logicalPath, content, changeNote?) -> { logical_path, version_id, size_bytes }
  files.exists(logicalPath) -> boolean
  files.info(logicalPath) -> { logical_path, source_path, mime_type, size_bytes, version_id, last_refresh_status }
  files.list({ prefix?, limit?, offset? }) -> { entries, count }  // newest-first; limit defaults to 50, max 200
  files.search(query, { limit?, path_prefix? }) -> { hits }  // at most 20 hits: path, score, snippet

mcp — same servers and approval policy as mcp_exec:
  mcp.listTools(server?) -> { server, name, description }[]
  mcp.search(query) -> { server, tool, description, score }[]
  mcp.info(server, tool) -> { found, name, description, input_schema }
  mcp.exec(server, tool, args?) -> parsed JSON or string
  mcp.capture(server, tool, args, logicalPath) -> write ack only (use this for large dumps)

Rules:
  - Return a small value. Write large output with files.writeJson / output_logical_path.
  - Do not call an MCP tool once per record (bridge cap 256). Capture once, then compute locally.
  - Gated MCP calls pause for a human; denied calls throw and never execute.
  - Discover tools with mcp.search / mcp.info; do not guess arguments from descriptions.

Examples:
  const rows = await files.readJson('mcp/inbox.json');
  return rows.filter((r) => r.amount > 100);

  const [a, b] = await Promise.all([
    files.readJson('a.json'),
    files.readJson('b.json'),
  ]);
  return { a: a.length, b: b.length };

  const counts = {};
  for (const row of rows) {
    const day = String(row.ts).slice(0, 10);
    counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;

  await mcp.capture('gmail', 'list_messages', { q: 'newer_than:7d' }, 'mcp/inbox.json');
  const messages = await files.readJson('mcp/inbox.json');
  return messages.slice(0, 5).map((m) => ({ id: m.id, subject: m.subject }));

  const tools = await mcp.search('list issues');
  const info = await mcp.info(tools[0].server, tools[0].tool);
  return info.input_schema;`;
