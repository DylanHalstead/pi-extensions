import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { expectPackagedExtensionToLoad } from "./helpers/installed-extension.ts";

let root: string;

function pack(output: string): void {
  execFileSync(
    "pnpm",
    ["--dir", "extensions/example", "pack", "--ignore-scripts", "--out", output],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function manifest(directory: string, fields: Record<string, unknown>): void {
  mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, directory, "package.json"), JSON.stringify(fields));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi private libraries "));
  vi.stubEnv("npm_config_offline", "true");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", private: true }));
  writeFileSync(join(root, "LICENSE"), "Fixture license\n");
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - extensions/*\n  - packages/*\nautoInstallPeers: false\n",
  );
  for (const name of ["base", "library", "dev-only"]) {
    const directory = `packages/${name}`;
    manifest(directory, {
      name: `@example/${name}`,
      version: "1.0.0",
      private: true,
      type: "module",
      files: ["dist"],
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      scripts: { build: "node build.mjs" },
      ...(name === "library"
        ? {
            dependencies: { "@example/base": "workspace:*" },
            peerDependencies: { "@earendil-works/pi-ai": "*" },
          }
        : {}),
    });
    writeFileSync(
      join(root, directory, "build.mjs"),
      `import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
${name === "library" ? 'readFileSync("../base/dist/index.js");' : ""}
mkdirSync("dist", { recursive: true });
copyFileSync("source.js", "dist/index.js");
writeFileSync("dist/index.d.ts", "export declare const message: string;\\n");
writeFileSync("dist/data.json", JSON.stringify({ message: "Built private library" }));
`,
    );
    writeFileSync(
      join(root, directory, "source.js"),
      name === "library"
        ? `export { message } from "@example/base";
export { modelsAreEqual as hostEqual } from "@earendil-works/pi-ai";
`
        : `import { readFileSync } from "node:fs";
export const message = JSON.parse(readFileSync(new URL("./data.json", import.meta.url), "utf8")).message;
`,
    );
    writeFileSync(join(root, directory, "source.test.ts"), "// Not a runtime artifact.\n");
  }
  manifest("extensions/example", {
    name: "@dylanhalstead/pi-example",
    version: "1.0.0",
    type: "module",
    license: "MIT",
    keywords: ["pi-package"],
    publishConfig: { access: "public" },
    files: ["src/index.ts", "src/completion.ts", "README.md", "LICENSE"],
    pi: { extensions: ["./src/index.ts"] },
    dependencies: { "@example/library": "workspace:*" },
    devDependencies: { "@example/dev-only": "workspace:*" },
    bundledDependencies: ["@example/library"],
    peerDependencies: { "@earendil-works/pi-ai": "*" },
  });
  mkdirSync(join(root, "extensions/example/src"));
  writeFileSync(join(root, "extensions/example/README.md"), "# Fixture\n");
  writeFileSync(
    join(root, "extensions/example/src/completion.ts"),
    'export const command = "hello";\n',
  );
  writeFileSync(
    join(root, "extensions/example/src/index.ts"),
    `import { message, hostEqual } from "@example/library";
import { modelsAreEqual } from "@earendil-works/pi-ai";
import { command } from "./completion.ts";
if (message !== "Built private library") throw new Error("Incorrect library artifact");
if (hostEqual !== modelsAreEqual) throw new Error("Duplicate Pi host module");
export default function (pi) {
  pi.registerCommand(command, { description: message, handler: async () => {} });
}
`,
  );
  execFileSync("pnpm", ["install", "--ignore-scripts"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  execFileSync("pnpm", ["--recursive", "--if-present", "run", "build"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it("builds and ships private runtime libraries transitively, without development dependencies or host copies", async () => {
  const output = join(root, "extension.tgz");
  pack(output);
  await expectPackagedExtensionToLoad(output, "@dylanhalstead/pi-example");
  const files = execFileSync("tar", ["-tzf", output], { encoding: "utf8" }).split("\n");
  expect(files).toContain("package/src/completion.ts");
  expect(files).toContain("package/LICENSE");
  for (const library of ["base", "library"]) {
    expect(files).toContain(`package/node_modules/@example/${library}/dist/index.js`);
    expect(files).toContain(`package/node_modules/@example/${library}/dist/index.d.ts`);
    expect(files).toContain(`package/node_modules/@example/${library}/dist/data.json`);
  }
  expect(files.some((path) => /dev-only|source\.|build\.mjs|@earendil-works/.test(path))).toBe(
    false,
  );
});

it("detects an installed package that omits a private library's compiled entrypoint", async () => {
  const file = join(root, "packages/base/package.json");
  const base = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...base, files: ["dist/data.json"] }));
  const output = join(root, "broken.tgz");
  pack(output);
  await expect(expectPackagedExtensionToLoad(output, "@dylanhalstead/pi-example")).rejects.toThrow(
    "Installed extension must load without errors",
  );
});
