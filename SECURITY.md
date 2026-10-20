# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Report them privately through
GitHub: open the repository's **Security** tab and choose
**[Report a vulnerability](https://github.com/batuhancikrikci/headlamp-plugins/security/advisories/new)**.

Include the plugin and its version, the Headlamp version, and the steps to reproduce the problem.
You will get an answer as soon as possible; fixes are released as a new version of the affected
plugin and announced in a GitHub security advisory.

## Supported versions

Only the latest release of each plugin receives security fixes.

## Scope

The plugins run inside Headlamp with the permissions of the signed-in Kubernetes user; they have
no backend and no service account of their own. Vulnerabilities in Headlamp itself should be
reported to the [Headlamp project](https://github.com/kubernetes-sigs/headlamp/security).
