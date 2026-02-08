import { useEffect, useRef } from "react";
import { createChart, LineSeries, type IChartApi, ColorType } from "lightweight-charts";
import { useApi } from "../hooks/use-api";
import { usePnlChartData } from "../hooks/use-chart-data";

interface TradeRecord {
  price: number;
  size: number;
  side: string;
  match_time?: string;
}

export function PnlChart() {
  const { data: trades } = useApi<TradeRecord[]>("/api/trades?limit=500", 30000);
  const chartData = usePnlChartData(trades);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#1a1a2e" },
        textColor: "#8888aa",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
      },
      grid: {
        vertLines: { color: "#2a2a4a" },
        horzLines: { color: "#2a2a4a" },
      },
      width: containerRef.current.clientWidth,
      height: 300,
      rightPriceScale: {
        borderColor: "#2a2a4a",
      },
      timeScale: {
        borderColor: "#2a2a4a",
      },
    });

    const series = chart.addSeries(LineSeries, {
      color: "#448aff",
      lineWidth: 2,
      crosshairMarkerBackgroundColor: "#448aff",
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
    });

    if (chartData.length > 0) {
      series.setData(chartData as any);
      chart.timeScale().fitContent();
    }

    chartRef.current = chart;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [chartData]);

  if (!trades || trades.length === 0) {
    return <div className="card empty-state">No trade data yet</div>;
  }

  return <div className="chart-container" ref={containerRef} />;
}
