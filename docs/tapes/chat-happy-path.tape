Source docs/tapes/_common.tape
Output docs/assets/chat-happy-path.gif

# Showcase: user asks about their schedule → agent searches MCPX for a
# calendar tool → agent calls it → synthesizes today's events.
# Three fake-LLM turns emit mcp_search, mcp_exec, and a final synthesis.
Sleep 800ms
Type "botholomew chat --no-daemon"
Sleep 600ms
Enter
Sleep 4s

# Backticks are required — double-quoted strings drop chars through ttyd.
Type `what is my schedule today`
Sleep 600ms
Enter
Sleep 16s
