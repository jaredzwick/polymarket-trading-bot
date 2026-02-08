import { useState, useCallback } from "react";
import { useApi } from "../hooks/use-api";
import { useWsEvent } from "../hooks/use-websocket";

interface TradeRecord {
  tokenId: string;
  side: string;
  price: number;
  size: number;
  strategyId?: string;
  match_time?: string;
}

interface FillEvent {
  orderId: string;
  order: { tokenId: string; side: string; price: number; size: number };
  result: { filledSize?: number; avgFillPrice?: number };
}

function formatTime(iso?: string): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString();
}

export function TradeLog() {
  const { data: initialTrades } = useApi<TradeRecord[]>("/api/trades?limit=20");
  const [liveTrades, setLiveTrades] = useState<TradeRecord[]>([]);

  useWsEvent("order_filled", useCallback((data: unknown) => {
    const fill = data as FillEvent;
    setLiveTrades((prev) => [
      {
        tokenId: fill.order.tokenId,
        side: fill.order.side,
        price: fill.result.avgFillPrice ?? fill.order.price,
        size: fill.result.filledSize ?? fill.order.size,
        match_time: new Date().toISOString(),
      },
      ...prev.slice(0, 99),
    ]);
  }, []));

  const allTrades = [...liveTrades, ...(initialTrades ?? [])];

  if (allTrades.length === 0) return <div className="card empty-state">No trades yet</div>;

  const displayed = allTrades.slice(0, 50);

  return (
    <>
      {/* Desktop table */}
      <div className="card table-wrapper mobile-table">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Token</th>
              <th>Side</th>
              <th>Price</th>
              <th>Size</th>
              <th>Strategy</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((t, i) => (
              <tr key={i}>
                <td style={{ color: "var(--text-muted)" }}>{formatTime(t.match_time)}</td>
                <td>{t.tokenId.slice(0, 12)}...</td>
                <td>
                  <span className={t.side === "BUY" ? "positive" : "negative"}>{t.side}</span>
                </td>
                <td>${t.price.toFixed(4)}</td>
                <td>{t.size.toFixed(2)}</td>
                <td style={{ color: "var(--text-secondary)" }}>{t.strategyId ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card layout */}
      <div className="mobile-cards data-cards">
        {displayed.map((t, i) => (
          <div className="card data-card" key={i}>
            <div className="data-card-header">
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{formatTime(t.match_time)}</span>
              <span className={`signal-badge ${t.side === "BUY" ? "buy" : "sell"}`}>{t.side}</span>
            </div>
            <span className="data-card-label">Token</span>
            <span className="data-card-value">{t.tokenId.slice(0, 14)}...</span>
            <span className="data-card-label">Price</span>
            <span className="data-card-value">${t.price.toFixed(4)}</span>
            <span className="data-card-label">Size</span>
            <span className="data-card-value">{t.size.toFixed(2)}</span>
            {t.strategyId && (
              <>
                <span className="data-card-label">Strategy</span>
                <span className="data-card-value" style={{ color: "var(--text-secondary)" }}>{t.strategyId}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
