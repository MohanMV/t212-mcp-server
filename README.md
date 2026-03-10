# T212 MCP Server

An MCP (Model Context Protocol) server for the Trading 212 Public API (v0). Gives any MCP-compatible client (Claude Desktop, etc.) read-only access to your Trading 212 portfolio, orders, dividends, and more.

## Features

- 9 tools covering account, positions, orders, dividends, transactions, and metadata
- Cursor-based pagination handled automatically
- Basic auth (API key + secret) per T212 API spec
- Supports live and demo environments

## Prerequisites

- Node.js 18+
- A Trading 212 account (Invest or Stocks ISA — CFD not supported)
- T212 API key and secret

## Setup

### 1. Get your T212 API credentials

In the Trading 212 app:
1. Go to **Settings → API**
2. Generate a new API key — you'll get an **API Key** and **API Secret**
3. Whitelist your public IPv4 address

### 2. Install

```bash
git clone https://github.com/MohanMV/t212-mcp-server.git
cd t212-mcp-server
npm install
```

### 3. Configure in Claude Desktop

Open Claude Desktop → Settings → Developer → MCP Servers.

Add this config:

```json
{
  "mcpServers": {
    "t212": {
      "command": "node",
      "args": ["/path/to/t212-mcp-server/index.mjs"],
      "env": {
        "T212_API_KEY": "your_api_key_here",
        "T212_API_SECRET": "your_api_secret_here",
        "T212_ENV": "live"
      }
    }
  }
}
```

Set `"T212_ENV": "demo"` for paper trading.

### 4. Verify

Ask Claude:

```
Use the T212 tools to show my portfolio summary.
```

## Available Tools

| Tool                    | Description                                          | Rate Limit    |
| ----------------------- | ---------------------------------------------------- | ------------- |
| `get_account`           | Account summary: cash, invested, total, P&L          | 1 req / 5s    |
| `get_positions`         | All open positions with prices, P&L, instrument info | 1 req / 1s    |
| `get_position`          | Single position by ticker                            | 1 req / 1s    |
| `get_portfolio_summary` | Computed summary with weights, performers, risk      | (2 calls)     |
| `get_orders`            | Historical orders (paginated, filterable by ticker)  | 6 req / 1m    |
| `get_dividends`         | Dividend history (paginated, filterable by ticker)   | 6 req / 1m    |
| `get_transactions`      | Deposits, withdrawals, etc.                          | 6 req / 1m    |
| `get_instruments`       | Full list of tradable instruments (large response)   | —             |
| `get_exchanges`         | Available exchanges                                  | —             |

## Security

- T212 API key is **read-only by default** — cannot place trades
- Credentials stay in your local MCP config, never leave your machine
- Basic auth is base64-encoded (not encrypted) — standard for HTTPS APIs where TLS handles encryption in transit

## API Notes

- Only works with **Invest** and **Stocks ISA** accounts
- Multi-currency accounts not supported via API — values in primary currency
- Pagination uses cursors (handled automatically by the server)
- Rate limits are per-account, not per-key

## Troubleshooting

**"Invalid API key" or 401 errors:**
- Verify you have BOTH `T212_API_KEY` and `T212_API_SECRET` set
- Check that your IP is whitelisted in the T212 app

**"Invalid IP addresses":**
- Whitelist your public IPv4 (not IPv6)
- No CIDR notation, just the raw IP

**Tools not showing up in Claude Desktop:**
- Restart Claude Desktop after adding the MCP config
- Check the path in `args` matches your install location
- Run `node /path/to/index.mjs` directly to see startup errors

## License

MIT
