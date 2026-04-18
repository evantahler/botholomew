Source docs/tapes/_common.tape
Output docs/assets/slash-commands.gif

Sleep 1s
Type "botholomew chat --no-daemon"
Sleep 600ms
Enter
Sleep 4s

# Typing "/" opens the slash-command autocomplete popup. Under VHS+ttyd the
# first byte of each `Type` reliably reaches Ink; that one byte is enough to
# trigger the popup (the popup matches on prefix).
Type `/help`
Sleep 3s
