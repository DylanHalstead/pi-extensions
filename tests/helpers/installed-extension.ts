import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

/** Install a tarball outside the workspace and assert Pi loads it without personal configuration. */
export async function expectPackagedExtensionToLoad(tarball: string, name: string): Promise<void> {
  const installation = mkdtempSync(join(tmpdir(), "pi-installed-extension-"));
  try {
    // Mirror Pi: no lifecycle scripts or automatic peer installation.
    execFileSync(
      "npm",
      [
        "install",
        "--prefix",
        installation,
        "--ignore-scripts",
        "--omit=dev",
        "--legacy-peer-deps",
        "--no-audit",
        "--no-fund",
        tarball,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const installed = join(installation, "node_modules", name);
    const loader = new DefaultResourceLoader({
      cwd: installation,
      agentDir: join(installation, ".pi"),
      settingsManager: SettingsManager.inMemory(),
      noExtensions: true,
      disabledBuiltinExtensions: ["mcp", "codemode", "tool-search"],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalExtensionPaths: [installed],
    });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, [], "Installed extension must load without errors");
    assert(
      result.extensions.some((extension) => extension.path.startsWith(`${installed}${sep}`)),
      "Installed package must load at least one extension",
    );
  } finally {
    rmSync(installation, { recursive: true, force: true });
  }
}
