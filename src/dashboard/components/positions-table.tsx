import { useApi } from "../hooks/use-api";

interface Position {
  tokenId: string;
  market: string;
  size: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  side: string;
}

export function PositionsTable() {
  const { data: positions, loading } = useApi<Position[]>("/api/positions", 5000);

  if (loading && !positions) return <div className="loading">Loading positions...</div>;
  if (!positions?.length) return <div className="card empty-state">No open positions</div>;

  return (
    <>
      {/* Desktop table */}
      <div className="card table-wrapper mobile-table">
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Side</th>
              <th>Size</th>
              <th>Entry</th>
              <th>Current</th>
              <th>Unrealized PnL</th>
              <th>Realized PnL</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.tokenId}>
                <td>{p.tokenId.slice(0, 12)}...</td>
                <td>
                  <span className={p.side === "BUY" ? "positive" : "negative"}>{p.side}</span>
                </td>
                <td>{Math.abs(p.size).toFixed(2)}</td>
                <td>${p.avgEntryPrice.toFixed(4)}</td>
                <td>${p.currentPrice.toFixed(4)}</td>
                <td className={p.unrealizedPnl >= 0 ? "positive" : "negative"}>
                  ${p.unrealizedPnl.toFixed(2)}
                </td>
                <td className={p.realizedPnl >= 0 ? "positive" : "negative"}>
                  ${p.realizedPnl.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card layout */}
      <div className="mobile-cards data-cards">
        {positions.map((p) => (
          <div className="card data-card" key={p.tokenId}>
            <div className="data-card-header">
              <span className="mono" style={{ fontSize: 12 }}>{p.tokenId.slice(0, 14)}...</span>
              <span className={`signal-badge ${p.side === "BUY" ? "buy" : "sell"}`}>{p.side}</span>
            </div>
            <span className="data-card-label">Size</span>
            <span className="data-card-value">{Math.abs(p.size).toFixed(2)}</span>
            <span className="data-card-label">Entry</span>
            <span className="data-card-value">${p.avgEntryPrice.toFixed(4)}</span>
            <span className="data-card-label">Current</span>
            <span className="data-card-value">${p.currentPrice.toFixed(4)}</span>
            <span className="data-card-label">Unreal. PnL</span>
            <span className={`data-card-value ${p.unrealizedPnl >= 0 ? "positive" : "negative"}`}>
              ${p.unrealizedPnl.toFixed(2)}
            </span>
            <span className="data-card-label">Real. PnL</span>
            <span className={`data-card-value ${p.realizedPnl >= 0 ? "positive" : "negative"}`}>
              ${p.realizedPnl.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
