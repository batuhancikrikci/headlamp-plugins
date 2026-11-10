# Changelog

All notable changes to the Agent Router plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses
[semantic versioning](https://semver.org/).

## [0.3.0] — unreleased

### Added

- Token usage on the overview: input and output tokens and requests per model over the last
  hour, day or week, from the `gen_ai_client_token_usage` metrics Agent Router exports.
- Estimated quota fill on the overview and the QuotaPolicy page, for default buckets and service
  quotas: the total tokens of the backend and model over the quota window, since the quota
  service does not export its counters. Quotas with a custom cost expression or a one-second
  window are shown without an estimate.
- Prometheus (or Thanos, Mimir, VictoriaMetrics) is found automatically through the Kubernetes
  service proxy; another service can be entered as `namespace/service:port` for the session.

## [0.2.0] — 2026-10-20

First public release.
