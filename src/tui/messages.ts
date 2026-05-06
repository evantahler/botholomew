// Conservative line reservation for the bottom chrome — StatusBar (1) +
// bordered InputBar (3) + multiline hint (1) + TabBar (1) + slack for the
// SlashCommandPopup or QueuePanel (~4). The chat-tab body's `maxHeight` and
// the panel boxes' `height` both subtract this from `rows` so the dynamic
// frame's total output stays strictly below the viewport.
export const FOOTER_RESERVE = 10;

let nextMsgId = 0;
export function msgId(): string {
  return `msg-${++nextMsgId}`;
}
