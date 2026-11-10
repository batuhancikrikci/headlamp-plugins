# Changelog

All notable changes to the Monitoring plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses
[semantic versioning](https://semver.org/).

## [0.4.0] — unreleased

### Added

- Backtest for alerting rules in the PrometheusRule form: the expression is run as a range query
  over the last 1 hour to 7 days at the evaluation interval of its group, and the form shows how
  often, when and on which series the alert would have fired, taking `for` and
  `keep_firing_for` into account. Nothing is saved or sent to Alertmanager.

## [0.3.0] — 2026-10-20

First public release.
