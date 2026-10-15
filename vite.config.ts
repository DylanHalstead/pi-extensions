import { defineConfig } from "vite-plus";

const extensionImports = {
  group: ["@dylanhalstead/pi-*", "@dylanhalstead/pi-*/**"],
  message: "The @dylanhalstead/pi-* prefix is reserved for extensions.",
};

export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ["packages/*/src/**/*.ts"],
        rules: {
          "no-restricted-imports": ["error", { patterns: [extensionImports] }],
        },
      },
      {
        files: ["extensions/*/src/**/*.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                extensionImports,
                {
                  group: ["../../**"],
                  message:
                    "Extensions must not import sibling extensions. Extract reusable code into a library package.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["extensions/*/src/**/*.test.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                extensionImports,
                {
                  group: ["../../*/src/**"],
                  message:
                    "Package tests must exercise their own extension without importing sibling extensions.",
                },
              ],
            },
          ],
        },
      },
    ],
  },
  test: {
    include: ["extensions/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
    allowOnly: false,
  },
});
