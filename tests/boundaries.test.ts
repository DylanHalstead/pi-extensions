import { spawnSync } from "node:child_process";
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vite-plus/test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

it("keeps workspace dependencies independent and Pi modules host-provided", () => {
  const packages = globSync(["extensions/*/package.json", "packages/*/package.json"], {
    cwd: root,
  }).map((path) => ({ path, manifest: JSON.parse(readFileSync(join(root, path), "utf8")) }));
  const extensions = new Set(
    packages
      .filter(({ path }) => path.startsWith("extensions/"))
      .map(({ manifest }) => manifest.name),
  );
  const hostModules = new Set([
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "typebox",
  ]);

  for (const { path, manifest } of packages) {
    if (path.startsWith("packages/")) {
      expect(manifest.private, manifest.name).toBe(true);
      expect(manifest.name.startsWith("@dylanhalstead/pi-"), manifest.name).toBe(false);
    }
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        const context = `${manifest.name}: ${field}.${name}`;
        expect(extensions.has(name), context).toBe(false);
        if (hostModules.has(name)) {
          expect(field, context).toBe("peerDependencies");
          expect(range, context).toBe("*");
        }
      }
    }
    for (const bundled of [manifest.bundledDependencies, manifest.bundleDependencies]) {
      if (!Array.isArray(bundled)) continue;
      for (const name of bundled) {
        expect(
          extensions.has(name) || hostModules.has(name),
          `${manifest.name}: bundled ${name}`,
        ).toBe(false);
      }
    }
  }
});

it("blocks extension package imports in source and tests while allowing libraries and relative imports", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-import-boundaries-"));
  try {
    writeFileSync(
      join(temporary, "package.json"),
      JSON.stringify({ name: "import-boundaries-fixture", private: true, type: "module" }),
    );
    symlinkSync(join(root, "node_modules"), join(temporary, "node_modules"), "junction");
    // Exercise the actual lint rules without unrelated unresolved-import type errors.
    writeFileSync(
      join(temporary, "vite.config.ts"),
      `import config from ${JSON.stringify(pathToFileURL(join(root, "vite.config.ts")).href)};
export default {
  lint: { ...config.lint, options: { typeAware: false, typeCheck: false } },
};
`,
    );
    const blocked: string[] = [];
    for (const owner of ["extensions/example", "packages/library"]) {
      const directory = join(temporary, owner, "src");
      mkdirSync(directory, { recursive: true });
      for (const suffix of [".ts", ".test.ts"]) {
        for (const [index, source] of [
          "@dylanhalstead/pi-future-extension",
          "@dylanhalstead/pi-future-extension/internal/module",
          "@dylanhalstead/skill-references",
          "@earendil-works/pi-ai",
          "./autocomplete.ts",
          "../types.ts",
        ].entries()) {
          const file = `${owner}/src/import-${index}${suffix}`;
          writeFileSync(join(temporary, file), `import ${JSON.stringify(source)};\n`);
          if (index < 2) blocked.push(file);
        }
      }
    }
    const result = spawnSync(
      join(root, "node_modules/.bin/vp"),
      ["lint", "extensions", "packages", "--format=json"],
      {
        cwd: temporary,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    if (result.error) throw new Error(`${result.error.message}\n${result.stderr.slice(-2000)}`);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout, result.stderr).not.toBe("");
    const diagnostics = JSON.parse(result.stdout).diagnostics as {
      code: string;
      filename: string;
    }[];
    expect(diagnostics.every((entry) => entry.code.includes("no-restricted-imports"))).toBe(true);
    expect(diagnostics.map((entry) => entry.filename).sort()).toEqual(blocked.sort());
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
