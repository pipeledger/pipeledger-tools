# Contributing

This repository holds the documentation for PipeLedger's tools, the
command-line client and the hosted MCP server, and the source of the
command-line client in `cli/`. It does not hold the source of the MCP server
or the PipeLedger service.

## What is welcome

- Corrections to anything in these documents that is wrong, unclear, or out
  of date.
- Reports of a problem installing or running the CLI.
- Reports of a step in a guide that did not work as written.
- Fixes to the command-line client. `cli/` is exported from PipeLedger's
  development repository, so an accepted fix is applied there and reaches
  this repository with the next export; the pull request itself is closed
  with a reference to it.

## What cannot be accepted here

- Changes to the PipeLedger service, its data pipeline, or its ERP
  connectors. Their source is not in this repository.
- Feature requests for the service. Send those to support@pipeledger.ai.

## How to contribute

1. For a small correction, open a pull request.
2. For anything larger, open an issue first and describe the change.

Changes reach `main` only through a pull request.

## Before you post anything

This repository is public. Never include a credential, a token, a client
secret, financial records, account names, or customer and vendor names. See
[SUPPORT.md](SUPPORT.md) for what a useful report contains, and
[SECURITY.md](SECURITY.md) for reporting a vulnerability privately.

## License

By contributing, you agree that your contribution is licensed under the
Apache License, Version 2.0, the same license as this repository.
