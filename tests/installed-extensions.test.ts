import { execFileSync } from "node:child_process";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, it } from "vite-plus/test";
import { expectPackagedExtensionToLoad } from "./helpers/installed-extension.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

beforeAll(() => {
  execFileSync("pnpm", ["build"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
});

it.each(globSync("extensions/*/package.json", { cwd: root }))(
  "loads the packed extension from %s outside the workspace",
  async (manifestFile) => {
    const { name } = JSON.parse(readFileSync(join(root, manifestFile), "utf8"));
    const directory = mkdtempSync(join(tmpdir(), "pi-extension-tarball-"));
    try {
      const tarball = join(directory, "package.tgz");
      execFileSync(
        "pnpm",
        ["--dir", dirname(manifestFile), "pack", "--ignore-scripts", "--out", tarball],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
      );
      await expectPackagedExtensionToLoad(tarball, name);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
