import * as vscode from "vscode";

export function getRootUri() {
    return vscode.workspace.workspaceFolders?.[0].uri ?? "";
}

export function getRelativePath(uri) {
    return uri.path.slice(getRootUri().path.length + 1);
}

// ───────────── workspaceState 存储封装 ─────────────
// 方法名刻意与 vscode 的 Memento API 逐字一致，让两套名字坍缩成一份心智：
// 出错时栈里看到的名字，就是要查的 API 名字。
// context.workspaceState 在整个激活周期内固定不变，故只需 init 一次。

/** @type {import("vscode").Memento} */
let workspaceState;

/**
 * 在 activate 中调用一次，注入当前扩展的 workspaceState。
 * ⚠️ 必须在使用 workspaceStore 的任何方法之前调用。
 * @param {import("vscode").ExtensionContext} context
 */
export function initWorkspaceStore(context) {
    workspaceState = context.workspaceState;
}

export const workspaceStore = {
    /**
     * 取值。沿用 Memento.get。
     * 传了 defaultValue 时，key 不存在则返回它（Memento 原生支持的重载）。
     * @template T
     * @param {string} key
     * @param {T} [defaultValue]
     * @returns {T | undefined}
     */
    get: (key, defaultValue) => workspaceState.get(key, defaultValue),

    /**
     * 存值。沿用 Memento.update。
     * ⚠️ 异步：返回 Promise。写完不立即读可不 await；写完要马上读到则必须 await。
     * @param {string} key
     * @param {unknown} value
     * @returns {Thenable<void>}
     */
    update: (key, value) => workspaceState.update(key, value),

    /**
     * 删除一个 key。
     * ⚠️ Memento 没有原生 delete 方法 —— 删除的约定是写入 undefined。
     * 此方法封装该约定，返回 Promise（同 update，异步落盘）。
     * @param {string} key
     * @returns {Thenable<void>}
     */
    delete: (key) => workspaceState.update(key, undefined),

    /**
     * 列出当前存储的所有 key。沿用 Memento.keys。
     * @returns {readonly string[]}
     */
    keys: () => workspaceState.keys(),
};
