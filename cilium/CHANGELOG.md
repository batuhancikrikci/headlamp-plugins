# Changelog

All notable changes to the Cilium plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses
[semantic versioning](https://semver.org/).

## [0.2.0] — unreleased

### Added

- **Cluster Mesh** page: this cluster's name and ID with what keeps it out of a mesh, the Cluster
  Mesh settings of `cilium-config`, the Cluster Mesh API server (pods, version, KVStoreMesh, how
  other clusters reach its Service), and the remote clusters from the `clustermesh-remote-users`
  ConfigMap, the agents' host aliases and, when Prometheus has them, the agents'
  `cilium_clustermesh_remote_cluster_*` metrics (ready agents, failures in the last hour, last
  failure). The `cilium-clustermesh` Secret is not read.
- **Global services**: the services marked `service.cilium.io/global` with their shared,
  affinity and EndpointSlice sync settings; a dialog edits them (merge patch of the annotations)
  and makes other services global. Global services also show the settings in the Cilium section
  of Headlamp's Service page.
- **Connect a cluster** wizard: reads another cluster configured in Headlamp, checks the
  documented prerequisites (unique names and IDs, the same maximum of connected clusters, the
  same datapath mode, non-overlapping pod CIDRs, Cilium versions, API servers) and gives the
  `cilium clustermesh` commands or the Helm values for both sides. It applies nothing.

## [0.1.0] — 2026-10-20

First public release.
