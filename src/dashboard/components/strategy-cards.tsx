import { useApi } from "../hooks/use-api";

interface StrategyInfo {
  name: string;
  enabled: boolean;
  metrics: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnl: number;
    sharpeRatio: number;
    maxDrawdown: number;
  };
}

interface StatusData {
  strategies: StrategyInfo[];
}

export function StrategyCards() {
  const { data, loading } = useApi<StatusData>("/api/status", 10000);

  if (loading && !data) return <div className="loading">Loading strategies...</div>;
  if (!data?.strategies?.length) return <div className="empty-state">No strategies active</div>;

  return (
    <div className="card-grid">
      {data.strategies.map((s) => {
        const winRate = s.metrics.totalTrades > 0
          ? ((s.metrics.winningTrades / s.metrics.totalTrades) * 100).toFixed(1)
          : "0.0";
        return (
          <div className="card strategy-card" key={s.name}>
            <div className="strategy-header">
              <span className="strategy-name">{s.name}</span>
              <span className={`strategy-badge ${s.enabled ? "enabled" : "disabled"}`}>
                {s.enabled ? "ENABLED" : "DISABLED"}
              </span>
            </div>
            <div className="strategy-stats">
              <span className="strategy-stat-label">Trades</span>
              <span className="strategy-stat-value">{s.metrics.totalTrades}</span>
              <span className="strategy-stat-label">PnL</span>
              <span className={`strategy-stat-value ${s.metrics.totalPnl >= 0 ? "positive" : "negative"}`}>
                ${s.metrics.totalPnl.toFixed(2)}
              </span>
              <span className="strategy-stat-label">Win Rate</span>
              <span className="strategy-stat-value">{winRate}%</span>
              <span className="strategy-stat-label">Sharpe</span>
              <span className="strategy-stat-value">{s.metrics.sharpeRatio.toFixed(2)}</span>
              <span className="strategy-stat-label">Max DD</span>
              <span className="strategy-stat-value negative">{s.metrics.maxDrawdown.toFixed(2)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
