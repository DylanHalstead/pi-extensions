import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AutocompleteProvider, fuzzyFilter } from "@earendil-works/pi-tui";

// A word-like suffix must not turn a malformed reference into a shorter valid one.
const INLINE_SKILL = /(^|\s)\$([a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)(?=$|[^\p{L}\p{N}_-])/gu;
const INLINE_SKILL_PREFIX = /(?:^|\s)(\$[^\s$]*)$/;
// Match Pi file completion; its separator regex and formatter are not public exports.
const FILE_REFERENCE_SEPARATOR =
  /(?:\s|(?=\p{Punctuation})[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]|[，．：；！？（）［］｛｝“”‘’…—])/u;

function getSkills(pi: ExtensionAPI) {
  return pi
    .getCommands()
    .filter((command) => command.source === "skill")
    .map((command) => ({
      name: command.name.slice("skill:".length),
      path: command.sourceInfo.path,
      description: command.description,
    }));
}

function createAutocompleteProvider(
  pi: ExtensionAPI,
  current: AutocompleteProvider,
): AutocompleteProvider {
  return {
    triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), "$"])],
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      const prefix = textBeforeCursor.match(INLINE_SKILL_PREFIX)?.[1];
      if (prefix === undefined) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const items = fuzzyFilter(getSkills(pi), prefix.slice(1), (skill) => skill.name).map(
        ({ name, description }) => ({
          value: `$${name}`,
          label: name,
          ...(description === undefined ? {} : { description }),
        }),
      );
      return items.length > 0 ? { items, prefix } : null;
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (!prefix.startsWith("$")) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }
      const currentLine = lines[cursorLine] ?? "";
      const completedLines = [...lines];
      completedLines[cursorLine] =
        currentLine.slice(0, cursorCol - prefix.length) + item.value + currentLine.slice(cursorCol);
      return {
        lines: completedLines,
        cursorLine,
        cursorCol: cursorCol - prefix.length + item.value.length,
      };
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

export default function inlineSkills(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") {
      ctx.ui.addAutocompleteProvider((current) => createAutocompleteProvider(pi, current));
    }
  });

  pi.on("input", (event) => {
    const skills = new Map(getSkills(pi).map((skill) => [skill.name, skill]));
    const text = event.text.replace(
      INLINE_SKILL,
      (reference: string, whitespace: string, name: string) => {
        const skill = skills.get(name);
        if (!skill) return reference;
        const path = skill.path;
        const fileReference = FILE_REFERENCE_SEPARATOR.test(path) ? `@"${path}"` : `@${path}`;
        return `${whitespace}${fileReference}`;
      },
    );

    return text === event.text
      ? { action: "continue" }
      : {
          action: "transform",
          text,
          ...(event.images === undefined ? {} : { images: event.images }),
        };
  });
}
