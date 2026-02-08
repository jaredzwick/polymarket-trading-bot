import type { ReactNode } from "react";

interface LayoutProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  statusBar: ReactNode;
  children: ReactNode;
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "arb", label: "Arb" },
  { id: "risk", label: "Risk" },
];

export function Layout({ activeTab, onTabChange, statusBar, children }: LayoutProps) {
  return (
    <div className="app-layout">
      <div className="sidebar">
        <div className="sidebar-title">POLYMARKET BOT</div>
        <nav className="sidebar-nav">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`nav-item ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      {statusBar}
      <div className="main-content">{children}</div>
    </div>
  );
}
