# Changelog

All notable changes to the Inference Hub plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses
[semantic versioning](https://semver.org/).

## [0.3.0] — unreleased

### Added

- Edit endpoints with the deploy wizard: "Edit" opens the wizard on the live endpoint, changes
  only the settings you touch, keeps everything the form does not show, and reviews the change
  as a YAML diff before saving with the live resourceVersion. The placement check counts the
  GPUs of the edited endpoint as free.
- Diagnose tab on the endpoint page: checks the conditions, the model cache, scheduling, image
  pulls, crashes and OOM kills, the model download, readiness and the llm-d scheduler, and on
  request scans the logs for known failures, each with evidence and a fix. The Command Center
  links endpoints that need attention to it.
- Ask a model: sends the diagnosis (secrets masked, reviewed before sending) to another model
  running in the cluster through the Kubernetes API proxy and shows its answer and reasoning.
  It has a switch in Settings.
- Publish to Agent Router: the endpoint page lists the AI routes that use the endpoint and adds
  a rule for its model names to an existing or new AIGatewayRoute, through its InferencePool or
  through a Backend and AIServiceBackend owned by the endpoint, with a ReferenceGrant for other
  namespaces. Agent Router appears as an optional stack in Platform Readiness.
- GPU Efficiency page: GPU utilization, requests and tokens per GPU-hour of every endpoint and
  GPU pod over 1 hour, 24 hours or 7 days, idle and underused workloads with a stop action, and
  the idle GPUs of the last hour in the Command Center.
- Benchmark mode in the Playground: latency and throughput of one or two endpoints under a
  fixed concurrency, with the peak queue and KV cache use of the servers, CSV and JSON export
  and the last runs kept in the browser.

### Fixed

- InferencePools and routes no longer look failed because of old status entries of Gateways
  that no longer route to them.

### Changed

- Updated the bundled Simple Icons set.

## [0.2.1] — 2026-10-20

First public release.
