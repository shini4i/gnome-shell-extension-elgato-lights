import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.js", "discovery.js"],
      exclude: ["**/*.test.js"],
    },
  },
  resolve: {
    alias: {
      "gi://Gio": resolve(__dirname, "tests/__mocks__/gio.js"),
      "gi://GLib": resolve(__dirname, "tests/__mocks__/glib.js"),
    },
  },
});
