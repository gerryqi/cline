# @cline/core

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`packages/ARCHITECTURE.md`](../ARCHITECTURE.md)

`@cline/core` is the stateful orchestration layer (runtime composition, sessions, storage, RPC session adapter).

## MCP Settings Compatibility

`@cline/core` loads MCP registrations from `cline_mcp_settings.json` and supports both shapes:

- Preferred nested transport:
  - `{ "mcpServers": { "docs": { "transport": { "type": "stdio", "command": "node" } } } }`
- Legacy flat transport (still accepted):
  - `{ "mcpServers": { "docs": { "command": "node" } } }`
  - `{ "mcpServers": { "remote": { "url": "https://mcp.example.com", "transportType": "http" } } }`

Legacy `transportType: "http"` is normalized to `transport.type: "streamableHttp"`.
