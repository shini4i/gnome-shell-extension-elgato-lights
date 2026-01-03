import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";

export default defineConfig([
  js.configs.recommended,

  globalIgnores(["node_modules/**"]),

  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // GJS globals
        imports: "readonly",
        log: "readonly",
        logError: "readonly",
        print: "readonly",
        printerr: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        // Node.js globals for tests
        console: "readonly",
        // Vitest globals
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
]);
