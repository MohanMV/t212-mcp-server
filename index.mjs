#!/usr/bin/env node

/**
 * T212 MCP Server v2
 *
 * Matches the current Trading 212 Public API (v0) docs.
 * Uses Basic auth (API_KEY:API_SECRET base64-encoded).
 * Cursor-based pagination for history endpoints.
 *
 * Environment:
 *   T212_API_KEY    — your Trading 212 API key
 *   T212_API_SECRET — your Trading 212 API secret
 *   T212_ENV        — "live" (default) or "demo"
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_KEY = process.env.T212_API_KEY;
const API_SECRET = process.env.T212_API_SECRET;
const ENV = process.env.T212_ENV || "live";
const BASE_URL = `https://${ENV}.trading212.com`;

if (!API_KEY || !API_SECRET) {
  console.error("T212_API_KEY and T212_API_SECRET environment variables are required");
  process.exit(1);
}

// --- Auth ---

const BASIC_AUTH = `Basic ${Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64")}`;

// --- T212 API client ---

async function t212Fetch(path) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: BASIC_AUTH },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`T212 ${path}: ${res.status} — ${body}`);
  }
  return res.json();
}

/**
 * Fetches all pages from a paginated endpoint.
 * T212 uses cursor-based pagination with nextPagePath.
 */
async function t212FetchAll(path, maxItems = 200) {
  const allItems = [];
  let currentPath = path;

  while (currentPath && allItems.length < maxItems) {
    const data = await t212Fetch(currentPath);
    if (data.items) {
      allItems.push(...data.items);
    }
    currentPath = data.nextPagePath
      ? `${BASE_URL}${data.nextPagePath}`
      : null;
  }

  return allItems;
}

function jsonContent(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

// --- MCP Server ---

const server = new McpServer({
  name: "t212",
  version: "2.0.0",
});

// Tool: Get account summary
server.tool(
  "get_account",
  "Get account summary: cash available, invested capital, total value, realised/unrealised P&L",
  {},
  async () => {
    const summary = await t212Fetch("/api/v0/equity/account/summary");
    return jsonContent(summary);
  }
);

// Tool: Get all open positions
server.tool(
  "get_positions",
  "Get all open equity positions with current prices, P&L, quantity, and instrument info",
  {},
  async () => {
    const positions = await t212Fetch("/api/v0/equity/positions");

    const holdings = positions.map((p) => ({
      ticker: p.instrument?.ticker,
      name: p.instrument?.name,
      isin: p.instrument?.isin,
      instrumentCurrency: p.instrument?.currency,
      quantity: p.quantity,
      averagePricePaid: p.averagePricePaid,
      currentPrice: p.currentPrice,
      currentValue: p.walletImpact?.currentValue,
      totalCost: p.walletImpact?.totalCost,
      unrealizedPnL: p.walletImpact?.unrealizedProfitLoss,
      fxImpact: p.walletImpact?.fxImpact,
      walletCurrency: p.walletImpact?.currency,
      openedAt: p.createdAt,
    }));

    return jsonContent(holdings);
  }
);

// Tool: Get a single position by ticker
server.tool(
  "get_position",
  "Get a single open position by ticker symbol (e.g. AAPL_US_EQ)",
  {
    ticker: z.string().describe("T212 ticker symbol, e.g. AAPL_US_EQ"),
  },
  async ({ ticker }) => {
    const positions = await t212Fetch(
      `/api/v0/equity/positions?ticker=${encodeURIComponent(ticker)}`
    );
    if (!positions || positions.length === 0) {
      return { content: [{ type: "text", text: `No open position for ${ticker}` }] };
    }
    return jsonContent(positions[0]);
  }
);

// Tool: Get order history
server.tool(
  "get_orders",
  "Get historical equity orders (paginated, most recent first). Optionally filter by ticker.",
  {
    limit: z.number().optional().default(20).describe("Max orders to return (max 50 per page)"),
    ticker: z.string().optional().describe("Filter by ticker, e.g. AAPL_US_EQ"),
  },
  async ({ limit, ticker }) => {
    let path = `/api/v0/equity/history/orders?limit=${Math.min(limit, 50)}`;
    if (ticker) path += `&ticker=${encodeURIComponent(ticker)}`;

    const items = await t212FetchAll(path, limit);
    return jsonContent(items.slice(0, limit));
  }
);

// Tool: Get dividend history
server.tool(
  "get_dividends",
  "Get dividend payment history (paginated). Optionally filter by ticker.",
  {
    limit: z.number().optional().default(20).describe("Max dividend records (max 50 per page)"),
    ticker: z.string().optional().describe("Filter by ticker, e.g. AAPL_US_EQ"),
  },
  async ({ limit, ticker }) => {
    let path = `/api/v0/equity/history/dividends?limit=${Math.min(limit, 50)}`;
    if (ticker) path += `&ticker=${encodeURIComponent(ticker)}`;

    const items = await t212FetchAll(path, limit);
    return jsonContent(items.slice(0, limit));
  }
);

// Tool: Get transaction history
server.tool(
  "get_transactions",
  "Get account transaction history (deposits, withdrawals, etc.)",
  {
    limit: z.number().optional().default(20).describe("Max transactions to return"),
  },
  async ({ limit }) => {
    const path = `/api/v0/equity/history/transactions?limit=${Math.min(limit, 50)}`;
    const items = await t212FetchAll(path, limit);
    return jsonContent(items.slice(0, limit));
  }
);

// Tool: Get instruments metadata
server.tool(
  "get_instruments",
  "Get the full list of tradable instruments with tickers, names, and exchange info. Warning: large response.",
  {},
  async () => {
    const instruments = await t212Fetch("/api/v0/equity/metadata/instruments");
    return jsonContent({ count: instruments.length, instruments });
  }
);

// Tool: Get exchanges
server.tool(
  "get_exchanges",
  "Get list of available exchanges",
  {},
  async () => {
    const exchanges = await t212Fetch("/api/v0/equity/metadata/exchanges");
    return jsonContent(exchanges);
  }
);

// Tool: Portfolio summary (computed from positions + account)
server.tool(
  "get_portfolio_summary",
  "Computed portfolio summary: total value, P&L, allocation weights, top/bottom performers, concentration risk",
  {},
  async () => {
    const [positions, account] = await Promise.all([
      t212Fetch("/api/v0/equity/positions"),
      t212Fetch("/api/v0/equity/account/summary"),
    ]);

    const holdings = positions
      .map((p) => {
        const value = p.walletImpact?.currentValue || 0;
        const cost = p.walletImpact?.totalCost || 0;
        const pnl = p.walletImpact?.unrealizedProfitLoss || 0;
        const gainPct = cost > 0 ? (pnl / cost) * 100 : 0;
        return {
          ticker: p.instrument?.ticker,
          name: p.instrument?.name,
          quantity: p.quantity,
          averagePricePaid: p.averagePricePaid,
          currentPrice: p.currentPrice,
          value: +value.toFixed(2),
          totalCost: +cost.toFixed(2),
          unrealizedPnL: +pnl.toFixed(2),
          fxImpact: p.walletImpact?.fxImpact || 0,
          gainPct: +gainPct.toFixed(2),
        };
      })
      .sort((a, b) => b.value - a.value);

    const totalValue = holdings.reduce((s, h) => s + h.value, 0);

    const withWeights = holdings.map((h) => ({
      ...h,
      weightPct: totalValue > 0 ? +((h.value / totalValue) * 100).toFixed(2) : 0,
    }));

    const summary = {
      generatedAt: new Date().toISOString(),
      account: {
        id: account.id,
        currency: account.currency,
        totalValue: account.totalValue,
        cashAvailable: account.cash?.availableToTrade,
        cashReserved: account.cash?.reservedForOrders,
        investedCost: account.investments?.totalCost,
        investedValue: account.investments?.currentValue,
        unrealizedPnL: account.investments?.unrealizedProfitLoss,
        realizedPnL: account.investments?.realizedProfitLoss,
      },
      holdingCount: holdings.length,
      topPerformers: [...withWeights].sort((a, b) => b.gainPct - a.gainPct).slice(0, 5),
      bottomPerformers: [...withWeights].sort((a, b) => a.gainPct - b.gainPct).slice(0, 5),
      concentrationRisk: withWeights.filter((h) => h.weightPct > 15),
      holdings: withWeights,
    };

    return jsonContent(summary);
  }
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
