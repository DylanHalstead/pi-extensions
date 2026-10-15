import { modelsAreEqual, type Api, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, InputEvent } from "@earendil-works/pi-coding-agent";

function modelLabel(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

interface PendingSwitch {
  from: Model<Api>;
  to: Model<Api>;
}

interface SwitchOperation {
  change: PendingSwitch;
  generation: number;
}

interface Confirmation extends SwitchOperation {
  controller: AbortController;
}

export default function modelSwitchGuard(pi: ExtensionAPI): void {
  let pendingSwitch: PendingSwitch | undefined;
  let reverting: SwitchOperation | undefined;
  let confirmation: Confirmation | undefined;
  let generation = 0;
  let hasHadTurn = false;

  function isCurrent(operation: SwitchOperation): boolean {
    return generation === operation.generation;
  }

  function notify(
    ctx: ExtensionContext,
    message: string,
    type: "info" | "warning" | "error",
  ): void {
    try {
      ctx.ui.notify(message, type);
    } catch {
      // Pi invalidates a replaced session's context while asynchronous work settles.
    }
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    try {
      ctx.ui.setStatus(
        "model-switch-guard",
        pendingSwitch
          ? `⇄ model: ${modelLabel(pendingSwitch.from)} → ${modelLabel(pendingSwitch.to)} (ctrl+alt+m to revert)`
          : undefined,
      );
    } catch {
      // The lifecycle handlers can race session replacement after their event is delivered.
    }
  }

  function invalidate(): void {
    generation += 1;
    confirmation?.controller.abort();
    confirmation = undefined;
    reverting = undefined;
  }

  function resetSession(_event: unknown, ctx: ExtensionContext): void {
    invalidate();
    pendingSwitch = undefined;
    hasHadTurn = ctx.sessionManager
      .getBranch()
      .some((entry) => entry.type === "message" && entry.message.role === "assistant");
    updateStatus(ctx);
  }

  async function revertModel(ctx: ExtensionContext): Promise<void> {
    const change = pendingSwitch;
    if (!change || reverting) return;

    const operation = { change, generation };
    reverting = operation;
    try {
      const restored = await pi.setModel(change.from);
      if (!isCurrent(operation) || reverting !== operation) return;
      if (!restored) {
        notify(
          ctx,
          `Could not revert to ${modelLabel(change.from)}. Check provider authentication; the switch remains pending.`,
          "error",
        );
        return;
      }

      // setModel normally emits model_select; this also handles hosts that have already updated ctx.model.
      const isRestored = modelsAreEqual(ctx.model, change.from);
      if (pendingSwitch === change && isRestored) pendingSwitch = undefined;
      updateStatus(ctx);
      if (isRestored) notify(ctx, `Reverted to ${modelLabel(change.from)}`, "info");
    } catch (error) {
      if (!isCurrent(operation) || reverting !== operation) return;
      notify(
        ctx,
        `Could not revert to ${modelLabel(change.from)}: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    } finally {
      if (reverting === operation) reverting = undefined;
    }
  }

  function restorePrompt(
    event: InputEvent,
    ctx: ExtensionContext,
    operation: SwitchOperation,
  ): void {
    if (!isCurrent(operation)) return;
    try {
      // Pi supplies the current input-chain text, not the original before other transformations.
      ctx.ui.setEditorText(event.text);
    } catch {
      return;
    }
    notify(
      ctx,
      event.images?.length
        ? "Prompt text restored. Reattach images before resubmitting; Pi's editor API cannot restore attachments."
        : "Your prompt was restored to the editor.",
      event.images?.length ? "warning" : "info",
    );
  }

  async function undoSwitch(ctx: ExtensionContext): Promise<void> {
    if (ctx.mode !== "tui") return;
    if (!pendingSwitch) {
      notify(ctx, "No pending model switch to revert", "info");
      return;
    }
    await revertModel(ctx);
  }

  pi.on("session_start", resetSession);
  pi.on("session_tree", resetSession);
  pi.on("session_shutdown", () => {
    invalidate();
    pendingSwitch = undefined;
  });
  pi.on("turn_start", () => {
    hasHadTurn = true;
  });

  pi.on("model_select", (event, ctx) => {
    if (ctx.mode !== "tui" || event.source === "restore" || !hasHadTurn || !event.previousModel)
      return;
    if (modelsAreEqual(event.previousModel, event.model)) return;
    pendingSwitch =
      pendingSwitch && modelsAreEqual(event.model, pendingSwitch.from)
        ? undefined
        : { from: pendingSwitch?.from ?? event.previousModel, to: event.model };
    updateStatus(ctx);
  });

  pi.registerShortcut("ctrl+alt+m", {
    description: "Undo a pending model switch",
    handler: undoSwitch,
  });
  pi.registerCommand("model-undo", {
    description: "Revert an unconfirmed switch to its original model",
    handler: (_args, ctx) => undoSwitch(ctx),
  });

  pi.on("input", async (event, ctx) => {
    const change = pendingSwitch;
    if (ctx.mode !== "tui" || event.source !== "interactive" || !change || !event.text.trim()) {
      return { action: "continue" };
    }

    const operation = { change, generation };
    if (reverting || confirmation) {
      restorePrompt(event, ctx, operation);
      return { action: "handled" };
    }

    const controller = new AbortController();
    const activeConfirmation = { ...operation, controller };
    confirmation = activeConfirmation;
    let proceed = false;
    try {
      proceed = await ctx.ui.confirm(
        "Model was just changed",
        `Send this prompt using ${modelLabel(change.to)}?\n\nPrevious model: ${modelLabel(change.from)}\n\nChoose No to revert and keep your prompt in the editor.`,
        { signal: controller.signal },
      );
    } catch (error) {
      if (isCurrent(activeConfirmation) && confirmation === activeConfirmation) {
        notify(
          ctx,
          `Could not confirm the model switch: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        restorePrompt(event, ctx, activeConfirmation);
      }
      return { action: "handled" };
    } finally {
      if (confirmation === activeConfirmation) confirmation = undefined;
    }

    if (
      !isCurrent(activeConfirmation) ||
      pendingSwitch !== change ||
      reverting ||
      !modelsAreEqual(ctx.model, change.to)
    ) {
      restorePrompt(event, ctx, activeConfirmation);
      if (isCurrent(activeConfirmation)) {
        notify(
          ctx,
          "The model changed while confirming. Review it before resubmitting.",
          "warning",
        );
      }
      return { action: "handled" };
    }
    if (proceed) {
      pendingSwitch = undefined;
      updateStatus(ctx);
      return { action: "continue" };
    }
    await revertModel(ctx);
    restorePrompt(event, ctx, activeConfirmation);
    return { action: "handled" };
  });
}
