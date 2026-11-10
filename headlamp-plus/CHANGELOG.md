# Changelog

All notable changes to the Headlamp Plus plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses
[semantic versioning](https://semver.org/).

## [0.2.0] — 2026-11-10

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

## [0.1.0] — 2026-10-20

First public release.
