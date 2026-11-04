# What an accounting-agent run actually produces

This walkthrough follows PipeLedger's current QuickBooks audit-package exporter
and connector-neutral v2 package contract. Names, IDs, source text and amounts in
the displayed proposal are sanitized, but the artifact names, status boundaries,
approval wording and validation behavior are the real implemented shapes.
Nothing below is a benchmark or a claim that a customer transaction occurred.

NetSuite uses the shared proposal, approval, execution and verification
lifecycle, but this page does not claim that every installed NetSuite deployment
currently emits this identical portable package. Confirm the installed exporter
and commissioned native operation during deployment.

## Start with the package, not a success story

An exported run is a relocatable directory, not a prose summary assembled after
the fact:

```text
accounting-agent-audit-package/
├── README.md
├── manifest.json
├── records/
│   ├── proposals.ndjson
│   └── events.ndjson
├── details/
│   └── P0001.md
├── evidence/
│   └── ... retained files, when collection is permitted
└── reports/
    ├── accounting-agent-activity.xlsx
    └── completion-receipt.md
```

The complete directory stays together so links from the workbook to proposal
details and evidence remain resolvable after relocation.

| Artifact | What a reviewer can establish |
|---|---|
| `manifest.json` | Package identity, organization, ERP, exporter version, selection basis, completeness boundary, evidence cutoff, record counts, sequence omissions and the size and SHA-256 of every inventoried package file |
| `records/proposals.ndjson` | Immutable proposal versions, source ERP and case identity, supersession lineage, frozen payload and payload/record hashes |
| `records/events.ndjson` | Ordered proposal, approval, authorization, dispatch, outcome, verification and evidence-retention events, with actor and assurance metadata |
| `details/P0001.md` | Human-readable source identity, full source text, dimensions, economic-description destination, posting model, review notes, approval binding, attempts and native result reference |
| `Evidence Index` worksheet | Evidence availability, custody, original locator, package location, observed/captured times, hash and byte count |
| `completion-receipt.md` | Action-level execution, posting verification, bank matching, statement reconciliation, PipeLedger delivery and the next unresolved action |

The manifest states whether the selection is explicit or complete only within a
declared workflow boundary. It does not turn a selected batch into a claim about
the whole company.

## What the controller approves

The visible proposal is generated from the same frozen proposal record used by
the execution controls. Source amount, source text and accounting disposition
are not reconstructed from the completion result.

| Proposal ID | Date | Event | Counterparty | Source account | Source amount | Source text&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Proposed action | Distribution account | Key dimensions | Economic description | Accounting readiness | Execution capability | Approval status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0001 | 2026-10-01 | Office-supply purchase | Vendor: Office Supply Store (sanitized) | QuickBooks Operating | -125.40 USD | OFFICE SUPPLY STORE 4431 | Categorize imported transaction | 125.40 USD — Office supplies | Project: Not assigned; Geographical segment: West; Functional segment: Operations; Business segment: Design services | Office supplies for design studio | complete | commissioned | pending |

**To record execution approval, reply exactly:**

`Approve P0001 for execution.`

That sentence authorizes the complete displayed action graph for this immutable
proposal version. Accounting acceptance without dispatch authority uses different
wording. A change to the account, counterparty, dimensions, description or native
action creates a superseding proposal and requires a new decision.

The detail record beneath the row retains:

- the proposal hash and version;
- source ERP identity, source version, observation cutoff and full source text;
- Customer and Project as separate relationships;
- the economic description and its intended native destination and persistence;
- the complete Debit/Credit posting model when posting is expected;
- Evidence, Rationale, Decision needed, Execution dependency and References;
- the exact decision, actor, time and assurance basis; and
- every requested action, attempt, native result reference and verification
  outcome.

## What happens after approval

The portable event record uses distinct event types rather than one generic
"completed" status:

```text
proposal_recorded
  → approval_recorded
  → authorization_recorded
  → dispatch_intent_recorded
  → execution_dispatched
  → execution_succeeded | execution_failed | execution_uncertain
  → verification_recorded | corroboration_recorded
```

Authorization binds the proposal and requested action before dispatch. A provider
response is not treated as sufficient verification. The adapter reads the native
record back and checks the fields and accounting effects required for that record
type. The completion receipt keeps these outcomes separate:

| Outcome | Why it remains separate |
|---|---|
| Execution result | Whether the requested native action was delivered and reached a terminal result |
| Posting verification | Whether native fields and posting effects agree with the approved proposal |
| Bank matching | Whether the imported bank or credit-card item was matched to the verified record |
| Statement reconciliation | Whether the statement population and balance were reconciled through the required workflow |
| PipeLedger delivery | Whether eligible context was delivered and acknowledged; this is distinct from later matching and publication |

For example, a posting may be verified while bank matching is still pending. The
receipt then directs the operator to continue matching the existing posting, not
to recreate it.

## How the package exposes failure and uncertainty

The package is designed to preserve awkward outcomes rather than smooth them into
a success metric:

- Missing local evidence is indexed as **Missing**. A source-system locator can
  remain **Reference only** without pretending that bytes were retained.
- A changed proposal remains in the lineage as **superseded**; the replacement
  does not rewrite the first recommendation or approval history.
- A timeout or ambiguous provider response remains **execution uncertain** until
  read-only reconciliation establishes whether a native record exists. It is not
  silently converted into a clean first-attempt success.
- An approved but undispatched action remains **unattempted**.
- Posting verification, matching, statement reconciliation and context delivery
  may disagree and remain independently visible.
- Missing measurements are reported as **Not measured**, not zero.
- Successful execution is not labeled accounting accuracy. Accuracy requires a
  separately recorded, conclusive independent review of the approved treatment.

## A practical evaluation

Ask PipeLedger to produce a read-only review from your own published history
before enabling writes. For any operation you intend to commission, choose a
representative sandbox canary and verify that you can trace:

1. the controller row to its immutable proposal record and evidence references;
2. the exact approval to its authorization event;
3. the authorization to one dispatch attempt;
4. the native result reference to record-specific read-back and posting evidence;
5. every outstanding match, reconciliation or delivery step to the completion
   receipt; and
6. every packaged file to the manifest inventory and hash.

That exercise tests the system itself. It does not rely on fictional completion
rates or a curated claim about how quickly a batch was processed.

[Back to the accounting-agent overview](../README.md) ·
[QuickBooks guide](https://pipeledger.ai/guides/quickbooks-accounting-agent) ·
[NetSuite guide](https://pipeledger.ai/guides/netsuite-accounting-agent)
