import { Database } from "bun:sqlite";
import type { Position, Trade, OrderRequest } from "../types";

export interface IStore {
  savePosition(position: Position): void;
  getPosition(tokenId: string): Position | null;
  getAllPositions(): Position[];
  saveTrade(trade: Trade & { strategyId: string }): void;
  getTrades(tokenId?: string, limit?: number): (Trade & { strategyId: string })[];
  saveOrder(order: OrderRequest & { orderId: string; status: string }): void;
  updateOrderStatus(orderId: string, status: string): void;
  getOpenOrders(): (OrderRequest & { orderId: string; status: string })[];
  getDailyPnl(date: Date): number;
  close(): void;
}

export class SQLiteStore implements IStore {
  private db: Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS positions (
        token_id TEXT PRIMARY KEY,
        market TEXT NOT NULL,
        size REAL NOT NULL,
        avg_entry_price REAL NOT NULL,
        current_price REAL NOT NULL,
        unrealized_pnl REAL NOT NULL,
        realized_pnl REAL NOT NULL,
        side TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        token_id TEXT NOT NULL,
        market TEXT NOT NULL,
        side TEXT NOT NULL,
        size REAL NOT NULL,
        price REAL NOT NULL,
        fee_rate_bps TEXT,
        status TEXT NOT NULL,
        match_time TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        token_id TEXT NOT NULL,
        side TEXT NOT NULL,
        price REAL NOT NULL,
        size REAL NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        expiration INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(match_time)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
  }

  savePosition(position: Position): void {
    this.db.run(
      `INSERT OR REPLACE INTO positions
       (token_id, market, size, avg_entry_price, current_price, unrealized_pnl, realized_pnl, side, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        position.tokenId,
        position.market,
        position.size,
        position.avgEntryPrice,
        position.currentPrice,
        position.unrealizedPnl,
        position.realizedPnl,
        position.side,
        new Date().toISOString(),
      ]
    );
  }

  getPosition(tokenId: string): Position | null {
    const row = this.db
      .query<{ token_id: string; market: string; size: number; avg_entry_price: number; current_price: number; unrealized_pnl: number; realized_pnl: number; side: string }, [string]>(
        "SELECT * FROM positions WHERE token_id = ?"
      )
      .get(tokenId);
    if (!row) return null;
    return {
      tokenId: row.token_id,
      market: row.market,
      size: row.size,
      avgEntryPrice: row.avg_entry_price,
      currentPrice: row.current_price,
      unrealizedPnl: row.unrealized_pnl,
      realizedPnl: row.realized_pnl,
      side: row.side as Position["side"],
    };
  }

  getAllPositions(): Position[] {
    const rows = this.db
      .query<{ token_id: string; market: string; size: number; avg_entry_price: number; current_price: number; unrealized_pnl: number; realized_pnl: number; side: string }, []>(
        "SELECT * FROM positions WHERE size != 0"
      )
      .all();
    return rows.map((row) => ({
      tokenId: row.token_id,
      market: row.market,
      size: row.size,
      avgEntryPrice: row.avg_entry_price,
      currentPrice: row.current_price,
      unrealizedPnl: row.unrealized_pnl,
      realizedPnl: row.realized_pnl,
      side: row.side as Position["side"],
    }));
  }

  saveTrade(trade: Trade & { strategyId: string }): void {
    this.db.run(
      `INSERT OR REPLACE INTO trades
       (id, strategy_id, token_id, market, side, size, price, fee_rate_bps, status, match_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trade.id,
        trade.strategyId,
        trade.asset_id,
        trade.market,
        trade.side,
        parseFloat(trade.size),
        parseFloat(trade.price),
        trade.fee_rate_bps,
        trade.status,
        trade.match_time,
        new Date().toISOString(),
      ]
    );
  }

  getTrades(tokenId?: string, limit = 100): (Trade & { strategyId: string })[] {
    const query = tokenId
      ? "SELECT * FROM trades WHERE token_id = ? ORDER BY match_time DESC LIMIT ?"
      : "SELECT * FROM trades ORDER BY match_time DESC LIMIT ?";
    const params = tokenId ? [tokenId, limit] : [limit];
    const rows = this.db
      .query<{ id: string; strategy_id: string; token_id: string; market: string; side: string; size: number; price: number; fee_rate_bps: string; status: string; match_time: string }, typeof params>(query)
      .all(...params);
    return rows.map((row) => ({
      id: row.id,
      strategyId: row.strategy_id,
      asset_id: row.token_id,
      market: row.market,
      side: row.side as Trade["side"],
      size: String(row.size),
      price: String(row.price),
      fee_rate_bps: row.fee_rate_bps,
      status: row.status,
      match_time: row.match_time,
      taker_order_id: "",
      last_update: "",
      outcome: "",
      bucket_index: 0,
      owner: "",
      maker_address: "",
      maker_orders: [],
      transaction_hash: "",
      trader_side: "TAKER",
    }));
  }

  saveOrder(order: OrderRequest & { orderId: string; status: string }): void {
    this.db.run(
      `INSERT OR REPLACE INTO orders
       (order_id, token_id, side, price, size, type, status, expiration, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.orderId,
        order.tokenId,
        order.side,
        order.price,
        order.size,
        order.type,
        order.status,
        order.expiration ?? null,
        new Date().toISOString(),
        new Date().toISOString(),
      ]
    );
  }

  updateOrderStatus(orderId: string, status: string): void {
    this.db.run("UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ?", [
      status,
      new Date().toISOString(),
      orderId,
    ]);
  }

  getOpenOrders(): (OrderRequest & { orderId: string; status: string })[] {
    const rows = this.db
      .query<{ order_id: string; token_id: string; side: string; price: number; size: number; type: string; status: string; expiration: number | null }, []>(
        "SELECT * FROM orders WHERE status IN ('pending', 'open')"
      )
      .all();
    return rows.map((row) => ({
      orderId: row.order_id,
      tokenId: row.token_id,
      side: row.side as OrderRequest["side"],
      price: row.price,
      size: row.size,
      type: row.type as OrderRequest["type"],
      status: row.status,
      expiration: row.expiration ?? undefined,
    }));
  }

  getDailyPnl(date: Date): number {
    const dateStr = date.toISOString().split("T")[0];
    const row = this.db
      .query<{ total_pnl: number }, [string]>(
        `SELECT COALESCE(SUM(
          CASE WHEN side = 'BUY' THEN -(size * price) ELSE (size * price) END
        ), 0) as total_pnl FROM trades WHERE DATE(match_time) = ?`
      )
      .get(dateStr);
    return row?.total_pnl ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
