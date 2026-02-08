import { useState, useCallback } from "react";
import { useApi } from "../hooks/use-api";
import { useWsEvent, useSnapshot } from "../hooks/use-websocket";

interface ArbStats {
  evaluations: number;
  skippedNoGroup: number;
  skippedMissingBook: number;
  skippedStaleBook: number;
  simpleArbSignals: number;
  bregmanArbSignals: number;
  noArbFound: number;
}

interface ArbMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

interface SignalEvent {
  tokenId: string;
  side: string;
  confidence: number;
  targetPrice: number;
  size: number;
  reason: string;
}

export function ArbMonitor() {
  const { data: statsData } = useApi<ArbStats>("/api/arb/stats", 10000);
  const snapshot = useSnapshot();
  const [signals, setSignals] = useState<{ time: string; signal: SignalEvent }[]>([]);

  // Use snapshot data if available, fall back to API poll
  const stats = (snapshot?.arbStats as ArbStats) ?? statsData;
  const metrics = (snapshot?.arbMetrics as ArbMetrics) ?? null;

  useWsEvent("strategy_signal", useCallback((data: unknown) => {
    const signal = data as SignalEvent;
    setSignals((prev) => [
      { time: new Date().toLocaleTimeString(), signal },
      ...prev.slice(0, 49),
    ]);
  }, []));

  if (!stats) return <div className="empty-state">bregman-arb strategy not active</div>;

  const fullChecks = stats.evaluations - stats.skippedNoGroup - stats.skippedMissingBook - stats.skippedStaleBook;

  return (
    <>
      <div className="section-title">Evaluation Funnel</div>
      <div className="funnel" style={{ marginBottom: 20 }}>
        <div className="funnel-step">
          <span className="funnel-count">{stats.evaluations}</span>
          <span className="funnel-label">Total Evaluations</span>
        </div>
        <div className="funnel-step">
          <span className="funnel-count">{stats.evaluations - stats.skippedNoGroup}</span>
          <span className="funnel-label">Has Market Group</span>
        </div>
        <div className="funnel-step">
          <span className="funnel-count">{stats.evaluations - stats.skippedNoGroup - stats.skippedMissingBook}</span>
          <span className="funnel-label">Books Available</span>
        </div>
        <div className="funnel-step">
          <span className="funnel-count">{fullChecks}</span>
          <span className="funnel-label">Fresh (not stale)</span>
        </div>
        <div className="funnel-step">
          <span className="funnel-count positive">{stats.simpleArbSignals + stats.bregmanArbSignals}</span>
          <span className="funnel-label">Signals Generated</span>
        </div>
      </div>

      {metrics && (
        <>
          <div className="section-title">Arb Metrics</div>
          <div className="metric-row">
            <div className="metric-item">
              <div className="metric-label">PnL</div>
              <div className={`metric-value ${metrics.totalPnl >= 0 ? "positive" : "negative"}`}>
                ${metrics.totalPnl.toFixed(2)}
              </div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Sharpe</div>
              <div className="metric-value">{metrics.sharpeRatio.toFixed(2)}</div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Max Drawdown</div>
              <div className="metric-value negative">${metrics.maxDrawdown.toFixed(2)}</div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Simple Arbs</div>
              <div className="metric-value">{stats.simpleArbSignals}</div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Bregman Arbs</div>
              <div className="metric-value">{stats.bregmanArbSignals}</div>
            </div>
            <div className="metric-item">
              <div className="metric-label">No Arb Found</div>
              <div className="metric-value neutral">{stats.noArbFound}</div>
            </div>
          </div>
        </>
      )}

      <div className="section-title">Live Signals</div>
      <div className="card">
        {signals.length === 0 ? (
          <div className="empty-state">Waiting for signals...</div>
        ) : (
          <div className="signal-feed">
            {signals.map((s, i) => (
              <div className="signal-item" key={i}>
                <span className="signal-time">{s.time}</span>
                <span className={`signal-badge ${s.signal.side.toLowerCase()}`}>
                  {s.signal.side}
                </span>
                <span className="mono" style={{ color: "var(--text-primary)" }}>
                  {s.signal.tokenId.slice(0, 10)}...
                </span>
                <span className="mono" style={{ color: "var(--text-secondary)" }}>
                  @{s.signal.targetPrice.toFixed(4)}
                </span>
                <span className="mono" style={{ color: "var(--text-secondary)" }}>
                  x{s.signal.size.toFixed(1)}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: "auto" }}>
                  {s.signal.reason}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
