# Field notes

Botholomew started as a tool I built for myself, and building it taught
me a handful of things I didn't expect. Here they are — including the one
that didn't work.

## Workers and a real task system

I have a distributed-systems background, and I couldn't bring myself to
build "agents" as a pile of subagents that fan out and vanish. I took
some inspiration from OpenClaw — keep the agent alive, give it a
heartbeat — but I wanted a task system I could actually monitor. Durable tasks on disk, a queue, workers that
register and get reaped when they die, DAGs between tasks. The payoff I
didn't plan for: watching the agent spin up its own workers when it
decides it has parallel work to do. That one still delights me.

## Name your tools after bash

Once [`membot`](https://github.com/evantahler/membot) gave the agent an
address space that looks like a filesystem, I started naming its tools
after commands it already knows — `cat`, `ls`, `mv`, `grep`. Every such
tool description is prefixed with a machine-parseable tag,
`[[ bash equivalent command: <cmd> ]]`, ahead of the real description.
The effect was bigger than I expected. Correct tool use by Claude jumped
the moment I did this — the model has seen an enormous amount of bash, so
meet it where it already lives.

## Big content is the normal case

A lot of what comes back from a tool is huge. One of my test cases pulls
a few megabytes of JSON out of Huckleberry — baby-tracking data, because
I have a toddler and apparently now so does my agent. Stuffing that into
the context window is a great way to light money on fire. So large tool
responses get piped straight into the membot store, and the agent gets a
jq-style query tool (JSONata under the hood) to slice it down to just the
part it needs. It works through megabytes without ever holding them all
in context at once.

## TUIs are hard, and worth it

I spent way too long making the chat TUI feel responsive and obvious —
Ink and React in a terminal, redrawing on resize, a message queue,
streaming output, tool-call visualization. Far more than a "reasonable"
share of the total effort. I don't regret a minute of it. If something
feels off, [tell me](https://github.com/evantahler/botholomew/issues).

## Keep the chat history in context

Every chat thread lands in the knowledge store when it's done, which
means the agent can search its own past conversations later. `thread
search` turns "what did we decide about that last week?" into a real
query. Handy, and nearly free to build once the threads are already on
disk as CSVs.

## Some agent trends are overrated

I implemented "dreaming" — the knowledge-rollup loop where the agent
reflects on recent threads and consolidates what it learned. Fashionable
idea. In my implementation, at least, it mostly disappoints: it fixates
on _themes_ rather than facts, and themes aren't much use when I already
have the agent's prompts and beliefs sitting right there in plain files I
can read. I shipped it anyway (`/dream` and `botholomew dream`) because
it's occasionally useful and trivial to turn off. But I'd be lying if I
called it the best part.

Facts beat vibes.
