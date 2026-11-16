# Contributing

Contributions are welcome. Please open an issue first for larger changes and
include a clear description of the proposed behavior.

Before submitting a pull request, run:

```bash
npm ci
npm run build
npm test
npm run plugin:validate
```

Do not commit local printer configurations, credentials, logs, or generated
`.flexplugin` packages. The generated manifest and UI files must be changed
through their source files and the build process.

By contributing, you agree that your contribution may be distributed under
the MIT License in `LICENSE`.
