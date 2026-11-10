# Changelog

All notable changes to the Headlamp Plus plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses
[semantic versioning](https://semver.org/).

## [0.2.0] — unreleased

### Added

- **Namespace overview** at the top of each namespace page: pods, workloads, jobs and volume
  claims; what needs attention, including claims that stay unbound and quotas at 90 % or more;
  the use of every ResourceQuota, or the pods' requests against their usage when there is no
  quota; the pods using the most CPU and memory (metrics API); and the usage trend. Headlamp's own
  sections (quotas, limit ranges, pods, events) stay below it.
- **Usage trend** on the cluster and namespace dashboards: CPU and memory used over the last
  hour, 6 hours, day or week from Prometheus (cAdvisor container metrics), with the allocatable
  capacity or the namespace quota as a dashed line. A Prometheus compatible service is found
  automatically or can be entered by hand for the session.
- **Node overview** at the top of each node page: requests, limits and usage against what the node
  can allocate, pod slots, conditions and failing pods, taints, the heaviest pods and the node's
  usage trend.
- **Dashboards** sidebar group with six dashboards:
  - **Storage:** claims, volumes (released and failed ones), the default storage class, claims
    and capacity per class, and the fullest volumes from the kubelet's volume stats.
  - **Security:** privileged pods, host namespaces and host paths, powerful capabilities, UID 0,
    missing memory limits, Pod Security levels per namespace and cluster-admin bindings.
  - **Network:** services by type, load balancers without an address, services without ready
    endpoints, ingresses without an address or backend, namespaces without NetworkPolicy.
  - **Jobs:** cron jobs with their recent runs, missed runs, failing streaks and runs outlasting
    their schedule; failed and running jobs.
  - **Upgrade readiness:** kubelet version skew, PodDisruptionBudgets that block drains and
    deprecated APIs still requested.
  - **Resource efficiency:** requested against used CPU and memory per workload, now or over the
    last 24 hours.

### Changed

- The namespace dashboard lines up with the inset of Headlamp's own detail sections.

## [0.1.0] — 2026-10-20

First public release.
