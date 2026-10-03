# Changelog

Changes to the PipeLedger command-line client, `@pipeledger/cli`, by release.
Each version here is a version published to
[npm](https://www.npmjs.com/package/@pipeledger/cli). The source in
[`cli/`](cli) starts at 0.1.2.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is below 1.0.0, a minor release may change a command or its
output.

Changes to the hosted PipeLedger service are not listed here. The service
validates every request, so a change in what a command returns can come from
the service without a new CLI release.

## [0.1.2] - 2026-10-02

### Upgrading from 0.1.1

Saved credentials moved. Sign in again with `pl login`, or move an existing
credential file into `~/.pipeledger/profiles/`.

### Added

- **Profiles for several organizations.** Each saved credential is a named
  profile. `pl login` saves one for each organization and accepts
  `--profile <name>`. `pl switch` lists the saved profiles and sets the
  default. Every command accepts `--profile`, and `PIPELEDGER_PROFILE` selects
  a profile for a shell session.
- **`pl link [name]`** links the folder you are in to a saved profile. The
  link is a `.pipeledger.json` file that names the profile and its
  organization and holds no credential, so the folder can be synced or shared.
- **`pl init [name]`** creates the working folder for an organization, with
  starter agent instructions and the folder link. It contacts no server and
  never replaces an existing file.
- **`pl logout`** removes the saved credential `pl` is using and names the
  profile in use afterwards. It runs locally and does not revoke the
  credential; revocation stays with an Owner or Admin.
- `pl whoami` prints the profile in use, how it was selected, and when the
  credential's access ends, with the days remaining.
- `pl catalog account-classification list`, with `--account-name-contains`
  and `--account-id`.
- `pl resolve --action context` reads the published company, group, and
  ownership context that the credential is permitted to see.
- `pl run preflight` checks a pipeline run without starting it, and
  `pl run list` lists pipelines, enabled datasets, and recent runs.
- `pl unit-register periods` inspects unit posting-period locks.
- Financial reports in text format print the coverage of the report period
  and of the comparison period when the service returns it.

### Changed

- Saved credentials live only in `~/.pipeledger/profiles/`, one file for each
  profile. `~/.pipeledger/config.json` and `~/.config/pipeledger/` are no
  longer read. `PIPELEDGER_CONFIG_FILE` and `PIPELEDGER_CREDENTIAL_SECRET`
  work as before.
- When several profiles are saved and none is selected, `pl` stops and lists
  them. It no longer uses the first file it finds.

### Security

- Conflicting credential selectors are rejected. An environment credential
  can no longer silently outrank `--profile` or a linked folder.
- Before any financial request from a linked folder, `pl` confirms with the
  service that the credential belongs to the organization the folder names.
- A saved profile cannot be overwritten with a credential for a different
  organization.
- HTTP redirects are refused.

## [0.1.1] - 2026-09-28

Corrections from the first end-to-end evaluation of 0.1.0. None affected a
reported figure.

### Fixed

- `pl resolve`: a directory listing printed a blank label and reporting id.
- `pl report`: the publication notice for a Balance Sheet was not shown.
- `pl whoami`: a scoped credential printed raw source keys on the Scope line.
  It now prints a count for each dimension and says where the names are.
- `pl report`: a fiscal year outside 2000 to 2100 now gets a message that
  states the accepted range.
- README: how to check for Node.js, and what it means when the system offers
  a different `pl` package.

## [0.1.0] - 2026-09-28

First release on npm.

[0.1.2]: https://github.com/pipeledger/pipeledger-tools/releases/tag/cli-v0.1.2
[0.1.1]: https://www.npmjs.com/package/@pipeledger/cli/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/@pipeledger/cli/v/0.1.0
