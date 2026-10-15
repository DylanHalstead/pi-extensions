import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  AutocompleteProviderFactory,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionEvent,
  InputEvent,
  InputEventResult,
  MarkdownTransformer,
  RegisteredCommand,
  SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import { vi } from "vite-plus/test";

export function model(id: string, provider = "test"): Model<Api> {
  return {
    id,
    provider,
    name: id,
    api: "anthropic-messages",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8192,
  };
}

export function skill(name: string, path: string): SlashCommandInfo {
  return {
    name: `skill:${name}`,
    description: `Use ${name}`,
    source: "skill",
    sourceInfo: { path, source: "test", scope: "user", origin: "top-level" },
  };
}

export function createPiFixture() {
  type Handler = (event: ExtensionEvent, ctx: ExtensionContext) => unknown;
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, RegisteredCommand["handler"]>();
  const shortcuts = new Map<string, (ctx: ExtensionContext) => unknown>();
  const autocomplete: AutocompleteProviderFactory[] = [];
  const markdown: MarkdownTransformer[] = [];
  const setModel = vi.fn<(target: Model<Api>) => Promise<boolean>>().mockResolvedValue(true);
  const getCommands = vi.fn<() => SlashCommandInfo[]>().mockReturnValue([]);
  const getBranch = vi.fn().mockReturnValue([]);
  const ui = {
    notify: vi.fn(),
    setStatus: vi.fn(),
    setEditorText: vi.fn(),
    confirm: vi
      .fn<
        (title: string, message: string, options?: { signal?: AbortSignal }) => Promise<boolean>
      >()
      .mockResolvedValue(true),
    addAutocompleteProvider: (factory: AutocompleteProviderFactory) => autocomplete.push(factory),
  };
  // These deliberately incomplete doubles cover only the APIs the extensions use.
  const ctx = {
    mode: "tui",
    hasUI: true,
    model: undefined as Model<Api> | undefined,
    ui,
    sessionManager: { getBranch },
  } as unknown as ExtensionContext;
  const pi = {
    on(name: string, handler: Handler) {
      const registered = handlers.get(name) ?? [];
      registered.push(handler);
      handlers.set(name, registered);
      return () => {
        handlers.set(
          name,
          registered.filter((entry) => entry !== handler),
        );
      };
    },
    registerCommand: (name: string, options: Pick<RegisteredCommand, "handler">) =>
      commands.set(name, options.handler),
    registerShortcut: (key: string, options: { handler: (ctx: ExtensionContext) => unknown }) =>
      shortcuts.set(key, options.handler),
    registerMarkdownTransformer: (transformer: MarkdownTransformer) => markdown.push(transformer),
    setModel,
    getCommands,
  } as unknown as ExtensionAPI;

  async function emit(event: { type: string; [key: string]: unknown }): Promise<void> {
    if (event.type === "model_select") {
      (ctx as unknown as { model: Model<Api> | undefined }).model = event.model as Model<Api>;
    }
    for (const handler of handlers.get(event.type) ?? []) {
      await handler(event as ExtensionEvent, ctx);
    }
  }

  async function input(
    text: string,
    options: Partial<Omit<InputEvent, "type" | "text">> = {},
  ): Promise<InputEventResult> {
    // Exercise one extension's handler directly, not Pi's input dispatch pipeline.
    const registered = handlers.get("input") ?? [];
    if (registered.length !== 1) throw new Error("Expected exactly one input handler");
    const event: InputEvent = { type: "input", text, source: "interactive", ...options };
    return (
      ((await registered[0]!(event, ctx)) as InputEventResult | undefined) ?? {
        action: "continue",
      }
    );
  }

  return {
    pi,
    ctx,
    ui,
    emit,
    input,
    setModel,
    getCommands,
    getBranch,
    autocomplete,
    markdown,
    async command(name: string) {
      const handler = commands.get(name);
      if (!handler) throw new Error(`Unknown command: ${name}`);
      await handler("", ctx as ExtensionCommandContext);
    },
    async shortcut(key: string) {
      const handler = shortcuts.get(key);
      if (!handler) throw new Error(`Unknown shortcut: ${key}`);
      await handler(ctx);
    },
  };
}
