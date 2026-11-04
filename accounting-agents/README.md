# Agentic accounting for QuickBooks Online and NetSuite

PipeLedger is a governed accounting workflow around the AI agent and ERP tools
you choose. The accounting agent researches a transaction, proposes a specific
treatment with evidence, and freezes that proposal for review. Only an exact
execution approval lets a separately authorized execution agent perform the
supported action. QuickBooks Online or NetSuite remains the system of record,
and the resulting native record is checked against what was approved.

[See the solution](https://pipeledger.ai/solutions/agentic-accounting) ·
[QuickBooks guide](https://pipeledger.ai/guides/quickbooks-accounting-agent) ·
[NetSuite guide](https://pipeledger.ai/guides/netsuite-accounting-agent) ·
[QuickBooks audit-package walkthrough](examples/review-packet.md)

## Who is PipeLedger Agentic Accounting for?

PipeLedger Agentic Accounting is for CFOs, controllers and accounting managers
who want to improve the quality and consistency of their QuickBooks Online or
NetSuite accounting, with the query speed of a financial data warehouse behind
their agents. Research runs against prepared financial data across connected
systems, keeping the workflow responsive as agents move between accounting
history, business identities and reporting definitions.

PipeLedger supplies accounting-specific instructions for researching a
treatment, preparing a proposal, recording approval, authorizing execution and
checking the result. Your team starts with an established accounting workflow
and adapts it to your policies and the operations you want to enable.

For teams working under US GAAP or IFRS, the agent brings reviewed company
policies, relevant accounting guidance and prior approved decisions into each
investigation. As your policies and reference material are updated, those
instructions give repeat transactions a consistent basis for treatment. Your
controller sets the applicable framework and approves accounting judgments.

You keep your own AI environment and choose which files, plugins and business
systems the agent can use. Its instructions focus research on the information
needed for the accounting decision and limit what is shared: relevant findings,
economic descriptions and evidence references. This lets your team retain
useful audit context while minimizing the confidential material shared with
PipeLedger or other external services. Your chosen tools and provider settings
control access to the original files.

## What does an accounting agent do?

It brings the same company instructions, accounting policies and approved
decisions to each new transaction. It compares repeat transactions with
your accounting history and makes the proposed account, counterparty,
dimensions and economic description visible before you approve them.

You can also configure a **specialized accounting memo** alongside the general
economic description. For revenue arrangements, the memo can document
performance obligations, delivery and acceptance terms, service periods,
payment conditions and the judgments supporting revenue recognition, with
references to the relevant contract clauses and company policy. This gives
accounting managers, controllers and auditors a clearer basis for reviewing the
treatment, including for audits conducted under
[PCAOB standards](https://pcaobus.org/oversight/standards/auditing-standards/details/AS1215).
The memo can remain in your workspace, with only selected, approved context
returned to PipeLedger.

| Stage | What you get |
|---|---|
| Investigate | Relevant accounting history, available documents and source references, with missing evidence and conflicting records flagged |
| Propose | A durable proposal identity and exact accounting treatment, including the native action, account, counterparty, dimensions, economic description and any open question |
| Decide | A clear choice to approve the named proposal for execution, approve only its accounting treatment, ask a question or leave it unresolved |
| Execute | A separately authorized agent performs only the approved action configured and tested for your company; changed proposals require fresh approval |
| Verify and document | The native ERP identity and approved fields are read back, posting effects are checked where applicable, and decision context and evidence are retained in the audit package |

Research uses fast queries across authorized, published data in PipeLedger's
financial warehouse. The agent uses separately connected ERP tools when it
needs available source documents or must perform and verify an approved
operation. An unresolved item stays open. A changed proposal needs fresh
approval, and an uncertain execution result is investigated before another
write is attempted.

### Who decides what the accounting agent can do?

Your ERP system owner decides which company the agent can access and which
operations to enable. You can configure an agent to research transactions and
prepare a period-close review, or authorize an execution agent to post supported
vouchers and other accounting records after approval.

In NetSuite, your administrator assigns a dedicated role with the permitted
records, actions and subsidiary scope. In QuickBooks Online, the company owner
authorizes the Intuit app connection, and the execution workflow limits which
supported actions the agent may perform. QuickBooks app authorization is
broader than NetSuite's record-level role settings; the workflow's execution
controls remain part of the setup.

PipeLedger research permissions are configured separately. Read access to your
financial warehouse does not authorize ERP changes. Your owner or administrator
can enable, restrict or revoke the relevant connections, and the configured
execution agent still requires approval for the exact proposal it will perform.

### Why does consistent accounting matter?

The same item, supplier or type of transaction should receive the same
treatment when the facts and company policy are the same. The agent checks
for that consistency and explains exceptions instead of leaving the next
reviewer to reconstruct the reasoning.

Consistent accounts, items, counterparties, service periods and approved
dimension mappings also give the next investigation clearer context. For
example, an **Investment interest** item can map to **Interest income**,
which contributes to **Net income** on the **Income Statement**. Knowing
those relationships helps the agent explain how a proposed entry affects
reporting. New mappings and policy changes still need review.

### What work can it perform in each ERP?

| Guide | Work covered by the guide |
|---|---|
| [QuickBooks Accounting Agent](https://pipeledger.ai/guides/quickbooks-accounting-agent#g-work) | Bank and credit-card categorization and matching, reconciliations, invoices, bills, journals and supported corrections |
| [NetSuite Accounting Agent](https://pipeledger.ai/guides/netsuite-accounting-agent#g-work) | Bank and credit-card records and matching, configured journals, invoices, vendor bills, purchase and sales orders, item receipts and fulfillments |

The guides distinguish supported operations and setup requirements. Actual
availability depends on the installed package, ERP features, assigned
permissions and operations configured and verified for your company. The two
ERPs do not offer identical actions; QuickBooks update/delete support does
not imply NetSuite update/delete support.

Both agents use **Distribution account** for routine proposals and the same
dimension names: **Project**, **Geographical segment**, **Functional
segment** and **Business segment**. Mappings follow approved configuration.
Customer stays separate; Project manager belongs within Functional segment
where that mapping is approved. Journals and adjustments include a
supplemental, balanced Debit/Credit posting-lines table.

## Where does the agent run, and what stays private?

PipeLedger provides the financial data foundation, accounting-agent packages
and setup guidance. You run the agent in an environment you control, with
the business tools and files you authorize. A local workspace is one option;
a managed agent service can provide another. Slack or Microsoft Teams can
be the messaging interface to that service.

| Location | What it holds |
|---|---|
| PipeLedger | Published financial data, governed definitions and selected delivered decision context and evidence references |
| Your agent environment and source systems | Original contracts and source files; your agent workspace holds company instructions, working material and the detailed audit/performance package |
| QuickBooks Online or NetSuite | Native accounting records and the resulting approved changes |

Your choice of AI provider and plugins determines how those services handle
the information you share with them. Running your own environment lets you
control those choices.

### Example company folder

This is the company workspace where the agent works over time. The layout is
illustrative; the installed package supplies its actual working paths and setup
instructions.

```text
Your company/
├── AGENTS.md              Company instructions
├── notes/                 Approved decisions
├── reference/             Policies and supporting references
└── Accounting Agent/
    ├── config/            Protected connections and company configuration
    ├── product/           Installed, versioned agent software
    ├── work/              Review inputs and working material
    ├── runtime/           Durable operational history and state
    ├── evidence/          Retained supporting evidence
    └── reports/           Review reports and exported audit packages
        └── accounting-agent-audit-package/  One exported snapshot
```

An audit package is a portable snapshot of selected work from this workspace.
The export destination is configurable; placing it under `reports/` is the
example used here. The [audit-package walkthrough](examples/review-packet.md#from-the-company-folder-to-an-audit-package)
opens that same `accounting-agent-audit-package/` folder and shows its contents.
Its exported records preserve the selected history at the export cutoff; the
agent continues to keep its operational history in the workspace.

Keep credentials in protected configuration, outside public repositories and
chat messages. `runtime/` is operational history, not a disposable cache.
Updates replace the installed software while preserving company history,
evidence and reports according to the package's update instructions.

## What access does setup require?

There are three jobs, with separate access boundaries:

| Job | Connection | What it permits |
|---|---|---|
| Financial research | A PipeLedger connection with the required Viewer tools and company data | Read authorized published history, accounts, dimensions and governed definitions |
| Return accounting context | A restricted credential for the intended PipeLedger connector | Deliver selected context and receive delivery confirmations; this credential cannot read your ledger or reports or post to the ERP |
| Source evidence and approved execution | Separate QuickBooks or NetSuite access | Read permitted source evidence and perform configured operations through the execution agent after approval |

The execution agent is software using the authorized ERP connection, not an
additional credential. QuickBooks setup uses an Intuit app and authorization
for the intended company; some bank-feed operations also need a signed-in
browser session. The NetSuite guide separates an interactive MCP Operator
role from a read-only, certificate-based background Reader where the
configured workflow requires it. These ERP permissions do not come from
your PipeLedger research connection.

See the [QuickBooks connection steps](https://pipeledger.ai/guides/quickbooks-accounting-agent#g-connect)
or [NetSuite connection steps](https://pipeledger.ai/guides/netsuite-accounting-agent#g-connect)
for the actual setup. Installing this repository's CLI or connecting its
hosted MCP server alone does not install or authorize an accounting agent.

## How does PipeLedger improve accounting research?

A useful accounting recommendation needs more than a transaction description.
It needs to know what the account means, who the counterparty is, how similar
transactions were treated, which policy applies and how the entry will appear
in reporting. PipeLedger gives the agent that connected financial context.

### The ontology connects the transaction to its financial meaning

PipeLedger's financial ontology brings together account classifications,
governed business identities and roles, approved dimension mappings and metric
definitions. The agent can investigate the relationships behind an entry
instead of relying on a bank memo or an account name alone.

For example, a payment to a company recorded as a vendor could be an ordinary
expense or a repayment to that company in its separately approved role as a
lender. Accounting history, the approved business-role assertion and supporting
evidence help the agent distinguish the treatments. The proposed accounts then
determine the effect on the Income Statement, Balance Sheet and Cash Flow
Statement under the applicable reporting definitions.

These relationships come from governed definitions and approved configuration.
A familiar name or a repeated transaction does not silently create a new
business role or accounting policy.

### The research tools give each investigation a method

The agent's configured workflow uses PipeLedger's financial tools through MCP
or their CLI equivalents. Each tool answers a different research question:

| Research question | PipeLedger tool | How it supports quality |
|---|---|---|
| Which company am I working in, and what may I see? | [`pl_whoami`](https://pipeledger.ai/docs/tool-guide#pl_whoami) | Confirms the connection's identity, tools, data scope and whether ledger access is complete |
| Which fields and filters are available for this investigation? | [`pl_schema`](https://pipeledger.ai/docs/tool-guide#pl_schema) | Describes the authorized datasets and fields before the agent builds a query |
| What do these financial terms and business references mean, and how should they guide the investigation? | [`pl_resolve`](https://pipeledger.ai/docs/tool-guide#pl_resolve) | Connects financial language to governed metrics, report types and analysis guidance; identifies business objects, approved roles and relationships, with source evidence and guidance for the next permitted query or report |
| How is this financial measure defined? | [`pl_catalog`](https://pipeledger.ai/docs/tool-guide#pl_catalog) | Retrieves governed definitions so the agent can use the company's reporting meaning consistently |
| What happened in the books, and how were similar entries treated? | [`pl_query`](https://pipeledger.ai/docs/tool-guide#pl_query) | Retrieves targeted published accounting history, account classifications and permitted financial detail |
| How does the booked activity appear in reporting, and what supports a figure? | [`pl_report`](https://pipeledger.ai/docs/tool-guide#pl_report), [`pl_drilldown`](https://pipeledger.ai/docs/tool-guide#pl_drilldown) | Retrieves financial statements or a selected Metrics Report and traces supported figures to authorized detail |

To turn a memo or bank text into useful accounting guidance, the agent combines
these tools. It uses `pl_resolve` to connect names and financial terms to
business objects, approved business roles, metric definitions and the
appropriate reporting or analysis approach. When the clue is transaction text,
an item description or a document reference, `pl_schema` and `pl_query` help
find the relevant published activity; the agent can then resolve the returned
business-object references. The resulting evidence guides the proposed
treatment, with ambiguous matches or missing role assertions kept visible for
review.

Built-in proposal preparation uses identity checks, counterparty/project
resolution and targeted history and chart-of-accounts queries. The additional
tools support broader investigation and review when the workflow and connection
allow them. Each proposal retains the evidence and reasoning relevant to its
decision.

### Privacy is part of the research method

Company instructions guide the agent to request relevant records and fields,
record the findings needed to explain the treatment, and return selected
ledger-related context rather than entire source documents. PipeLedger also
enforces the connection's data scope, account confidentiality and identity
privacy on the server before results reach the agent. Agent instructions cannot
grant access that the connection does not have.

That is the foundation your team would otherwise need to build and maintain:
normalized financial history, account and dimension mappings, identity
resolution, governed metric definitions, permission-aware query tools and an
evidence-based accounting workflow. PipeLedger provides that foundation while
you retain control over your AI environment, company policies and accounting
decisions.

## What evidence, audit support and performance can I review?

**Evidence explains why.** Bank-entry references, document numbers, policy
references and the relevant findings support the proposed treatment. Missing
or inaccessible evidence is disclosed.

**Audit support preserves the decision context.** PipeLedger can retain the
delivered economic description, service-period dates, reported decision
participants, evidence references and proposal lineage when supplied.
Revised context is retained as new versions. The full proposal, approval,
execution and performance history stays in your agent's audit package;
delivery does not mean that entire package is stored in the warehouse.

After a verified ERP result, the agent delivers eligible context to the
intended PipeLedger connector. A receipt confirms storage. The next normal
refresh matches eligible context to accounting records and includes it in
the governed publication. A receipt alone does not prove that matching or
publication has completed.

**Performance describes the batch.** Track items researched and delivered
for review, time to prepare the batch, completed actions, execution time,
attempts, proposal revisions and later corrections where recorded. Missing
measurements stay unmeasured. Successful execution is distinct from
accounting accuracy.

The [current QuickBooks audit-package walkthrough](examples/review-packet.md)
shows how these claims appear in the proposal, event trail, evidence index,
completion receipt and package manifest, without publishing agent scripts or
customer data. Confirm the installed export path separately for NetSuite.

## Can I set it up myself?

Yes. Choose a compatible AI environment, create a dedicated company
workspace, install the accounting-agent package supplied through PipeLedger,
add your instructions and protected connections, and start with a read-only
review. Verify the company and available operations before enabling
execution. PipeLedger can assist if you need help.

The public CLI is Apache-2.0. This overview and example do not distribute the
accounting-agent implementation or extend the CLI's license to separately
supplied agent packages. Access to company data requires a PipeLedger
subscription and authorization from the organization's Owner or Admin.

## Start with your own accounting history

Choose a recurring transaction or a period-close review and run a read-only
investigation first. Review the proposed treatment, the accounting history and
policy behind it, the evidence references and any unresolved questions. You can
then enable the supported operations you want, after testing their permissions
and verification in your company environment.

- [QuickBooks Accounting Agent guide](https://pipeledger.ai/guides/quickbooks-accounting-agent)
- [NetSuite Accounting Agent guide](https://pipeledger.ai/guides/netsuite-accounting-agent)
- [QuickBooks audit-package walkthrough](examples/review-packet.md)
- [PipeLedger plans and pricing](https://pipeledger.ai/pricing)
