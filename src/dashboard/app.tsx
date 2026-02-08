import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WebSocketProvider } from "./hooks/use-websocket";
import { Layout } from "./components/layout";
import { StatusBar } from "./components/status-bar";
import { StrategyCards } from "./components/strategy-cards";
import { ArbMonitor } from "./components/arb-monitor";
import { PnlChart } from "./components/pnl-chart";
import { PositionsTable } from "./components/positions-table";
import { OrdersTable } from "./components/orders-table";
import { RiskPanel } from "./components/risk-panel";
import { TradeLog } from "./components/trade-log";
import { MarketGroups } from "./components/market-groups";
import "./styles.css";

function OverviewTab() {
  return (
    <>
      <div className="section">
        <div className="section-title">Strategies</div>
        <StrategyCards />
      </div>
      <div className="section">
        <div className="section-title">Cumulative PnL</div>
        <PnlChart />
      </div>
      <div className="section">
        <div className="section-title">Positions</div>
        <PositionsTable />
      </div>
      <div className="section">
        <div className="section-title">Recent Trades</div>
        <TradeLog />
      </div>
    </>
  );
}

function ArbTab() {
  return (
    <>
      <div className="section">
        <ArbMonitor />
      </div>
      <div className="section">
        <div className="section-title">Open Orders</div>
        <OrdersTable />
      </div>
      <div className="section">
        <div className="section-title">Market Groups</div>
        <MarketGroups />
      </div>
    </>
  );
}

function RiskTab() {
  return (
    <div className="section">
      <RiskPanel />
    </div>
  );
}

function App() {
  const [tab, setTab] = useState("overview");

  return (
    <WebSocketProvider>
      <Layout activeTab={tab} onTabChange={setTab} statusBar={<StatusBar />}>
        {tab === "overview" && <OverviewTab />}
        {tab === "arb" && <ArbTab />}
        {tab === "risk" && <RiskTab />}
      </Layout>
    </WebSocketProvider>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
