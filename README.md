# PipeLedger tools

Open-source tools and connection guides for [PipeLedger](https://pipeledger.ai),
a hosted financial data platform.

PipeLedger extracts General Ledger data from QuickBooks Online and NetSuite,
transforms it into tested financial data in a managed warehouse, and delivers
approved results to people and AI agents. These tools are how you reach that
data from a terminal or an AI assistant.

The tools are free to install and licensed under Apache-2.0. Access to
organization data requires a PipeLedger subscription and authorization from
that organization's Owner or Admin.

| Tool | Use it to | Start here |
|---|---|---|
| Command-line client (`pl`) | Retrieve financial statements, metrics, and General Ledger detail, inspect publication evidence, and perform permitted management actions | [Install the CLI](#install-the-cli) |
| MCP server connection | Let an AI assistant such as Claude or ChatGPT work with your published financial data | [Connect an AI assistant](mcp/README.md) |

## What you need

- A PipeLedger subscription and an organization with published data. See
  [pricing](https://pipeledger.ai/pricing).
- Access granted by that organization's Owner or Admin.

## Install the CLI

Requires Node.js 20 or later. Run `node -v` to check. If it prints "command
not found", install Node.js from <https://nodejs.org> or with a version
manager such as nvm before continuing.

```bash
npm install -g @pipeledger/cli
pl --version
pl login
```

If your system suggests installing a different package to get `pl`, Node.js
is not active in that terminal; do not install the suggested package.

`pl login` prompts for a service credential and hides what you paste. An Owner
or Admin creates the credential under **Access control > Service credentials**
and chooses its role, tools, data sources, and clearance.

For scripts and agents, pipe the credential from a file or a secret manager:

```bash
pl login --stdin < credential.txt
```

`pl login` does not accept the credential as an argument, because arguments
are saved in shell history.

## First result

These four steps take a new credential to a financial statement and the
transactions behind one of its lines. The sample output uses invented figures
for a fictional company.

### 1. Confirm who you are and what you can see

```bash
pl whoami
```

```text
Organization:  Riverside Lumber Co.
Credential:    Finance analyst CLI
Role:          viewer
Clearance:     standard
Scope:         unrestricted (all rows)
Tools:         pl_whoami, pl_schema, pl_query, pl_report, pl_drilldown
Marts:         gl_lines, trial_balance, chart_of_accounts
Ledger:        complete
```

`Ledger: complete` means the credential's scope covers whole legal entities
and no account amounts are withheld at its clearance. It does not necessarily
cover every legal entity in the organization. Otherwise the line reads
`partial`, followed by the reasons; statements still return, and their
balancing and reconciliation controls are marked not applicable.

Two limits of this line:

- Transaction detail can still be restricted when the ledger is complete.
  Check `ledger.detail_complete` in `pl whoami --json` and the caveats
  returned with each report.
- It describes access. It does not establish that source extraction is
  current or that an accounting period is closed.

### 2. Check the serving publication

```bash
pl published-status
```

```text
 mart          | last_published       | stale | public_window
---------------+----------------------+-------+-------------------
 gl_lines      | 2026-09-25 04:47 UTC | false | before 2026-07-01
 trial_balance | 2026-09-25 04:47 UTC | false | before 2026-07-01
```

This shows which publication your queries and reports are served from.

| Column | Meaning |
|---|---|
| `last_published` | When the serving publication was approved and published |
| `stale` | True when a newer certified run exists that has not been published yet |
| `public_window` | Which periods your organization's publication policy has released to credentials without Corporate Insider clearance |

Publication time and source freshness are separate. `stale: false` does not
show that the ERP data is current: extraction can stop without producing a
newer certified run.

"Public" in `public_window` refers to audiences inside your organization.
It never means that financial data is accessible on the internet.

### 3. Retrieve an Income Statement

```bash
pl report income-statement --fiscal-year FY2025
```

Excerpt of the output, through Operating Income:

```text
Income Statement - Riverside Lumber Co.
Period: FY2025
Currency: USD

Revenue
  Revenue                        4,812,300.00 USD

Cost of Goods Sold
  Cost of Goods Sold             3,127,900.00 USD

Gross Profit
  Gross Profit                   1,684,400.00 USD

Operating Expenses
  Operating Expenses             1,102,750.00 USD

Operating Income
  Operating Income                 581,650.00 USD
```

### 4. Drill into a figure

Run the same report as JSON. Each line carries a `drilldown_handle`.

```bash
pl report income-statement --fiscal-year FY2025 --format json > income-statement.json
```

The JSON response also includes the publication each figure came from, the
catalog version and definition hash behind each line, a certification
summary, and any caveats.

Copy the `drilldown_handle` of the line you want from `sections[].lines[]`
and pass it exactly as issued:

```bash
pl drilldown "<handle>" --grain transaction_line --limit 20
```

The response returns the General Ledger lines behind the figure and a
reconciliation block that compares the reported value with the total of the
supporting detail.

The full command reference is on the
[npm package page](https://www.npmjs.com/package/@pipeledger/cli).

## What runs where

The CLI and the MCP connection are clients. They send requests and show the
answers.

| Runs in the PipeLedger service | Runs on your machine |
|---|---|
| Access rules, clearance, and identity privacy | Building the request |
| Validation of every request | Storing your credential in a file only you can read |
| Financial calculations and statements | Formatting the response |
| Audit records | |

A client cannot do more than its credential allows, and an AI assistant can
interpret the figures but cannot change them. Financial queries and reports
use published data; management commands follow their own permissions and
approval rules.

This repository holds the tools' documentation and license. The PipeLedger
service, its data pipeline, and its ERP connectors are not open source.

## Documentation

- [Tool Guide](https://pipeledger.ai/docs/tool-guide): every capability, with inputs, returned evidence, and example prompts
- [MCP server](https://pipeledger.ai/docs/mcp): endpoint, authentication, and permission boundaries
- [OAuth connection](https://pipeledger.ai/docs/oauth-mcp-setup): connect a host and troubleshoot authorization
- [Extraction and warehousing](https://pipeledger.ai/docs/data-pipeline): transformation, financial checks, approval, and publication
- [Industry resources](https://pipeledger.ai/industry-resources): reporting guides and metric formulas

## Support and security

- Help with the tools: see [SUPPORT.md](SUPPORT.md)
- Reporting a vulnerability: see [SECURITY.md](SECURITY.md)

## License

Copyright 2026 PipeLedger Inc. Licensed under Apache-2.0; see
[LICENSE](LICENSE) and [NOTICE](NOTICE). "PipeLedger" and the PipeLedger logo
are trademarks of PipeLedger Inc and are not licensed under Apache-2.0.
