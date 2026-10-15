# Inline skills

Autocomplete `$skill-name` mentions and turn them into file references to skills
Pi has already discovered.

I kept typing stuff like "use the engineering-standard skill" when I wanted to point
Pi at a specific skill. This adds Codex-style `$skill-name` completion with fuzzy
search, so I don't have to remember the file's path.

## Install

```sh
pi install npm:@dylanhalstead/pi-inline-skills
```

## Usage

```text
use the $engineering-standard skill"
```

Type `$` in the TUI editor to search discovered skills. On submission, `$name`
becomes a file reference such as `@/absolute/path/to/skill/SKILL.md`. Unknown
names stay unchanged. No configuration is needed.

The extension does not load skill instructions. The model decides whether to
read the referenced file (which it will almost always read).

## Important limitations

- Mentions inside code fences are also replaced. Use `\$name` to keep a mention
  literal; the backslash stays in the prompt.
- Absolute skill paths become part of the prompt and session transcript and are
  sent to the selected model provider.
