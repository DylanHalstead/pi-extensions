import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createPiFixture, model } from "../../../tests/fixtures/pi.ts";
import modelSwitchGuard from "./index.ts";

describe("model switch guard", () => {
  let fixture: ReturnType<typeof createPiFixture>;
  const original = model("original");
  const next = model("next");
  const third = model("third");

  async function switchModel(from = original, to = next, source = "cycle"): Promise<void> {
    await fixture.emit({ type: "model_select", previousModel: from, model: to, source });
  }
  async function arm(): Promise<void> {
    await fixture.emit({ type: "turn_start" });
    await switchModel();
  }

  beforeEach(async () => {
    fixture = createPiFixture();
    modelSwitchGuard(fixture.pi);
    await fixture.emit({ type: "session_start", reason: "startup" });
  });

  it("allows selecting models before the first turn", async () => {
    await switchModel();
    expect(await fixture.input("hello")).toEqual({ action: "continue" });
    expect(fixture.ui.confirm).not.toHaveBeenCalled();
  });

  it("confirms only the first prompt after a switch", async () => {
    await arm();
    expect(await fixture.input("hello")).toEqual({ action: "continue" });
    expect(fixture.ui.confirm).toHaveBeenCalledWith(
      "Model was just changed",
      expect.stringContaining("test/next"),
      { signal: expect.any(AbortSignal) },
    );
    await fixture.input("again");
    expect(fixture.ui.confirm).toHaveBeenCalledTimes(1);
    expect(fixture.setModel).not.toHaveBeenCalled();
  });

  it("declining restores the original model and exact received input", async () => {
    await arm();
    fixture.ui.confirm.mockResolvedValue(false);
    fixture.setModel.mockImplementation(async (target) => {
      await switchModel(next, target, "set");
      return true;
    });
    const text = "first\nReview @/skills/review/SKILL.md, then continue.";
    expect(await fixture.input(text)).toEqual({ action: "handled" });
    expect(fixture.setModel).toHaveBeenCalledWith(original);
    expect(fixture.ui.setEditorText).toHaveBeenCalledWith(text);
    expect(fixture.ui.setStatus).toHaveBeenLastCalledWith("model-switch-guard", undefined);
    expect(await fixture.input("again")).toEqual({ action: "continue" });
    expect(fixture.ui.confirm).toHaveBeenCalledTimes(1);
  });

  it.each(["false", "throw"])(
    "keeps the guard armed and prompt intact when restoration fails (%s)",
    async (failure) => {
      await arm();
      fixture.ui.confirm.mockResolvedValue(false);
      if (failure === "false") fixture.setModel.mockResolvedValue(false);
      else fixture.setModel.mockRejectedValue(new Error("Provider unavailable"));
      expect(await fixture.input("keep this")).toEqual({ action: "handled" });
      expect(fixture.ui.setEditorText).toHaveBeenCalledWith("keep this");
      expect(fixture.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Could not revert"),
        "error",
      );
      expect(fixture.ui.notify).not.toHaveBeenCalledWith(
        expect.stringContaining("Reverted to"),
        "info",
      );
      await fixture.input("retry");
      expect(fixture.ui.confirm).toHaveBeenCalledTimes(2);
      expect(fixture.setModel).toHaveBeenCalledTimes(2);
    },
  );

  it("retains the original model across chained switches", async () => {
    await arm();
    await switchModel(next, third);
    await fixture.command("model-undo");
    expect(fixture.setModel).toHaveBeenCalledWith(original);
  });

  it("distinguishes models whose display labels collide", async () => {
    const slashProvider = model("model", "custom/team");
    const slashId = model("team/model", "custom");
    await fixture.emit({ type: "turn_start" });
    await switchModel(slashProvider, slashId);
    await fixture.input("hello");
    expect(fixture.ui.confirm).toHaveBeenCalledTimes(1);
  });

  it("does not approve a prompt while undo is in progress", async () => {
    await arm();
    let finishRestore: ((restored: boolean) => void) | undefined;
    fixture.setModel.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRestore = resolve;
        }),
    );
    const undo = fixture.command("model-undo");
    await Promise.resolve();
    expect(await fixture.input("keep this")).toEqual({ action: "handled" });
    expect(fixture.ui.confirm).not.toHaveBeenCalled();
    expect(fixture.ui.setEditorText).toHaveBeenCalledWith("keep this");
    finishRestore!(true);
    await undo;
  });

  it("reconciles an undo that overlaps a later model selection", async () => {
    await arm();
    let finishRestore: ((restored: boolean) => void) | undefined;
    fixture.setModel.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRestore = resolve;
        }),
    );
    const undo = fixture.command("model-undo");
    await Promise.resolve();
    await switchModel(next, third);
    await switchModel(third, original, "set");
    finishRestore!(true);
    await undo;
    expect(await fixture.input("hello")).toEqual({ action: "continue" });
    expect(fixture.ui.confirm).not.toHaveBeenCalled();
  });

  it("selecting the original model resolves a pending switch", async () => {
    await arm();
    await switchModel(next, original);
    await fixture.input("hello");
    expect(fixture.ui.confirm).not.toHaveBeenCalled();
  });

  it("supports the undo shortcut and reports when nothing is pending", async () => {
    await fixture.shortcut("ctrl+alt+m");
    expect(fixture.ui.notify).toHaveBeenCalledWith("No pending model switch to revert", "info");
    await arm();
    await fixture.shortcut("ctrl+alt+m");
    expect(fixture.setModel).toHaveBeenCalledWith(original);
  });

  it("ignores restores, initial selection, and no-op selections", async () => {
    await fixture.emit({ type: "turn_start" });
    await switchModel(original, next, "restore");
    await switchModel(original, original);
    await fixture.emit({ type: "model_select", model: next, source: "set" });
    await fixture.input("hello");
    expect(fixture.ui.confirm).not.toHaveBeenCalled();
  });

  it("arms resumed sessions with assistant history and resets on session replacement", async () => {
    fixture.getBranch.mockReturnValue([{ type: "message", message: { role: "assistant" } }]);
    await fixture.emit({ type: "session_start", reason: "resume" });
    await switchModel();
    await fixture.input("hello");
    expect(fixture.ui.confirm).toHaveBeenCalledTimes(1);
    await switchModel(next, third);
    fixture.getBranch.mockReturnValue([]);
    await fixture.emit({ type: "session_start", reason: "new" });
    await fixture.input("new session");
    expect(fixture.ui.confirm).toHaveBeenCalledTimes(1);
  });

  it("reconstructs state after tree navigation", async () => {
    await arm();
    await fixture.emit({ type: "session_tree" });
    await fixture.input("hello");
    expect(fixture.ui.confirm).not.toHaveBeenCalled();
  });

  it("does not confirm empty input or extension-generated input", async () => {
    await arm();
    await fixture.input(" \n ");
    await fixture.input("generated", { source: "extension" });
    expect(fixture.ui.confirm).not.toHaveBeenCalled();
    await fixture.input("hello");
    expect(fixture.ui.confirm).toHaveBeenCalledTimes(1);
  });

  it.each(["print", "json", "rpc"] as const)(
    "does not call UI or change models in %s mode",
    async (mode) => {
      fixture.ctx.mode = mode;
      fixture.ui.setStatus.mockClear();
      await fixture.emit({ type: "session_start", reason: "startup" });
      await arm();
      expect(await fixture.input("hello")).toEqual({ action: "continue" });
      await fixture.command("model-undo");
      await fixture.shortcut("ctrl+alt+m");
      expect(fixture.ui.setStatus).not.toHaveBeenCalled();
      expect(fixture.ui.notify).not.toHaveBeenCalled();
      expect(fixture.ui.confirm).not.toHaveBeenCalled();
      expect(fixture.setModel).not.toHaveBeenCalled();
    },
  );

  it("does not send when confirmation throws", async () => {
    await arm();
    fixture.ui.confirm.mockRejectedValue(new Error("Dialog closed"));
    expect(await fixture.input("keep this")).toEqual({ action: "handled" });
    expect(fixture.ui.setEditorText).toHaveBeenCalledWith("keep this");
    expect(fixture.setModel).not.toHaveBeenCalled();
  });

  it("cancels an open confirmation during session shutdown", async () => {
    await arm();
    fixture.ui.confirm.mockImplementation(
      (_title, _message, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("Dialog closed")));
        }),
    );
    const input = fixture.input("keep this");
    await Promise.resolve();
    await fixture.emit({ type: "session_shutdown", reason: "new" });
    expect(await input).toEqual({ action: "handled" });
    expect(fixture.ui.setEditorText).not.toHaveBeenCalled();
  });

  it("invalidates confirmation during tree navigation", async () => {
    await arm();
    fixture.ui.confirm.mockImplementation(
      (_title, _message, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("Dialog closed")));
        }),
    );
    const input = fixture.input("keep this");
    await Promise.resolve();
    await fixture.emit({ type: "session_tree", newLeafId: "new", oldLeafId: "old" });
    expect(await input).toEqual({ action: "handled" });
    expect(fixture.ui.setEditorText).not.toHaveBeenCalled();
  });

  it("does not fail open when restoration outlives the session", async () => {
    await arm();
    fixture.ui.confirm.mockResolvedValue(false);
    let finishRestore: ((restored: boolean) => void) | undefined;
    fixture.setModel.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRestore = resolve;
        }),
    );
    const input = fixture.input("keep this");
    await Promise.resolve();
    await fixture.emit({ type: "session_shutdown", reason: "new" });
    finishRestore!(true);
    expect(await input).toEqual({ action: "handled" });
    expect(fixture.ui.setEditorText).not.toHaveBeenCalled();
  });

  it("requires another submission if the model changes while confirming", async () => {
    await arm();
    fixture.ui.confirm.mockImplementation(async () => {
      await switchModel(next, third);
      return true;
    });
    expect(await fixture.input("keep this")).toEqual({ action: "handled" });
    expect(fixture.ui.setEditorText).toHaveBeenCalledWith("keep this");
    expect(fixture.setModel).not.toHaveBeenCalled();
  });

  it("warns that declined image attachments need to be reattached", async () => {
    await arm();
    fixture.ui.confirm.mockResolvedValue(false);
    await fixture.input("look", {
      images: [{ type: "image", data: "data", mimeType: "image/png" }],
    });
    expect(fixture.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Reattach images"),
      "warning",
    );
  });
});
