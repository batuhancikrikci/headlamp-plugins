# Changelog

All notable changes to the Inference Hub plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses
[semantic versioning](https://semver.org/).

## [0.4.0] — unreleased

### Removed

- Benchmark no longer keeps the last runs in the browser, and removes the runs stored by 0.3.0.
  Export a run as CSV or JSON to keep it.

### Fixed

- Lists and objects no page uses any more are dropped from memory after five minutes, so a long
  session no longer keeps every list it ever opened.

## [0.3.0] — 2026-11-02

### Added

- Edit endpoints with a form or the deploy wizard: "Edit" opens one page with the settings of
  the live endpoint and the review below them; "Switch to the wizard" opens the same edit as the
  steps of the deploy wizard, keeping what was entered. Both change only the settings you touch,
  keep everything the form does not show, and review the change as a YAML diff before saving
  with the live resourceVersion. The placement check counts the GPUs of the edited endpoint as
  free. The model and the served model name of an endpoint cannot change in any edit, Edit YAML
  included.
- Diagnose tab on the endpoint page: checks the conditions, the model cache, scheduling, image
  pulls, crashes and OOM kills, the model download, readiness and the llm-d scheduler, and on
  request scans the logs for known failures, each with evidence and a fix. The Command Center
  links endpoints that need attention to it.
- Ask a model: sends the diagnosis (secrets masked, reviewed before sending) to another model
  running in the cluster through the Kubernetes API proxy and shows its answer and reasoning.
  Follow-up questions continue the conversation; each request sends the whole conversation, and
  New conversation starts over. The token limit is set in the panel (16384 by default), Thinking
  can be turned off for models whose chat template reads enable_thinking (Qwen3 and others), an
  answer cut off by the limit, stopped or interrupted by an error can be continued, and a
  request that does not fit in the model's context length says so. It has a switch in Settings.
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

- The deploy wizard suggests served model names without the organization, in lowercase and
  without dots, e.g. `qwen35-122b-a10b-fp8` for `hf://Qwen/Qwen3.5-122B-A10B-FP8`.
- Updated the bundled Simple Icons set.

## [0.2.1] — 2026-10-20

First public release.
