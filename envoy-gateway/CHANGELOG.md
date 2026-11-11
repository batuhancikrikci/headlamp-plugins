# Changelog

All notable changes to the Envoy Gateway plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses
[semantic versioning](https://semver.org/).

## [0.1.2] — 2026-11-11

### Fixed

- Opening an object from a reference link (for example the target HTTPRoute in a policy list)
  crashed its details page with "Cannot read properties of undefined (reading 'rules')". The link
  handed Headlamp a name-only object, which the details page rendered instead of loading the real
  one; it now only navigates.

## [0.1.1] — 2026-11-02

### Fixed

- Policies and routes no longer look broken because of old status entries the controller left
  behind for removed targets or parents; the policy status and the route problems of the
  Overview only consider entries the controller still maintains.

## [0.1.0] — 2026-10-20

First public release.
