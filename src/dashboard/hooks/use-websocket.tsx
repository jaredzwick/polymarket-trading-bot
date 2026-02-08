import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";

interface WsMessage {
  type: string;
  event?: string;
  data?: unknown;
  timestamp?: string;
}

interface WebSocketContextValue {
  connected: boolean;
  lastMessage: WsMessage | null;
  send: (data: unknown) => void;
}

const WebSocketContext = createContext<WebSocketContextValue>({
  connected: false,
  lastMessage: null,
  send: () => {},
});

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => setConnected(true);

    ws.onmessage = (e) => {
      try {
        setLastMessage(JSON.parse(e.data));
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => ws.close();

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return (
    <WebSocketContext value={{ connected, lastMessage, send }}>
      {children}
    </WebSocketContext>
  );
}

export function useWebSocket() {
  return useContext(WebSocketContext);
}

export function useWsEvent(eventType: string, handler: (data: unknown) => void) {
  const { lastMessage } = useWebSocket();

  useEffect(() => {
    if (lastMessage?.type === "event" && lastMessage.event === eventType) {
      handler(lastMessage.data);
    }
  }, [lastMessage, eventType, handler]);
}

export function useSnapshot() {
  const { lastMessage } = useWebSocket();
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (lastMessage?.type === "snapshot") {
      setSnapshot(lastMessage.data as Record<string, unknown>);
    }
  }, [lastMessage]);

  return snapshot;
}
