# Security

## Reporting a vulnerability

Email **support@pipeledger.ai** with the subject line "Security report".

Please do not open a public issue, and do not post details anywhere public
before PipeLedger has had a chance to respond.

PipeLedger Communication Hub inside app.pipeledger.ai is available for customers with daily response times

Include:

- what you found and where (the CLI, the MCP endpoint, the web application,
  or the documentation);
- the steps to reproduce it;
- the CLI version from `pl --version`, if relevant.

Do not include credentials, tokens, or financial records in the report. If a
credential may have been exposed, ask an Owner or Admin to revoke it in
PipeLedger first.

Reports are tracked for triage. This page does not establish a response-time
commitment. PipeLedger's security posture is described at
<https://pipeledger.ai/trust>.

## Testing

Test only against an organization you own or are authorized to use. Do not
attempt to reach another organization's data, disrupt the service, or run
automated scanning against production endpoints.

## Supported versions

Security fixes are released in the latest version of `@pipeledger/cli`.
Upgrade with:

```bash
npm install -g @pipeledger/cli@latest
```
