import { type MutableRefObject, useEffect, useState } from "react";
import type { ChatSession } from "../../chat/session.ts";
import { getThread } from "../../threads/store.ts";

export function useChatTitlePolling(
  ready: boolean,
  sessionRef: MutableRefObject<ChatSession | null>,
): {
  chatTitle: string | undefined;
  setChatTitle: (t: string | undefined) => void;
} {
  const [chatTitle, setChatTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!ready || !sessionRef.current) return;
    let mounted = true;

    const refreshTitle = async () => {
      const session = sessionRef.current;
      if (!session) return;
      const result = await getThread(session.projectDir, session.threadId);
      if (mounted && result?.thread.title) {
        setChatTitle(result.thread.title);
      }
    };

    refreshTitle();
    const interval = setInterval(refreshTitle, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [ready, sessionRef]);

  return { chatTitle, setChatTitle };
}
