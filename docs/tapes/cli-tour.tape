Source docs/tapes/_common.tape
Output docs/assets/cli-tour.gif

# Walk through the non-interactive CLI. Each command shows its output before
# the next one is typed. Keep lines short so they fit the recording width.
# The workdir is pre-seeded by scripts/capture.ts with 2 tasks, 1 schedule,
# and 1 context item — so `list` subcommands have visible rows from the go.

Sleep 800ms
Type "botholomew task list"
Sleep 400ms
Enter
Sleep 2s

Type "botholomew task add 'Plan offsite agenda' --description 'Gather topics from the team'"
Sleep 400ms
Enter
Sleep 1500ms

Type "botholomew schedule list"
Sleep 400ms
Enter
Sleep 2s

Type "botholomew membot tree"
Sleep 400ms
Enter
Sleep 3s

Type "botholomew thread list"
Sleep 400ms
Enter
Sleep 2s
