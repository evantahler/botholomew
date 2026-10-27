import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const CHECK_INTERVAL_MS = 10_000;

export function shouldBeIdle(
  lastActivity: number,
  now: number,
  timeoutMs: number,
): boolean {
  if (timeoutMs <= 0) return false;
  return now - lastActivity >= timeoutMs;
}

interface IdleContextValue {
  isIdle: boolean;
  markActivity: () => void;
}

const IdleContext = createContext<IdleContextValue>({
  isIdle: false,
  markActivity: () => {},
});

interface IdleProviderProps {
  timeoutMs: number;
  children: ReactNode;
}

export function IdleProvider({ timeoutMs, children }: IdleProviderProps) {
  const lastActivityRef = useRef(Date.now());
  const [isIdle, setIsIdle] = useState(false);
  const isIdleRef = useRef(isIdle);
  isIdleRef.current = isIdle;

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (isIdleRef.current) {
      setIsIdle(false);
    }
  }, []);

  useEffect(() => {
    if (timeoutMs <= 0) return;
    const id = setInterval(() => {
      const idle = shouldBeIdle(lastActivityRef.current, Date.now(), timeoutMs);
      setIsIdle((prev) => (prev === idle ? prev : idle));
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [timeoutMs]);

  return (
    <IdleContext.Provider value={{ isIdle, markActivity }}>
      {children}
    </IdleContext.Provider>
  );
}

export function useIdle(): IdleContextValue {
  return useContext(IdleContext);
}
