# PipeLedger CLI

`pl` is the command-line client for [PipeLedger](https://pipeledger.ai)'s
hosted financial data platform. It gives AI agents and automation governed
financial statements, metrics, and General Ledger detail from NetSuite and
QuickBooks Online, with publication evidence and permitted management
actions.

The CLI is free to install and licensed under Apache-2.0. Access to
organization data requires a PipeLedger subscription and an authorized
service credential. Financial queries and reports use published data, which
is data that has passed the required checks and been approved for delivery.
Separately authorized management commands can request pipeline runs and make
permitted changes within PipeLedger. The CLI does not post journals to the
ERP or initiate payments.

The CLI is a thin client. It sends requests to the PipeLedger service and
renders the answers. Access rules, validation, and calculation all run in the
service, so the CLI cannot do more than its credential allows.

## What it gives a controller

Give a controller the reach of a seasoned group controller. An AI agent
working from your published books can answer the questions that usually take
years across the business to answer: how each entity treats a transaction,
where treatments differ, and what changed since the last period. Experience
still has to be earned. The visibility no longer does.

**Investigate issues before month-end.** Support a continuous-close approach
with financial review throughout the month. Ask an agent to investigate
changes in revenue, expenses, or balances using published financial data and
the supporting detail available to your connection. After your team corrects
the source records, refresh, validate, and publish the updated data, then
review the effect on the reported results.

**An expert accountant or group controller on call, working from your own
books.** Ask how a transaction should be treated and get two answers side by
side: what accounting guidance says, and how your books have handled the same
situation before. An agent searches years of ledger history in seconds, finds similar
entries, and spots the ones that were booked differently. Analysis that used
to mean exports and an afternoon of filtering becomes a question and an
answer, with the ledger lines attached. The guidance comes from your AI
assistant and the evidence comes from your books. You make the accounting
decision, and your team posts it in the ERP.

**Compare entities on a consistent reporting basis.** Bring NetSuite and
QuickBooks Online financial data into a shared reporting structure. Review
one Legal Entity or all authorized entities using approved mappings and a
consistent currency and accounting-book basis. Investigate differences
between companies with the source references retained, reducing the need to
rebuild that context from separate exports. Dedicated, correctly tagged
intercompany accounts can be excluded to analyze external revenue, costs, and
debt.

**Delegate financial analysis with defined access.** Give an agent access to
the entities, datasets, and financial detail its work requires. PipeLedger
calculates the reported values and enforces the connection's permissions on
every request. Your team can delegate investigation while retaining control
over access and accounting decisions.

PipeLedger supports financial review and reporting. Close-task management,
ERP journal posting, payment initiation, elimination journals, and complex
statutory consolidation adjustments remain outside its tool boundary.

The datasets behind these answers are described at
<https://pipeledger.ai/docs/financial-datasets>.

## Requirements

- Node.js 20 or later. Run `node -v` to check. If it prints "command not
  found", install Node.js from <https://nodejs.org> or with a version
  manager such as nvm before continuing.
- A PipeLedger subscription and an organization with published data
- A service credential, created by an Owner or Admin under
  **Access control > Service credentials**

## Install

```bash
npm install -g @pipeledger/cli
pl --version
```

`pl --version` prints the installed version, such as `0.1.2`. If `pl` is not
found after installing, the CLI is not installed for the active Node.js
version, or npm's executable directory is not on your `PATH`. Do not install
a different package that your system suggests for `pl`.

## Sign in

Run `pl login` and paste the credential at the prompt. The input is hidden.

```bash
pl login
```

For automation and AI agents, pipe the credential from a file or a secret
manager:

```bash
pl login --stdin < credential.txt
```

`pl login` does not accept the credential as an argument, because arguments
are saved in shell history.

### Without a stored file

The CLI also reads the credential from the `PIPELEDGER_CREDENTIAL_SECRET`
environment variable. Set it without typing the value into a command:

- **CI or an agent runtime:** inject it from the platform's secret store.
- **A terminal session (bash or zsh):** read it with hidden input.

```bash
read -rs PIPELEDGER_CREDENTIAL_SECRET && export PIPELEDGER_CREDENTIAL_SECRET
```

Do not write `export PIPELEDGER_CREDENTIAL_SECRET="..."` with the real value.
That line is saved in shell history, which is the exposure `pl login` avoids.

A person with Owner or Admin access creates the credential and chooses its
role, tools, data sources, and clearance. The CLI and any agent using it act
within those choices and cannot widen them.

## First result

These four steps take a new credential to a financial statement and the
transactions behind one of its lines. The sample output is illustrative: it
uses invented figures for a fictional company, and some columns are trimmed.

### 1. Confirm who you are and what you can see

```bash
pl whoami
```

```text
Organization:  Riverside Lumber Co.
Credential:    Finance analyst CLI
Access ends:   2026-12-20 (81 days left)
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

`Access ends` is the date this credential stops working unless an Owner or
Admin extends it. Inside the last 14 days the line asks you to have it
extended or replaced, so an agent does not stop in the middle of a close.
`no end date set` means the credential does not expire.

Two limits of the `Ledger` line:

- Transaction detail can still be restricted when the ledger is complete.
  Check `ledger.detail_complete` in `pl whoami --json` and the caveats
  returned with each report.
- It describes access. It does not establish that source extraction is
  current or that an accounting period is closed.

### 2. Check the serving publication

```bash
pl published-status
```

Sample output (columns trimmed):

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

Illustrative excerpt, through Operating Income. Replace `FY2025` with a
fiscal year your organization has published:

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

Run the same report as JSON. Lines that can be traced carry a
`drilldown_handle`.

```bash
pl report income-statement --fiscal-year FY2025 --format json > income-statement.json
```

The JSON response also includes the publication each figure came from, the
catalog version and definition hash behind each line, a certification
summary, and any caveats.

Find the Revenue line in `sections[].lines[]`. If it includes a
`drilldown_handle` and lists `transaction_line` in `supported_target_grains`,
copy that handle into the command below, exactly as issued. Other figures may
offer different supporting detail or require you to inspect their components
first.

```bash
pl drilldown "<handle>" --grain transaction_line --limit 20
```

The response returns the General Ledger lines behind the figure and a
reconciliation block that compares the reported value with the total of the
supporting detail. Each report line lists the grains it supports in
`supported_target_grains`.

## Commands

Run `pl <command> --help` for the options of any command. The
[Tool Guide](https://pipeledger.ai/docs/tool-guide) describes each
capability, what it returns, and its access boundary.

| Group | Command | Use it to |
|---|---|---|
| Identity | `pl login` | Validate a service credential and save it as a profile |
| | `pl whoami` | Show the credential's role, tools, clearance, and scope |
| | `pl switch` | Choose which saved profile to use, or list them |
| | `pl link [name]` | Link the folder you are in to a saved profile |
| | `pl init [name]` | Create the working folder for an organization, for you and your AI agent |
| | `pl logout` | Remove the saved credential from this computer |
| Discover | `pl schema <mart>` | Inspect the columns, filters, and metrics available to you |
| | `pl resolve [query]` | Resolve a name to a governed metric, customer, vendor, employee, project, or legal entity |
| | `pl published-status` | Show the serving publication for each mart |
| | `pl data-quality` | Check whether enabled marts are ready to use |
| Read | `pl report` | Income Statement, Balance Sheet, Cash Flow Statement, and Metrics Report |
| | `pl query <mart>` | Query rows or aggregate governed metrics from one mart |
| | `pl drilldown <handle>` | Show the evidence behind a reported figure |
| | `pl usage-evidence` | Show this credential's own usage and billing evidence |
| | `pl audit tail` | Stream audit events |
| | `pl unit-register metrics` | Read active unit metric reference metadata |
| | `pl unit-register periods [--posting-period YYYY-MM] [--json]` | Inspect period locks with posting access; omit the period to list locks |
| Act | `pl report-library` | Save, revise, archive, or propose Metrics Reports and report recipes |
| | `pl catalog` | Inspect and administer account classifications, metrics, assumptions, and overrides |
| | `pl unit-register` | Manage unit metrics and post, update, or void unit vouchers |
| | `pl run` | Trigger a pipeline run and check its status |

Commands in the Act group can change state. Changes through `pl catalog`,
`pl unit-register`, and `pl run` require an operator credential and the
specific grant an Owner or Admin assigned. `pl report-library` manages your
own saved reports; proposing one to your organization publishes nothing until
an Owner or Admin decides.

## Output and errors

- Most commands accept `--format table`, `--format json`, or `--format csv`.
- A successful command exits with `0`. A failed command exits with `1` and
  writes the error to stderr, so stdout stays clean for piping.
- With `--format json` (or `--json`), errors are JSON as well, including
  usage errors such as a missing argument. Service errors carry a stable
  `code`, a `correlation_id` to quote to support, and `field_errors` naming
  each invalid field.
- Credential values are masked in error output, including when one is pasted
  where a command or option was expected.

## Working with several organizations

Each credential you save is a **profile**: one organization, one name.
`pl login` names the profile after the organization, or takes a name you
choose. An existing name can be reused to rotate a credential for the same
organization and API. Use a new name for a different organization or environment.

```bash
pl login                              # saved as riverside-lumber-co
pl login --profile riverside-operator # a second credential, named by you
pl switch                             # list what is saved
```

```text
Saved profiles:
  ledgerlabs-inc       LedgerLabs Inc.  [default]
                       folder: /home/you/Documents/PipeLedger/clients/ledgerlabs-inc
  riverside-lumber-co  Riverside Lumber Co.  [in use here]
                       folder: /home/you/Documents/PipeLedger/clients/riverside-lumber-co

In use here: riverside-lumber-co (chosen by this folder: /home/you/Documents/PipeLedger/clients/riverside-lumber-co/.pipeledger.json)
```

### Create a workspace for an organization

A workspace is the folder you and your AI agent work in for one
organization. Create it after `pl login`:

```bash
pl init riverside-lumber-co
```

```text
Documents/PipeLedger/
  methods/                  your own methods, no client data
    procedures/
    templates/
  clients/
    riverside-lumber-co/
      AGENTS.md             instructions your agent reads first
      CLAUDE.md             points Claude to AGENTS.md
      reference/            policies, contracts, regulations
      notes/                decisions and open questions
      reports/              what the agent produces
      .pipeledger.json      names the profile, holds no credential
    ledgerlabs-inc/
      ...
```

Then open your agent on the organization's folder, one session for each
organization, and fill in the two open sections of `AGENTS.md`: the client,
and how you want work done.

- **Where it goes.** `Documents/PipeLedger` in your home folder, or
  `PipeLedger` in your home folder when there is no `Documents` folder. Under
  WSL that is the Linux home folder. Choose another place once with
  `pl init <name> --root <path>`; `pl` remembers it for later workspaces.
- **The folder name.** The profile name, or the name you give with
  `--folder`.
- **Nothing is replaced.** `pl init` writes each file once. Running it again
  restores what is missing and leaves your edits alone, and later versions of
  `pl` do not rewrite your instructions.
- **No credential, no request.** The workspace holds no credential, and
  `pl init` contacts no server. The folder can be synced or shared with people
  who may see that organization's material.
- **Side by side.** A workspace is never created inside another linked folder,
  and a folder linked to one organization is never handed to another.

`pl switch` lists each organization's folders. That list only helps you find
them: which books a command reads is decided by the folder's
`.pipeledger.json` and the organization your credential authenticates as. A
folder that was moved or linked to another organization drops off the list and keeps working where
it is.

The starter `AGENTS.md` tells the agent to stay inside the organization's
workspace and your methods folder, and to stop if `pl whoami` reports any
organization other than the one the workspace was created for. That is
working guidance for the agent, not a restriction enforced by your computer;
what an agent can reach is set in the agent itself.

### Link a folder to an organization

`pl init` links the folder it creates. To link a folder you already have,
run `pl link` in it once. Every command run in that folder, or in a folder
inside it, uses that organization unless you explicitly select another
profile for the command.

```bash
cd ~/clients/riverside
pl link riverside-lumber-co
```

This writes `.pipeledger.json` in the folder. It names the profile and the
organization and holds no credential, so the folder can be synced, shared,
or read by an AI agent.

Linking folders is the safe way to work on several organizations at once.
Two terminals, or two agents, in two folders each use their own
organization. A default that you switch back and forth is shared by every
terminal, so it cannot do that.

### Which credential `pl` uses

For saved profiles, `pl` uses the first of these that applies:

1. `--profile <name>` on the command, or `PIPELEDGER_PROFILE`.
2. The folder link: the nearest `.pipeledger.json` in the current folder
   or a folder above it.
3. The default chosen with `pl switch <name>`. `pl login` also sets it.
4. The only saved profile, when exactly one is saved and no default exists.

`PIPELEDGER_CREDENTIAL_SECRET` and `PIPELEDGER_CONFIG_FILE` are alternatives
for automation. Use one at a time, outside a linked folder and without a
profile selection. Conflicting settings stop the command; an environment key
never silently overrides a requested profile. A missing or unreadable default
also stops the command until you explicitly choose another with `pl switch`.

When several profiles are saved and none of these selects one, `pl` stops
and lists them. It does not guess which organization you mean.

`pl whoami` prints the organization, the profile, how it was chosen, and the
file in use. Run it whenever you are unsure.

A folder link requires an organization ID. Missing or different saved
organization metadata stops the command locally. Before any financial read or
write using a profile with an organization ID, the CLI authenticates that same
key through the identity endpoint and checks the returned organization. A
mismatch stops the financial request, even if the saved metadata is stale.
This adds one nonbillable identity check per API client; normal authentication,
rate limits, and security auditing still apply. Requests do not follow redirects.

### Where credentials are saved

`pl login` writes one file for each profile:

```text
~/.pipeledger/profiles/<name>.json
```

That folder is the only place `pl` looks for saved credentials. A credential
file downloaded from PipeLedger becomes a profile when you move it there and
name it:

```bash
mkdir -p ~/.pipeledger/profiles
mv ~/Downloads/config.json ~/.pipeledger/profiles/riverside-lumber-co.json
```

To use one specific file instead of a profile, for automation:

```bash
export PIPELEDGER_CONFIG_FILE="/secure/path/riverside-lumber-co.json"
```

The file shape is:

```json
{
  "api_url": "https://app.pipeledger.ai",
  "credential_secret": "pl_live_REPLACE_WITH_FULL_CREDENTIAL",
  "org_id": "00000000-0000-4000-8000-000000000000",
  "org_name": "Example Organization"
}
```

On Linux and macOS, the CLI verifies a file is regular, owned by you, and not
a symlink before reading it. It repairs ordinary downloaded-file permissions
to `0600`, but rejects group-writable or other-writable files and files whose
permissions cannot be repaired safely. When moving a browser download, remove
any extra copy left in the Downloads folder because the browser cannot assign
Unix permissions.

Do not commit a real credential file or a `pl_live_` credential to source
control. `.pipeledger.json` holds no credential and is safe to keep in a
folder.

### Sign out

```bash
pl logout
pl logout --profile riverside-operator
```

`pl logout` removes the one credential file `pl` is using and leaves every
other saved profile in place. It then says which profile is in use, or that
none is selected. Removing the selected default leaves it unavailable until
you explicitly choose another profile; the last remaining client is never
selected as a side effect of logout. With an environment key active, logout
removes no saved file and tells you to unset the environment variable. It runs
on your computer only and needs no connection.

Signing out does not revoke the credential. It stays valid until an Owner or
Admin revokes it in PipeLedger, which is the step to take if the credential
may have been exposed.

## Command reference

### whoami

`pl whoami` prints the shared description of what the stored credential is:
organization, credential label, exact credential role and tools, effective
operator grants, clearance, scope (unrestricted, legal entity, or partial
slice), allowed marts, and whether results describe a complete ledger. Pass
`--json` for the raw object. It is the same `whoami` object that
`POST /api/v1/auth/validate` returns and that MCP `pl_schema` embeds, so an
agent on any surface can distinguish tool discovery from the credential and
secondary grants that actually authorize an action.

```bash
pl whoami
pl whoami --json
```

`ledger.complete` is true only when scope is at most whole legal entities and no GL account is amount-confidential below the credential's clearance. `ledger.reasons` lists why it is not (`partial_scope`, `amounts_withheld_below_clearance`, `detail_withheld_below_clearance`); it never names an account. When it is false, statements still return but their equation, trial-balance, and reconciliation controls are marked not applicable.

### schema

`pl schema <mart>` prints the policy-filtered schema of one published mart: the columns this credential can see with their static filterable/groupable flags and governance-masking markers, recommended catalog metrics, native period dimensions, the fiscal calendar anchor, and the same `whoami` object. It is the CLI face of MCP `pl_schema` and REST `GET /api/v1/schema/{mart}`; one shared capability service serves all three, so the columns advertised here are exactly the ones `pl query` will serve.

```bash
pl schema gl_lines
pl schema trial_balance --detail full --columns reporting_amount,account_name
pl schema gl_lines --format json
```

`--detail concise` (default) lists structural facts only; `--detail full` adds nullability and prose descriptions. `--columns` narrows to an exact selector (unknown names return close-match suggestions drawn only from your visible columns). Requires the `pl_schema` grant.

### Financial reports

The CLI uses one canonical name for each report:

```bash
pl report
pl report metric-report \
  --metrics revenue,gross_profit,current_ratio \
  --fiscal-year 2026 \
  --as-of 2026-06-30
pl report income-statement \
  --fiscal-year 2026 --compare-fiscal-year 2025
pl report balance-sheet \
  --as-of 2026-06-30 --compare-as-of 2025-06-30
pl report cash-flow-statement \
  --fiscal-year 2026 --method direct
```

`pl report` shows report help. Income Statement, Balance Sheet, and Cash Flow
Statement are financial statements. A Metrics Report is different: it is an
ordered selection of governed metrics that you choose, one line per metric,
and it is not a financial statement. It has no fixed preset: pass ordered,
governed metric IDs and the clocks those metrics require. Activity metrics use
`--fiscal-year`; point-in-time metrics use `--as-of`; a mixed Metrics Report accepts
both. The other subcommands return the Income Statement, Balance Sheet, and
Cash Flow Statement respectively.

Every subcommand accepts `--reporting-legal-entity-id <id>` (scopes the report,
its comparison, and every returned drilldown handle to one governed Legal
Entity) and `--catalog-version <version>` (an unsupported version fails and
never falls back to latest). Comparison periods use `--compare-fiscal-year` for
activity reports and `--compare-as-of` for the Balance Sheet. `metric-report`
adds `--definition-comparison-metric-id` and
`--definition-comparison-baseline-revision`, which must be supplied together
and measure the impact of one approved metric revision against the same
governed serving publication.

Every door returns the same report: the same lines, the same
`source_provenance`, the same certification summary, the same caveats, and the
same signed drilldown/save handles. `--format table` is the human read,
`--format csv` adds section, line, metric, and hash columns, and `--format json`
prints the response verbatim including handles. Requires the `pl_report` grant.

### Cash Flow Statement

Materialize the Cash Flow package from source data already in PipeLedger:

```bash
pl run trigger <pipeline-id> \
  --stage transform \
  --mart-packages cash_flow
```

The package builds both `mart_cash_flow_components` and
`mart_cash_flow_statement_lines`. The service credential must have `pl_run`, the
operator role, and the organization must have the included Cash Flow data
product enabled. Query/report access is separate: grant
`cash_flow_components` in the credential or user's allowed marts; the statement
is served through a governed Cash Flow Statement report rather than as a
free-form query mart.

Run the US GAAP Cash Flow Statement for the current fiscal year. The command uses
the fully tested indirect method when `--method` is omitted:

```bash
pl report cash-flow-statement
```

Select a fiscal year or machine-readable output when needed:

```bash
pl report cash-flow-statement --fiscal-year 2026
pl report cash-flow-statement --format json
```

Both presentation methods are available, but their V1 assurance differs:

```bash
pl report cash-flow-statement --method indirect
pl report cash-flow-statement --method direct
```

The indirect method is the fully tested V1 path. The direct method is an
explicit, coverage-qualified preview and never silently falls back to indirect.
The response always identifies the method, US GAAP basis, reconciliation
residual, and certification status. Mapping diagnostics are omitted when
Highly Restricted account controls require totals-only disclosure. Table output
formats amounts in the organization's reporting currency, while CSV output
carries the ISO currency code on every row. JSON responses also include the
source publication run and actual publication timestamp for auditability.

### Administration

Reading the catalog requires the `pl_catalog` tool. Changing it requires an
operator credential with the catalog grants an Owner or Admin assigned.

#### Finance Catalog metrics

The CLI mirrors the MCP catalog surfaces. Read operations require `pl_catalog`;
metric lifecycle writes require `pl_catalog_admin`, an operator credential, and
the explicit catalog-administration grant.

Inspect the effective catalog, one definition, revision history, or immutable
PipeLedger catalog releases:

```bash
pl catalog metrics list
pl catalog metrics get gross_margin --format json
pl catalog metrics history product_engineering_spend_ratio
pl catalog metrics versions
pl catalog metrics compare <from-version> <to-version>
```

Metric definitions are complete JSON documents. The service validates them
with the same rules the Finance Catalog page uses and returns field-level
errors. Previewing does not persist the definition:

```bash
pl catalog metrics preview --file metric.json
pl catalog metrics create --file metric.json
pl catalog metrics edit <definition-id> --file metric.json
pl catalog metrics activate <definition-id> \
  --comment "Controller approved the definition"
pl catalog metrics archive <definition-id> \
  --comment "Metric retired from the active catalog"
```

Editing an active organization metric creates a private draft revision; the
active definition remains live until the draft is activated. Activation and
archiving preserve revision history, change notes, and credential-attributed
audit evidence atomically.

#### Cash-flow account classification

Discover the organization-scoped chart of accounts before editing it. The
returned `classification_id` is the stable write target; `override_id` is
nullable controller-intent provenance and must not be passed to `edit`.
Discovery and edits require a broad `pl_catalog_admin` credential: operator
role, explicit catalog-write access, full Highly Restricted account clearance,
unrestricted dimension scope, and no row filters:

```bash
pl catalog account-classification list
pl catalog account-classification list \
  --cash-flow-requires-review true --format json
```

The list includes each account's effective Statement section, Calculation
basis, Standard cash-flow detail, classification source, review status,
active/pending override status, and override reason. Use `--source-erp quickbooks` or
`--source-erp netsuite` to inspect one ERP at a time.

Find one account without paging the whole chart:

```bash
pl catalog account-classification list --account-name-contains "loan payments"
pl catalog account-classification list --account-id 1150040080
```

`--account-name-contains` matches the text literally and without regard to
case; `*`, `%` and `_` are ordinary characters. `--account-id` is the exact
ERP account id and can match one account per connector.

Map an account by using its stable `classification_id`:

```bash
pl catalog account-classification edit \
  00000000-0000-4000-8000-000000000000 \
  --cash-flow-category operating \
  --cash-flow-treatment working_capital_change \
  --cash-flow-standard-detail accounts_receivable \
  --reason "Controller approved working-capital mapping"
```

Cash-flow-only edits first fetch the effective row and preserve its existing
taxonomy, Catalog Category/Subcategory, and framework-number intent. The new
mapping takes effect immediately in the effective catalog; the list indicates
when it is newer than the transformed classification.

Reset only the cash-flow intent to the finance-catalog default without removing
other controller overrides:

```bash
pl catalog account-classification edit \
  00000000-0000-4000-8000-000000000000 \
  --clear-cash-flow-override \
  --reason "Return to the finance-catalog default"
```

Writes retain the existing `pl_catalog_admin` protections: the credential must
be an operator with catalog write access granted by an owner or admin.

## Support and security

- Public repository: <https://github.com/pipeledger/pipeledger-tools>
- Documentation: <https://pipeledger.ai/docs/tool-guide>
- Questions and problems: support@pipeledger.ai
- To report a suspected vulnerability, write to support@pipeledger.ai. Please
  do not post the details publicly. See <https://pipeledger.ai/trust>.

## License

Copyright 2026 PipeLedger Inc. Licensed under Apache-2.0; see
[LICENSE](LICENSE) and [NOTICE](NOTICE). "PipeLedger" and the PipeLedger logo
are trademarks of PipeLedger Inc and are not licensed under Apache-2.0.
