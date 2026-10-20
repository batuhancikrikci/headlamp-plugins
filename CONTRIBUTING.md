# Contributing

Thank you for helping to improve these Headlamp plugins. Bug reports, ideas and pull requests are
welcome.

## Before you start

- For a bug, open an issue with the plugin, the versions and the steps to reproduce it.
- For a larger change, open an issue first so the approach can be discussed.
- Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## Repository layout

Every plugin lives in its own directory and is built, tested and released on its own:

```text
<plugin>/
  src/
    common/        Shared building blocks, identical in every plugin
    plugin.ts      Identity of the plugin, used by src/common
    ...            The plugin's own code
  scripts/         build-icons.mjs and deploy.mjs, identical in every plugin
  package.json     Scripts, dependencies and metadata
  artifacthub-pkg.yml, CHANGELOG.md, LICENSE, NOTICE
scripts/           Repository tools (check-common.mjs, update-artifacthub.mjs, artifacthub-digest.mjs,
                   deploy-all.sh)
```

## Development

You need Node.js 20.11 or newer and npm 10 or newer. In the directory of a plugin:

```bash
npm ci
npm start          # rebuilds on every change and copies the result into the local Headlamp
npm run check      # type-check, lint and unit tests
```

The README of each plugin lists all commands.

## Shared files

`src/common/`, `scripts/build-icons.mjs`, `scripts/deploy.mjs`, `tsconfig.json`, `.gitignore`,
`.prettierignore`, `.vscode/` and `LICENSE` are the same in every plugin. Each plugin keeps its own
copy, so it can be built and published without the others. When you change one of these files:

1. make the change in one plugin,
2. copy the file unchanged to the same path in every other plugin,
3. run `node scripts/check-common.mjs` from the repository root (CI runs it too).

Plugin-specific details do not belong in these files: put them in `src/plugin.ts` or pass them as
props.

## Pull requests

- Keep a pull request focused on one change.
- Run `npm run check` in every plugin you changed, and `npm run format` to format the code.
- Add or update unit tests for logic changes; pure logic lives in modules without Headlamp imports
  so it can be tested.
- Include screenshots for UI changes.
- After changing a plugin's `README.md`, `artifacthub-pkg.yml` or logo, run
  `node scripts/artifacthub-digest.mjs` so that Artifact Hub and the Headlamp plugin catalog pick
  up the change. Links in a plugin's README must be absolute: Artifact Hub and the catalog show the
  README outside the repository.
- The UI text is English; keep it short and consistent with the existing wording.

Commit messages use the form `<plugin>: <what changed>`, for example
`cilium: Show BGP session state in the node list`, or `all: ...` for changes to the shared files.
Explain in the body why the change is needed.

## License

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).
