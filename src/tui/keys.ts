import type { TabId } from "./components/TabBar.tsx";

// Tab routing: Ctrl+<letter> jumps to a tab. Chosen for memorability — first
// available letter that doesn't collide with other Ctrl bindings (Ctrl+C exit,
// Ctrl+J/K/X/E queue ops on Chat).
//
// Help is bound to Ctrl+G rather than Ctrl+H because most terminals deliver
// Ctrl+H as ASCII 0x08 (backspace). Bonus: macOS Terminal.app and several
// other terminals map Ctrl+/ to BEL (0x07), the same byte as Ctrl+G — so this
// binding also catches the Ctrl+/ keystroke on those terminals "for free".
// We also accept "/" and "_" as fallbacks for terminals that deliver Ctrl+/
// as 0x1F or as the literal "/" with ctrl=true (Kitty keyboard protocol).
export const TAB_BY_CTRL_KEY: Record<string, TabId> = {
  a: 1, // ch[a]t
  o: 2, // t[o]ols
  n: 3, // co[n]text
  t: 4, // [t]asks
  e: 5, // thr[e]ads
  s: 6, // [s]chedules
  w: 7, // [w]orkers
  g: 8, // help (also catches Ctrl+/ on terminals that map it to BEL)
  "/": 8, // help (Kitty keyboard protocol)
  _: 8, // help (terminals that send Ctrl+/ as 0x1F)
};
