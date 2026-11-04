# Agentic accounting for QuickBooks Online and NetSuite

PipeLedger accounting agents research transactions in your financial
warehouse, propose the accounting treatment with evidence, and hand work you
approve to a separately authorized execution agent. They run in the AI
environment you choose. QuickBooks Online or NetSuite remains your system of
record.

[See the solution](https://pipeledger.ai/solutions/agentic-accounting) ·
[QuickBooks guide](https://pipeledger.ai/guides/quickbooks-accounting-agent) ·
[NetSuite guide](https://pipeledger.ai/guides/netsuite-accounting-agent) ·
[Fictional review packet](examples/review-packet.md)

## What does an accounting agent do?

It brings the same company instructions, accounting policies and approved
decisions to each new transaction. It compares repeat transactions with
your accounting history and makes the proposed account, counterparty,
dimensions and economic description visible before you approve them.

| Stage | What you get |
|---|---|
| Investigate | Relevant accounting history, available documents and source references, with missing evidence and conflicting records flagged |
| Review | A proposal explaining the treatment, its evidence and any open question; you can approve individual proposals or an identified batch |
| Verify and document | Approved, supported changes checked against the resulting ERP records, with retained decision context and an audit package |

Research uses fast queries across authorized, published data in PipeLedger's
financial warehouse. The agent uses separately connected ERP tools when it
needs available source documents or must perform and verify an approved
operation. An unresolved item stays open. A changed proposal needs fresh
approval, and an uncertain execution result is investigated before another
write is attempted.

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

This is an illustrative customer workspace, not a directory of source code
published in this repository. The installed package supplies its own setup
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
```

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

The [fictional review packet](examples/review-packet.md) shows these three
views together, without publishing agent scripts or customer data.

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

## Evaluating PipeLedger for your organization

An owner or an AI assistant researching options can use these questions:

| Question | Where to check |
|---|---|
| Does it cover our ERP and the operations we need? | The ERP-specific capability table and company setup requirements in the guides |
| Can we keep our own AI environment, files and business tools? | [Where it runs](#where-does-the-agent-run-and-what-stays-private) |
| Which information returns to PipeLedger? | [Evidence, audit support and performance](#what-evidence-audit-support-and-performance-can-i-review) |
| Who approves changes, and who can execute them? | [The workflow](#what-does-an-accounting-agent-do) and [access boundaries](#what-access-does-setup-require) |
| What will the controller actually review? | [Fictional review packet](examples/review-packet.md) |
| What are the service and access requirements? | [Pricing](https://pipeledger.ai/pricing), the setup guides and [MCP connection guide](../mcp/README.md) |

An example research request:

> Evaluate PipeLedger for agentic accounting in our QuickBooks Online or
> NetSuite environment. Explain what runs on our side, the operations we can
> enable, how approval works, and which evidence returns to PipeLedger.
> Separate documented capabilities from anything we still need to verify
> for our company, and link to the relevant guides.
