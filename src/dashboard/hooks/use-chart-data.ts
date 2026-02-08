import { useMemo } from "react";

interface TradeRecord {
  price: number;
  size: number;
  side: string;
  match_time?: string;
  strategyId?: string;
}

export interface ChartPoint {
  time: string;
  value: number;
}

export function usePnlChartData(trades: TradeRecord[] | null): ChartPoint[] {
  return useMemo(() => {
    if (!trades || trades.length === 0) return [];

    // Sort by time ascending
    const sorted = [...trades].sort((a, b) => {
      const ta = a.match_time ? new Date(a.match_time).getTime() : 0;
      const tb = b.match_time ? new Date(b.match_time).getTime() : 0;
      return ta - tb;
    });

    let cumPnl = 0;
    const points: ChartPoint[] = [];

    for (const trade of sorted) {
      // Approximate PnL: buy side is cost (negative), sell side is revenue (positive)
      const pnl = trade.side === "SELL" ? trade.price * trade.size : -(trade.price * trade.size);
      cumPnl += pnl;
      const time = trade.match_time
        ? new Date(trade.match_time).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      points.push({ time, value: Math.round(cumPnl * 100) / 100 });
    }

    // Deduplicate by time (keep last value per day)
    const byDay = new Map<string, ChartPoint>();
    for (const p of points) {
      byDay.set(p.time, p);
    }
    return Array.from(byDay.values());
  }, [trades]);
}
