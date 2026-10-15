# Contributing

I maintain these extensions for my own setup. Bug reports and fixes are welcome.
For bug reports, include your Pi version and steps to reproduce the problem.

Use the Node and pnpm versions in `.tool-versions`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm format
pnpm verify
```

Keep changes focused and add a regression test when practical. Try the changed
behavior in Pi before opening a PR; automated checks don't cover terminal
interaction or authentication.
