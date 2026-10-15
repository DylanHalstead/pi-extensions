# Development

- Use pnpm and the project-local Vite+ CLI. Run `pnpm verify` before handing off changes.
- Keep extensions independent under `extensions/*`. Shared libraries belong in `packages/*`, stay private, and ship inside consuming extensions.
- Keep Pi host modules in peer dependencies; the root pins development copies.
- Publish TypeScript extension source. Build library exports as JavaScript/declarations.
- Build before packing with native `pnpm pack --ignore-scripts`; use filters to select extensions. Run `pnpm verify` before a manual release.
- Use imperative, subject-only commit messages with at most 50 characters.
