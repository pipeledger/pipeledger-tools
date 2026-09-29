# Connect an AI assistant to PipeLedger

PipeLedger runs a hosted finance MCP (Model Context Protocol) server for
NetSuite and QuickBooks Online data. Add it to an AI assistant that supports
remote MCP servers, and the assistant can retrieve Income Statements,
Balance Sheets, and Cash Flow Statements, compare reporting periods, and
trace a reported figure to its supporting General Ledger detail, all from
your organization's published data.

| | |
|---|---|
| Endpoint | `https://mcp.pipeledger.ai/mcp` |
| Authentication | OAuth, through your PipeLedger sign-in or organization credentials |
| Hosted by | PipeLedger; there is nothing to install or run |

## Before you start

- Use a host that supports remote MCP servers and OAuth discovery.
- Confirm your PipeLedger workspace has at least one approved, published data
  mart that the connection may use.
- Have an active PipeLedger member account with a connected-app policy, or an
  organization Credential ID and client secret from an Owner or Admin.

## Connect

1. In your assistant, add a custom connector or remote MCP server.
2. Enter `https://mcp.pipeledger.ai/mcp`.
3. Choose **Sign in with PipeLedger** or **Use organization credentials**.
4. Review the tools, data marts, role, clearance, and scope, then approve.
5. Start a new conversation and make a read request to confirm the expected
   tools and data.

Member sign-in uses PipeLedger's normal secure sign-in and multi-factor
authentication. You do not copy a token into the assistant or paste one into
a chat.

## First prompts to try

```text
Use PipeLedger to tell me which organization I am connected to and what I
can access.
```

```text
Show me the Income Statement for fiscal year 2025, then show the
transactions behind the revenue line.
```

```text
Compare this fiscal year's Income Statement with the prior fiscal year and
show the largest changes in operating expenses.
```

```text
Retrieve the Cash Flow Statement and break down capital expenditures by
month.
```

## What the assistant can and cannot do

- It sees only the tools its connection permits. PipeLedger checks that
  permission again each time a tool runs.
- Results come only from approved, published data. Raw and unpublished data
  are not available through MCP.
- Data mart access, dimension scope, account confidentiality, identity
  privacy, and clearance are enforced before results leave PipeLedger.
- Masked labels, privacy tokens, totals without transaction detail, or
  omitted rows are expected when a connection has restricted access.
- PipeLedger calculates the figures. The assistant can interpret them but
  cannot change them.

## Managing a connection

- An Owner or Admin can tighten a connection's policy at any time. The next
  request uses the current policy; you do not need to reconnect.
- Revoke a connection from the Connected Apps area if the host's token may be
  compromised. Revocation invalidates its access and refresh tokens.

## Troubleshooting

| Problem | What to do |
|---|---|
| Authorization is denied | Ask an Owner or Admin to check the connected-app policy for your member account or organization credential |
| Expected tools or data are missing | Confirm the connection permits them and that the data is approved and published, then start a new conversation |
| You lost access to your authenticator | Use PipeLedger's account recovery. Reconnecting the assistant cannot bypass multi-factor authentication |

## More detail

- [MCP server documentation](https://pipeledger.ai/docs/mcp)
- [OAuth connection guide](https://pipeledger.ai/docs/oauth-mcp-setup)
- [Tool Guide](https://pipeledger.ai/docs/tool-guide)
