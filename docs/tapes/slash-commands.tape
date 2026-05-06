Source docs/tapes/_common.tape
Output docs/assets/slash-commands.gif

# Demo: typing a slash command opens the autocomplete popup, and pressing
# Enter on a no-arg skill (e.g. /standup) submits it directly. The fake LLM
# responds with a believable standup roll-up of the seeded tasks.

Sleep 1s
Type "botholomew chat"
Sleep 600ms
Enter
Sleep 4s

# Backticks are required — double-quoted Type drops chars through ttyd.
# The popup is visible while typing; on Enter, /standup runs (no args).
Type `/standup`
Sleep 1500ms
Enter
Sleep 22s
