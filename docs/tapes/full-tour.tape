Source docs/tapes/_common.tape
Output docs/assets/full-tour.gif

# Boot the chat TUI, type the question into the input bar (not via -p), then
# let the fake LLM stream a tool-calling reply. After the reply settles,
# BOTHOLOMEW_CAPTURE_TAB_CYCLE (set by the fixture's env block) walks
# activeTab through 2 → 3 → 4 → 5 → 6 → 7 → 8 → 1 so a single recording
# covers every panel.
Sleep 800ms
Type "botholomew chat"
Sleep 600ms
Enter
Sleep 4s

# Backticks are required — double-quoted Type drops chars through ttyd.
Type `what is on my schedule today`
Sleep 500ms
Enter

# ≈6s of streamed tool calls + synthesis, then 8 tabs × 3s dwell = 24s.
# (Cycle starts after a 9s delay so the camera pans across panels almost
# immediately after the chat reply settles.)
Sleep 33s
