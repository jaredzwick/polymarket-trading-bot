import { useState, useCallback } from "react";
import { useApi } from "../hooks/use-api";
import { useWsEvent } from "../hooks/use-websocket";
import type { SignalKind } from "../../types/signal";

export interface SignalRecord {
  id: string;
  kind: SignalKind;
  source: string;
  tokenId?: string;
  confidence: number;
  timestamp: string;
  triggeringSignalIds?: string[];
  payload?: unknown;
  metadata?: Record<string, unknown>;
}

export interface OrderSignalLink {
  /** Signal IDs that triggered the order */
  signalIds: string[];
  orderId?: string;
  side: string;
  tokenId: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function confidenceColor(conf: number): string {
  if (conf >= 0.8) return "var(--green)";
  if (conf >= 0.5) return "var(--yellow)";
  return "var(--text-secondary)";
}

function KindBadge({ kind }: { kind: SignalKind }) {
  const colors: Record<SignalKind, string> = {
    trade: "buy",
    news: "",
    sentiment: "",
    inference: "",
    risk: "sell",
    custom: "",
  };
  return (
    <span className={`signal-badge ${colors[kind] ?? ""}`} style={{ background: kindBg(kind), color: kindFg(kind) }}>
      {kind}
    </span>
  );
}

function kindBg(kind: SignalKind): string {
  switch (kind) {
    case "trade": return "rgba(0,230,118,0.15)";
    case "risk": return "rgba(255,82,82,0.15)";
    case "news": return "rgba(68,138,255,0.15)";
    case "sentiment": return "rgba(179,136,255,0.15)";
    case "inference": return "rgba(255,215,64,0.15)";
    default: return "rgba(136,136,170,0.15)";
  }
}

function kindFg(kind: SignalKind): string {
  switch (kind) {
    case "trade": return "var(--green)";
    case "risk": return "var(--red)";
    case "news": return "var(--blue)";
    case "sentiment": return "var(--purple)";
    case "inference": return "var(--yellow)";
    default: return "var(--text-secondary)";
  }
}

function signalReason(signal: SignalRecord): string | null {
  if (!signal.payload) return null;
  const p = signal.payload as Record<string, unknown>;
  if (typeof p["reason"] === "string") return p["reason"];
  if (typeof p["output"] === "string") return p["output"].slice(0, 120);
  return null;
}

export function SignalsPanel() {
  const { data: initial } = useApi<SignalRecord[]>("/api/signals");
  const [liveSignals, setLiveSignals] = useState<SignalRecord[]>([]);
  // Map signal IDs → orderId for traceability
  const [orderLinks, setOrderLinks] = useState<Map<string, string>>(new Map());

  useWsEvent("signal_emitted", useCallback((data: unknown) => {
    const signal = data as SignalRecord;
    setLiveSignals((prev) => [signal, ...prev].slice(0, 20));
  }, []));

  useWsEvent("strategy_signal", useCallback((data: unknown) => {
    const tradeSignal = data as { tokenId: string; triggeringSignalIds?: string[] };
    if (!tradeSignal.triggeringSignalIds?.length) return;
    setOrderLinks((prev) => {
      const next = new Map(prev);
      for (const sid of tradeSignal.triggeringSignalIds!) {
        next.set(sid, tradeSignal.tokenId);
      }
      return next;
    });
  }, []));

  const allSignals = [...liveSignals, ...(initial ?? [])].slice(0, 20);

  if (allSignals.length === 0) {
    return <div className="card empty-state">No signals yet — adapters emit signals as they run.</div>;
  }

  return (
    <>
      {/* Desktop: signal feed */}
      <div className="card signal-feed mobile-table">
        {allSignals.map((s) => {
          const triggeredToken = orderLinks.get(s.id);
          const reason = signalReason(s);
          return (
            <div className="signal-item" key={s.id} data-testid="signal-item">
              <span className="signal-time">{formatTime(s.timestamp)}</span>
              <KindBadge kind={s.kind} />
              <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{s.source}</span>
              {s.tokenId && (
                <span style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "monospace" }}>
                  {s.tokenId.slice(0, 10)}…
                </span>
              )}
              <span
                style={{ color: confidenceColor(s.confidence), fontSize: 11, marginLeft: "auto" }}
                data-testid="confidence"
              >
                {(s.confidence * 100).toFixed(0)}%
              </span>
              {reason && <span className="signal-reason">{reason}</span>}
              {triggeredToken && (
                <span
                  className="signal-reason"
                  style={{ color: "var(--blue)", fontSize: 10 }}
                  data-testid="order-link"
                >
                  ↳ triggered order on {triggeredToken.slice(0, 10)}…
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: card layout */}
      <div className="mobile-cards data-cards">
        {allSignals.map((s) => {
          const triggeredToken = orderLinks.get(s.id);
          const reason = signalReason(s);
          return (
            <div className="card data-card" key={s.id}>
              <div className="data-card-header">
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{formatTime(s.timestamp)}</span>
                <KindBadge kind={s.kind} />
              </div>
              <span className="data-card-label">Source</span>
              <span className="data-card-value">{s.source}</span>
              <span className="data-card-label">Confidence</span>
              <span className="data-card-value" style={{ color: confidenceColor(s.confidence) }}>
                {(s.confidence * 100).toFixed(0)}%
              </span>
              {s.tokenId && (
                <>
                  <span className="data-card-label">Token</span>
                  <span className="data-card-value" style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {s.tokenId.slice(0, 14)}…
                  </span>
                </>
              )}
              {reason && (
                <>
                  <span className="data-card-label">Reason</span>
                  <span className="data-card-value" style={{ color: "var(--text-secondary)" }}>{reason}</span>
                </>
              )}
              {triggeredToken && (
                <span style={{ color: "var(--blue)", fontSize: 10, marginTop: 4, display: "block" }}>
                  ↳ triggered order on {triggeredToken.slice(0, 14)}…
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
