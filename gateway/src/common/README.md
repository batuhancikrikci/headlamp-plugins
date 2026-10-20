# src/common

Building blocks shared by every plugin in this repository. Each plugin keeps its own copy, and
the copies are **identical**: change a file here, then copy it unchanged to the same path in the
other plugins. Plugin-specific details are not written here; they come from `src/plugin.ts`
(the plugin's identity) or from props.

| File                | What it provides                                                                   |
| ------------------- | ---------------------------------------------------------------------------------- |
| `i18n.ts`           | `t()` / `useText()`: English text with `{{param}}` placeholders                    |
| `kubeVersion.ts`    | Kubernetes API version ordering (`compareKubeVersions`, `orderVersions`)           |
| `objects.ts`        | Immutable path helpers (`getIn`, `setIn`), edit cleanup and name validators        |
| `yaml.ts`           | YAML dump/parse and form ↔ YAML synchronization (`fromYaml`, `sameJson`)           |
| `ErrorBoundary.tsx` | `ErrorBoundary` and `withBoundary()` for routes                                    |
| `States.tsx`        | Loading, empty, error, forbidden, "not installed" and "unsupported version" states |
| `CodeBlock.tsx`     | Read-only monospace block for YAML, JSON and commands                              |
| `icons.ts`          | Registers the offline icon bundle (`src/icons/bundle.json`)                        |
| `pluginInfo.ts`     | The `PluginInfo` type that `src/plugin.ts` fills in                                |
| `form/`             | Fields, YAML field, editor dialog, wizards, validation registry, safe apply        |
| `docs/`             | CRD field documentation: schema helpers, viewer, side panel, kind introductions    |

The scripts in `scripts/` (`build-icons.mjs`, `deploy.mjs`) follow the same rule.
