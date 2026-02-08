import { useWebSocket, useSnapshot } from "../hooks/use-websocket";

export function StatusBar() {
  const { connected } = useWebSocket();
  const snapshot = useSnapshot();

  const running = (snapshot?.running as boolean) ?? false;
  const positionCount = (snapshot?.positionCount as number) ?? 0;
  const orderCount = (snapshot?.orderCount as number) ?? 0;
  const risk = snapshot?.risk as { exposure?: { total?: number }; halted?: boolean } | null;
  const exposure = risk?.exposure?.total ?? 0;

  return (
    <div className="status-bar">
      <div className="status-item">
        <div className={`status-dot ${running ? "running" : "stopped"}`} />
        <span>{running ? "Running" : "Stopped"}</span>
      </div>
      <div className="status-item">
        <div className={`status-dot ${connected ? "connected" : "disconnected"}`} />
        <span>WS</span>
      </div>
      <div className="status-item">
        Positions: <span className="status-value">{positionCount}</span>
      </div>
      <div className="status-item">
        Orders: <span className="status-value">{orderCount}</span>
      </div>
      <div className="status-item">
        Exposure: <span className="status-value">${exposure.toFixed(2)}</span>
      </div>
      {risk?.halted && (
        <div className="status-item">
          <span style={{ color: "var(--red)", fontWeight: 700 }}>HALTED</span>
        </div>
      )}
    </div>
  );
}
