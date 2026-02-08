import { useApi } from "../hooks/use-api";
import { useSnapshot } from "../hooks/use-websocket";

interface RiskData {
  exposure: { total: number; byToken: Record<string, number> };
  limits: {
    maxPositionSize: number;
    maxTotalExposure: number;
    maxLossPerTrade: number;
    maxDailyLoss: number;
    maxOpenOrders: number;
  };
  halted: boolean;
  dailyPnl: number;
}

function Gauge({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const barColor = pct > 80 ? "var(--red)" : pct > 60 ? "var(--yellow)" : color;

  return (
    <div className="gauge">
      <div className="gauge-label">{label}</div>
      <div className="gauge-bar-bg">
        <div
          className="gauge-bar-fill"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <div className="gauge-values">
        <span>{value.toFixed(2)}</span>
        <span style={{ color: "var(--text-muted)" }}>{max.toFixed(2)}</span>
      </div>
    </div>
  );
}

export function RiskPanel() {
  const { data: riskData, loading } = useApi<RiskData>("/api/risk", 5000);
  const snapshot = useSnapshot();

  // Prefer snapshot data for freshness
  const snapshotRisk = snapshot?.risk as { exposure?: { total?: number }; halted?: boolean; dailyPnl?: number } | null;

  const risk = riskData;
  if (loading && !risk) return <div className="loading">Loading risk data...</div>;
  if (!risk) return <div className="empty-state">Risk data unavailable</div>;

  const exposure = snapshotRisk?.exposure?.total ?? risk.exposure.total;
  const halted = snapshotRisk?.halted ?? risk.halted;
  const dailyPnl = snapshotRisk?.dailyPnl ?? risk.dailyPnl;
  const orderCount = (snapshot?.orderCount as number) ?? 0;

  return (
    <>
      {halted && (
        <div className="alert-banner halt">TRADING HALTED - Risk breach detected</div>
      )}

      <div className="section-title">Risk Gauges</div>
      <div className="metric-row" style={{ marginBottom: 24 }}>
        <Gauge
          label="Exposure"
          value={exposure}
          max={risk.limits.maxTotalExposure}
          color="var(--blue)"
        />
        <Gauge
          label="Daily PnL"
          value={Math.abs(dailyPnl)}
          max={risk.limits.maxDailyLoss}
          color={dailyPnl >= 0 ? "var(--green)" : "var(--red)"}
        />
        <Gauge
          label="Open Orders"
          value={orderCount}
          max={risk.limits.maxOpenOrders}
          color="var(--purple)"
        />
      </div>

      <div className="section-title">Risk Limits</div>
      <div className="card table-wrapper" style={{ marginBottom: 24 }}>
        <table>
          <thead>
            <tr>
              <th>Limit</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Max Position Size</td>
              <td>${risk.limits.maxPositionSize.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Max Total Exposure</td>
              <td>${risk.limits.maxTotalExposure.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Max Loss Per Trade</td>
              <td>${risk.limits.maxLossPerTrade.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Max Daily Loss</td>
              <td>${risk.limits.maxDailyLoss.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Max Open Orders</td>
              <td>{risk.limits.maxOpenOrders}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section-title">Exposure by Token</div>
      {Object.keys(risk.exposure.byToken).length === 0 ? (
        <div className="card empty-state">No exposure</div>
      ) : (
        <div className="card table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Exposure</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(risk.exposure.byToken).map(([tokenId, value]) => (
                <tr key={tokenId}>
                  <td>{tokenId.slice(0, 16)}...</td>
                  <td>${(value as number).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
