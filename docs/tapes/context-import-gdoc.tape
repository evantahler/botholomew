Source docs/tapes/_common.tape
Output docs/assets/context-import-gdoc.gif

# Demo: importing a Google Doc into context/. The fetcher uses an LLM
# loop (mcp_search → mcp_exec → accept_content) — fixture-driven under
# BOTHOLOMEW_FAKE_LLM=1 so the whole flow is hermetic. After the import
# settles, list context to show the new file landed under google-docs/.

Sleep 800ms
Type "botholomew context import https://docs.google.com/document/d/1abcDEFv08launchplan/edit"
Sleep 400ms
Enter
Sleep 20s

Type "botholomew context tree"
Sleep 400ms
Enter
Sleep 4s
