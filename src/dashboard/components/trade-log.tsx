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

  return (
    <div className="card table-wrapper">
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
          {allTrades.slice(0, 50).map((t, i) => (
            <tr key={i}>
              <td style={{ color: "var(--text-muted)" }}>
                {t.match_time ? new Date(t.match_time).toLocaleTimeString() : "-"}
              </td>
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
  );
}
