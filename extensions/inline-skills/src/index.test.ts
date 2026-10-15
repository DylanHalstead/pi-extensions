import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createPiFixture, skill } from "../../../tests/fixtures/pi.ts";
import inlineSkills from "./index.ts";

describe("inline skills", () => {
  const path = "/skills/review/SKILL.md";
  let fixture: ReturnType<typeof createPiFixture>;

  beforeEach(() => {
    fixture = createPiFixture();
    fixture.getCommands.mockReturnValue([skill("review", path)]);
    inlineSkills(fixture.pi);
  });

  it("replaces inline names with file references and retains surrounding text and images", async () => {
    const images = [{ type: "image" as const, data: "image-data", mimeType: "image/png" }];
    expect(await fixture.input("First line\n$review, then $review.", { images })).toEqual({
      action: "transform",
      images,
      text: `First line\n@${path}, then @${path}.`,
    });
  });

  it.each([
    "$unknown",
    "$review_extra",
    "$reviewX",
    "$reviewé",
    "$review-",
    "\\$review",
    "word$review",
    "/skill:review Review this code",
  ])("leaves unknown, escaped, malformed, and native commands unchanged: %s", async (text) => {
    expect(await fixture.input(text)).toEqual({ action: "continue" });
  });

  it("does not reference commands that are not skills", async () => {
    const command = skill("review", path);
    fixture.getCommands.mockReturnValue([{ ...command, source: "extension" }]);
    expect(await fixture.input("$review")).toEqual({ action: "continue" });
  });

  it("uses discovered locations without reading or checking skill files", async () => {
    fixture.getCommands.mockReturnValue([skill("missing", "/missing/skill/SKILL.md")]);
    expect(await fixture.input("Consider $missing for this task.")).toEqual({
      action: "transform",
      text: "Consider @/missing/skill/SKILL.md for this task.",
    });
    expect(fixture.ui.notify).not.toHaveBeenCalled();
  });

  it.each([
    ["/skills/path with spaces/SKILL.md", '@"/skills/path with spaces/SKILL.md"'],
    ["/skills/line\nbreak/SKILL.md", '@"/skills/line\nbreak/SKILL.md"'],
    ["/skills/中文/SKILL.md", "@/skills/中文/SKILL.md"],
    ["/skills/中文、目录/SKILL.md", '@"/skills/中文、目录/SKILL.md"'],
    ["/skills/review—notes/SKILL.md", '@"/skills/review—notes/SKILL.md"'],
    ['/skills/a"&<.md', '@/skills/a"&<.md'],
    ["C:\\skills\\review\\SKILL.md", "@C:\\skills\\review\\SKILL.md"],
  ])("matches Pi file-completion quoting for %s", async (sourcePath, reference) => {
    fixture.getCommands.mockReturnValue([skill("review", sourcePath)]);
    expect(await fixture.input("$review")).toEqual({ action: "transform", text: reference });
  });

  it("does not hide references or rewrite existing skill blocks in transcript rendering", async () => {
    expect(fixture.markdown).toHaveLength(0);
    const text = '<skill name="review" location="/skills/review/SKILL.md">\nExample.\n</skill>';
    expect(await fixture.input(text)).toEqual({ action: "continue" });
  });

  it("leaves generated references unchanged on resubmission", async () => {
    const result = await fixture.input("Please $review");
    expect(result).toEqual({ action: "transform", text: `Please @${path}` });
    if (result.action !== "transform") throw new Error("Expected a file reference");
    expect(await fixture.input(result.text)).toEqual({ action: "continue" });
  });

  it.each(["print", "json", "rpc"] as const)(
    "references skills in %s mode without terminal autocomplete",
    async (mode) => {
      fixture.ctx.mode = mode;
      fixture.ctx.hasUI = mode === "rpc";
      await fixture.emit({ type: "session_start", reason: "startup" });
      expect(fixture.autocomplete).toHaveLength(0);
      expect(
        await fixture.input("$review", { source: mode === "rpc" ? "rpc" : "interactive" }),
      ).toEqual({ action: "transform", text: `@${path}` });
    },
  );

  it("omits autocomplete descriptions when discovery provides none", async () => {
    const command = skill("review", path);
    delete command.description;
    fixture.getCommands.mockReturnValue([command]);
    await fixture.emit({ type: "session_start", reason: "startup" });
    const factory = fixture.autocomplete[0];
    if (!factory) throw new Error("Expected autocomplete registration");
    const provider = factory({
      getSuggestions: vi.fn().mockResolvedValue(null),
      applyCompletion: vi.fn(),
    });
    expect(
      await provider.getSuggestions(["$rev"], 0, 4, { signal: new AbortController().signal }),
    ).toEqual({
      prefix: "$rev",
      items: [{ value: "$review", label: "review" }],
    });
  });

  it("adds skill completion while delegating other input and preserving existing triggers", async () => {
    await fixture.emit({ type: "session_start", reason: "startup" });
    const getSuggestions = vi.fn().mockResolvedValue(null);
    const applyCompletion = vi
      .fn()
      .mockReturnValue({ lines: ["file"], cursorLine: 0, cursorCol: 4 });
    const options = { signal: new AbortController().signal };
    const current: AutocompleteProvider = {
      triggerCharacters: ["@"],
      getSuggestions,
      applyCompletion,
      shouldTriggerFileCompletion: vi.fn().mockReturnValue(false),
    };
    const factory = fixture.autocomplete[0];
    if (!factory) throw new Error("Expected autocomplete registration");
    const provider = factory(current);
    expect(provider.triggerCharacters).toEqual(["@", "$"]);
    expect(await provider.getSuggestions(["Use $rev"], 0, 8, options)).toEqual({
      prefix: "$rev",
      items: [{ value: "$review", label: "review", description: "Use review" }],
    });
    expect(
      provider.applyCompletion(
        ["Use $rev now"],
        0,
        8,
        { value: "$review", label: "review" },
        "$rev",
      ),
    ).toEqual({ lines: ["Use $review now"], cursorLine: 0, cursorCol: 11 });
    await provider.getSuggestions(["@file"], 0, 5, options);
    expect(getSuggestions).toHaveBeenCalled();
    provider.applyCompletion(["@file"], 0, 5, { value: "file", label: "file" }, "@file");
    expect(applyCompletion).toHaveBeenCalled();
    expect(provider.shouldTriggerFileCompletion?.(["@file"], 0, 5)).toBe(false);
    expect(await provider.getSuggestions(["$nomatch"], 0, 8, options)).toBeNull();
  });
});
