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
        <span>{typeof value === "number" && !Number.isInteger(value) ? value.toFixed(2) : value}</span>
        <span style={{ color: "var(--text-muted)" }}>
          {typeof max === "number" && !Number.isInteger(max) ? max.toFixed(2) : max}
        </span>
      </div>
    </div>
  );
}

const LIMIT_LABELS: Record<string, string> = {
  maxPositionSize: "Max Position Size",
  maxTotalExposure: "Max Total Exposure",
  maxLossPerTrade: "Max Loss Per Trade",
  maxDailyLoss: "Max Daily Loss",
  maxOpenOrders: "Max Open Orders",
};

export function RiskPanel() {
  const { data: riskData, loading } = useApi<RiskData>("/api/risk", 5000);
  const snapshot = useSnapshot();

  const snapshotRisk = snapshot?.risk as { exposure?: { total?: number }; halted?: boolean; dailyPnl?: number } | null;

  const risk = riskData;
  if (loading && !risk) return <div className="loading">Loading risk data...</div>;
  if (!risk) return <div className="empty-state">Risk data unavailable</div>;

  const exposure = snapshotRisk?.exposure?.total ?? risk.exposure.total;
  const halted = snapshotRisk?.halted ?? risk.halted;
  const dailyPnl = snapshotRisk?.dailyPnl ?? risk.dailyPnl;
  const orderCount = (snapshot?.orderCount as number) ?? 0;

  const tokenEntries = Object.entries(risk.exposure.byToken);

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
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="data-cards">
          {Object.entries(risk.limits).map(([key, val]) => (
            <div key={key} style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 0",
              borderBottom: "1px solid var(--border)",
            }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {LIMIT_LABELS[key] ?? key}
              </span>
              <span className="mono" style={{ fontSize: 13 }}>
                {key === "maxOpenOrders" ? val : `$${(val as number).toFixed(2)}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">Exposure by Token</div>
      {tokenEntries.length === 0 ? (
        <div className="card empty-state">No exposure</div>
      ) : (
        <div className="card">
          <div className="data-cards">
            {tokenEntries.map(([tokenId, value]) => (
              <div key={tokenId} style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderBottom: "1px solid var(--border)",
                gap: 8,
              }}>
                <span className="mono" style={{
                  fontSize: 12,
                  color: "var(--purple)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}>
                  {tokenId.slice(0, 16)}...
                </span>
                <span className="mono" style={{ fontSize: 13, flexShrink: 0 }}>
                  ${(value as number).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
