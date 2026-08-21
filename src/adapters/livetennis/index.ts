import type { SignalAdapter, AdapterContext, AdapterDescriptor } from "../../types/adapter";
import type { Signal } from "../../types/signal";
import { Events } from "../../types";

/**
 * Maps a live tennis match to the Polymarket token whose YES outcome
 * resolves on a given player winning.
 */
export interface LiveTennisMarketMapping {
  /** Live Tennis API match id (matched against `id` in the feed). */
  matchId: string | number;
  /** Polymarket token id whose YES outcome = the mapped player wins. */
  tokenId: string;
  /** Which player of the match the token's YES outcome represents. */
  player: 1 | 2;
}

export interface LiveTennisAdapterConfig {
  /** API base URL. Default: https://api.livetennisapi.com/api/public/v1 */
  baseUrl: string;
  /** Path of the live-matches endpoint, appended to baseUrl. Default: /matches/live */
  livePath: string;
  /** Poll interval in ms. Default: 15_000 (4 req/min — within the free tier). */
  refreshIntervalMs: number;
  /** Confidence emitted on a break-point momentum signal [0,1]. Default: 0.6. */
  breakPointConfidence: number;
  /** Confidence emitted on a match-terminal risk signal [0,1]. Default: 0.9. */
  terminalConfidence: number;
  /** How long emitted signals stay valid (ms). Default: 90_000. */
  signalTtlMs: number;
  /** Status strings that count as "in play". Default: ["live"]. */
  liveStatuses: string[];
  /**
   * Status strings that void the live edge (match over / walkover / suspended).
   * Default: ["completed", "cancelled", "retired", "walkover", "suspended"].
   */
  terminalStatuses: string[];
  /** Match → token mappings the adapter watches. */
  markets: LiveTennisMarketMapping[];
}

const DEFAULT_CONFIG: LiveTennisAdapterConfig = {
  baseUrl: "https://api.livetennisapi.com/api/public/v1",
  livePath: "/matches/live",
  refreshIntervalMs: 15_000,
  breakPointConfidence: 0.6,
  terminalConfidence: 0.9,
  signalTtlMs: 90_000,
  liveStatuses: ["live"],
  terminalStatuses: ["completed", "cancelled", "retired", "walkover", "suspended"],
  markets: [],
};

interface LiveTennisPlayer {
  name: string;
}

interface LiveTennisScore {
  sets?: number[];
  games?: number[][];
  /** Per-player game points, e.g. ["40", "AD"] or [null, null]. Index 0 = p1. */
  points?: (string | null)[];
  /** Player currently serving: 1, 2, or null. */
  server?: number | null;
  is_tiebreak?: boolean;
}

interface LiveTennisMatch {
  id: string | number;
  players?: { p1?: LiveTennisPlayer; p2?: LiveTennisPlayer };
  status?: string;
  score?: LiveTennisScore;
}

interface LiveMatchesResponse {
  data?: LiveTennisMatch[];
}

/** Payload for a break-point momentum "trade" signal. Carries no market price — live match-state has none; strategies price at their own book. */
export interface LiveTennisTradePayload {
  side: "BUY" | "SELL";
  matchId: string | number;
  player1: string;
  player2: string;
  /** Which player of the match the mapped token's YES outcome represents. */
  tokenPlayer: 1 | 2;
  /** Which player currently holds the break point. */
  breakPointFor: "p1" | "p2";
  scoreline: string;
  reason: string;
}

/** Payload for a match-terminal "risk" signal — live edge is gone / outcome deciding. */
export interface LiveTennisRiskPayload {
  matchId: string | number;
  player1: string;
  player2: string;
  status: string;
  reason: string;
}

/** Three-valued break-point state per the documented rule. */
type BreakPointState = "p1" | "p2" | null;

const RECEIVER_ADVANTAGE = new Set(["40", "AD"]);
const SERVER_BEHIND = new Set(["0", "15", "30"]);

/**
 * Emits live tennis match-state signals onto the signal bus.
 *
 * Data source: Live Tennis API (livetennisapi.com) — a live-tennis DATA feed.
 * This adapter is NOT a venue or execution path: it only reads public
 * match-state and publishes typed Signal objects that strategies may gate on.
 *
 * Signals emitted:
 *   - kind "trade": break-point momentum toward the receiving player, mapped
 *     to BUY/SELL of the configured token (fires once per break-point onset).
 *   - kind "risk":  the match reached a terminal/void state (completed,
 *     retired, walkover, suspended, cancelled) — the live edge is gone and the
 *     outcome is deciding, so the SignalAwareStrategy suppresses sizing.
 */
export class LiveTennisAdapter implements SignalAdapter {
  readonly name = "livetennis";
  readonly version = "1.0.0";

  private config: LiveTennisAdapterConfig = { ...DEFAULT_CONFIG };
  private ctx?: AdapterContext;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private healthy = true;
  private warnedNoKey = false;
  /** Last break-point state emitted per match id ("p1" | "p2" | "none"). */
  private lastBreakState = new Map<string, string>();
  /** Match ids for which a terminal risk signal has already been emitted. */
  private emittedTerminal = new Set<string>();

  async initialize(ctx: AdapterContext): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...(ctx.config as Partial<LiveTennisAdapterConfig>) };
    this.stopped = false;
    ctx.logger.info("LiveTennisAdapter initialized", {
      markets: this.config.markets.length,
      baseUrl: this.config.baseUrl,
    });
  }

  async start(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    await this.poll();
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        ctx.logger.error("LiveTennis poll error", { error: String(err) });
        this.healthy = false;
      });
    }, this.config.refreshIntervalMs);
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  diagnostics(): Record<string, unknown> {
    return {
      markets: this.config.markets.length,
      trackedMatches: this.lastBreakState.size,
      terminalEmitted: this.emittedTerminal.size,
      healthy: this.healthy,
    };
  }

  private async poll(): Promise<void> {
    if (this.stopped || !this.ctx) return;

    const apiKey = Bun.env.LIVETENNIS_API_KEY;
    if (!apiKey) {
      if (!this.warnedNoKey) {
        this.ctx.logger.warn("LiveTennisAdapter: LIVETENNIS_API_KEY not set — skipping polls");
        this.warnedNoKey = true;
      }
      return;
    }
    if (this.config.markets.length === 0) return;

    const url = `${this.config.baseUrl}${this.config.livePath}`;

    let matches: LiveTennisMatch[];
    try {
      const resp = await fetch(url, {
        headers: { "X-API-Key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        this.ctx.logger.warn("LiveTennis API non-200", { status: resp.status });
        if (resp.status === 401 || resp.status === 403) this.healthy = false;
        return;
      }
      const data = (await resp.json()) as LiveMatchesResponse;
      matches = data.data ?? [];
      this.healthy = true;
    } catch {
      this.ctx.logger.warn("LiveTennis fetch failed");
      this.healthy = false;
      return;
    }

    const byId = new Map(matches.map((m) => [String(m.id), m]));
    for (const market of this.config.markets) {
      const match = byId.get(String(market.matchId));
      if (!match) continue; // not currently live
      this.processMatch(market, match);
    }
  }

  /** Evaluate one mapped match and emit signals on state transitions. */
  private processMatch(market: LiveTennisMarketMapping, match: LiveTennisMatch): void {
    if (!this.ctx) return;
    const matchId = String(match.id);
    const status = (match.status ?? "").toLowerCase();

    // Terminal / void state → one-shot risk signal.
    if (this.config.terminalStatuses.includes(status)) {
      if (!this.emittedTerminal.has(matchId)) {
        this.emittedTerminal.add(matchId);
        this.lastBreakState.delete(matchId);
        this.emitRisk(market, match, status);
      }
      return;
    }

    // Only act while the match is in play.
    if (!this.config.liveStatuses.includes(status)) return;

    const bp = LiveTennisAdapter.breakPointState(match.score);
    const stateKey = bp ?? "none";
    const prev = this.lastBreakState.get(matchId);
    this.lastBreakState.set(matchId, stateKey);

    // Emit only on the onset of a break point (a new BP state).
    if (bp && stateKey !== prev) {
      this.emitBreakPoint(market, match, bp);
    }
  }

  private emitBreakPoint(
    market: LiveTennisMarketMapping,
    match: LiveTennisMatch,
    breakPointFor: "p1" | "p2"
  ): void {
    if (!this.ctx) return;
    const p1 = match.players?.p1?.name ?? "p1";
    const p2 = match.players?.p2?.name ?? "p2";
    // Break point favours the receiver; BUY the token if it maps to that
    // player, SELL if it maps to the opponent.
    const side: "BUY" | "SELL" = breakPointFor === `p${market.player}` ? "BUY" : "SELL";
    const favoured = breakPointFor === "p1" ? p1 : p2;

    const signal: Signal<LiveTennisTradePayload> = {
      id: crypto.randomUUID(),
      kind: "trade",
      source: this.name,
      tokenId: market.tokenId,
      confidence: clamp01(this.config.breakPointConfidence),
      payload: {
        side,
        matchId: match.id,
        player1: p1,
        player2: p2,
        tokenPlayer: market.player,
        breakPointFor,
        scoreline: LiveTennisAdapter.scoreline(match.score),
        reason: `Break point for ${favoured} — momentum toward player ${breakPointFor.slice(1)}`,
      },
      timestamp: new Date(),
      expiresAt: new Date(Date.now() + this.config.signalTtlMs),
      metadata: { match: `${p1} vs ${p2}` },
    };

    this.ctx.events.emit(Events.SIGNAL_EMITTED, signal);
    this.ctx.logger.debug("LiveTennis break-point signal", {
      matchId: match.id,
      breakPointFor,
      side,
    });
  }

  private emitRisk(
    market: LiveTennisMarketMapping,
    match: LiveTennisMatch,
    status: string
  ): void {
    if (!this.ctx) return;
    const p1 = match.players?.p1?.name ?? "p1";
    const p2 = match.players?.p2?.name ?? "p2";

    const signal: Signal<LiveTennisRiskPayload> = {
      id: crypto.randomUUID(),
      kind: "risk",
      source: this.name,
      tokenId: market.tokenId,
      confidence: clamp01(this.config.terminalConfidence),
      payload: {
        matchId: match.id,
        player1: p1,
        player2: p2,
        status,
        reason: `Match ${status} — live edge gone, outcome deciding`,
      },
      timestamp: new Date(),
      expiresAt: new Date(Date.now() + this.config.signalTtlMs),
      metadata: { match: `${p1} vs ${p2}` },
    };

    this.ctx.events.emit(Events.SIGNAL_EMITTED, signal);
    this.ctx.logger.info("LiveTennis terminal risk signal", { matchId: match.id, status });
  }

  /**
   * Three-valued break-point flag from a score object, per the published rule:
   * a break point exists when the RECEIVER is at "40" or "AD" while the SERVER
   * is at "0", "15", or "30". Never in a tiebreak. Returns the receiver holding
   * the break point ("p1" | "p2"), or null when there is none or the state is
   * undefined (missing server/points, tiebreak).
   */
  static breakPointState(score?: LiveTennisScore): BreakPointState {
    if (!score || score.is_tiebreak) return null;
    const server = score.server;
    if (server !== 1 && server !== 2) return null;
    const points = score.points;
    if (!points || points.length < 2) return null;

    const serverIdx = server - 1;
    const receiverIdx = server === 1 ? 1 : 0;
    const serverPts = points[serverIdx];
    const receiverPts = points[receiverIdx];
    if (serverPts == null || receiverPts == null) return null;

    if (RECEIVER_ADVANTAGE.has(receiverPts) && SERVER_BEHIND.has(serverPts)) {
      return receiverIdx === 0 ? "p1" : "p2";
    }
    return null;
  }

  /** Best-effort compact human scoreline for signal payloads (informational). */
  static scoreline(score?: LiveTennisScore): string {
    if (!score) return "";
    const games = Array.isArray(score.games)
      ? score.games
          .map((g) => (Array.isArray(g) ? `${g[0] ?? 0}-${g[1] ?? 0}` : ""))
          .filter(Boolean)
          .join(" ")
      : "";
    const pts = score.points;
    const pointStr = pts && pts.length >= 2 ? ` (${pts[0] ?? "-"}-${pts[1] ?? "-"})` : "";
    return `${games}${pointStr}`.trim();
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export const liveTennisDescriptor: AdapterDescriptor = {
  name: "livetennis",
  version: "1.0.0",
  description:
    "Polls the Live Tennis API for live match-state and emits break-point momentum (trade) and match-terminal (risk) signals.",
  factory: (_config) => new LiveTennisAdapter(),
};
