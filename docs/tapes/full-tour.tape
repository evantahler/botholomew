Source docs/tapes/_common.tape
Output docs/assets/full-tour.gif

# Boot the chat TUI, type the question into the input bar (not via -p), then
# let the fake LLM stream a tool-calling reply. After the reply settles,
# BOTHOLOMEW_CAPTURE_TAB_CYCLE (set by the fixture's env block) walks
# activeTab through 2 → 7 → 1 so a single recording covers every panel.
Sleep 800ms
Type "botholomew chat --no-daemon"
Sleep 600ms
Enter
Sleep 4s

# Backticks are required — double-quoted Type drops chars through ttyd.
Type `what is on my schedule today`
Sleep 500ms
Enter

# ≈6s of streamed tool calls + synthesis, then 7 tabs × 2.4s dwell = 16.8s.
Sleep 24s
