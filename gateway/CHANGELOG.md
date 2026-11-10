# Changelog

All notable changes to the Gateway API plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses
[semantic versioning](https://semver.org/).

## [0.2.0] — unreleased

### Added

- **GRPCRoute wizard**: parents → hostnames → methods (fully qualified service and optional
  method, with header matches) → filters → backends → summary, like the HTTPRoute wizard. The
  Create button of GRPCRoutes opens it; the form and YAML stay available.

## [0.1.1] — 2026-11-02

### Fixed

- A route whose parent was changed no longer stays Pending because of the status entry the
  controller left behind for the removed parent; the Overview condition count ignores it too.
- A BackendTLSPolicy no longer stays Pending because of ancestors the controller stopped
  maintaining (for example after a target was removed).

## [0.1.0] — 2026-10-20

First public release.
