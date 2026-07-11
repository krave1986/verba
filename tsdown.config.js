import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/extension.js"],
    platform: "node",
    deps: {
        neverBundle: ["vscode"],
    },
    format: ["esm"],
    shims: true,
});
