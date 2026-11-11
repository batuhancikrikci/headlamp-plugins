# Changelog

All notable changes to the Inference Hub plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses
[semantic versioning](https://semver.org/).

## [0.6.0] — unreleased

### Changed

- New model server picker in the Playground (chat, benchmark, embed & rerank) and in "Ask a
  model": the field shows the chosen server with its model and health, and opens a panel with a
  namespace filter (remembered for the session), a search over names and models, a filter for
  endpoints, gateway routes and vLLM pods, and "ready only".

### Fixed

- Choosing a model in the Playground could be undone by the background refresh: the rebuilt list
  reset the picker's search and highlight, and a server that dropped out of the list for a
  moment cleared the chosen one. Unchanged entries now keep their objects, and the chosen server
  stays until another one is picked.

## [0.5.0] — 2026-11-10

### Added

- Namespace quota check in the resources and scaling steps of the deploy wizard and the edit
  form: the model server pods (at the minimum and at the autoscaling maximum) against every
  ResourceQuota of the namespace for GPUs, CPU, memory and pods. A quota on CPU limits is
  flagged, since the pods set no CPU limit, unless a LimitRange gives a default. When an
  endpoint is edited, its current pods count as released. Scoped quotas are not checked.
- The GPU quota and usage of the namespace's Kueue queues (LocalQueue → ClusterQueue) are shown
  next to it, and Kueue appears as an optional stack in the platform readiness check.
- Playground tool calling: function definitions in the OpenAI format (with an example) and the
  tool choice are sent with each message. The calls the model makes are shown with their
  arguments (invalid JSON is flagged); the results entered for them go back to the model, which
  continues the answer. A server without tool calling set up gets a hint about vLLM's
  `--enable-auto-tool-choice` and `--tool-call-parser`.
- Playground image input for vision-language models: up to four PNG, JPEG, WebP or GIF images
  per message, scaled down to 1536 px; "Copy as curl" leaves the image data out.
- Playground **Embed & rerank** mode for pooling models: embeds texts with `/v1/embeddings` and
  shows their cosine similarity, or orders documents by relevance to a query with
  `/v1/rerank`, with tokens and latency.

## [0.4.0] — 2026-11-10

### Added

- Playground, Benchmark and Ask a model can reach an endpoint through a gateway: through the
  route KServe manages for an LLMInferenceService or through an Agent Router route, so the
  requests run the gateway's routing, llm-d scheduler and policies. The Envoy Gateway
  SecurityPolicy of the gateway or route is explained, and request headers such as an API key
  can be added for the session.
- Benchmark concurrency sweep: the test at 1, 2, 4, … concurrent requests up to the chosen
  maximum, stopping at the first level that misses a TTFT p95 goal. The highest level within
  the goal gives the load one replica handles and the replicas for an expected peak, with the
  autoscaling YAML (a KEDA trigger on the running and waiting requests of an
  LLMInferenceService, the concurrency target of an InferenceService) and a link to the edit
  form with those replicas.
- The edit form and the edit wizard warn when someone changes or deletes the endpoint while it
  is being edited; Reload starts again from the current version.

### Removed

- Benchmark no longer keeps the last runs in the browser, and removes the runs stored by 0.3.0.
  Export a run as CSV or JSON to keep it.

### Changed

- The scaling step explains that LLMInferenceService autoscaling needs KEDA triggers in
  spec.scaling.keda on KServe 0.21 and later (the workload variant autoscaler on earlier
  releases).
- Pods are listed per GPU node instead of across the whole cluster, and the warning events of
  the Command Center per endpoint namespace (plus `default`, where cluster-scoped objects such as
  ClusterPolicy record theirs), so pages stay light on clusters with thousands of pods. vLLM
  servers that run on nodes without GPUs are no longer listed.

### Fixed

- Saving an edit no longer fails when KServe only updated the status of the endpoint since the
  edit was opened.
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
