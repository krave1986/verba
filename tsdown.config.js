import { defineConfig } from "tsdown";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(
    await readFile(new URL("./package.json", import.meta.url), "utf-8"),
);

export default defineConfig({
    entry: ["src/extension.js"],
    platform: "node",
    deps: {
        neverBundle: ["vscode"],
        alwaysBundle: Object.keys(pkg.dependencies ?? {}),
        onlyBundle: Object.keys(pkg.dependencies ?? {}),
    },
    format: ["esm"],
    shims: true,
});
