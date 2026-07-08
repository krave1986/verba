import * as vscode from "vscode";

/** @type {Map<string, [string, number][]>} */
const parentUriToChildEntriesMap = new Map();

/**
 * 读取某个目录的子条目缓存。
 * 返回 undefined 表示缓存未命中（该目录尚未被扫描）。
 * @param {string} parentUriString
 * @returns {[string, number][] | undefined}
 */
export function readChildEntries(parentUriString) {
    return parentUriToChildEntriesMap.get(parentUriString);
}

export function getCachedDirectoryUris() {
    return parentUriToChildEntriesMap.keys();
}

/**
 * 将某个目录的子条目写入缓存。
 * 只在键和值都完整准备好后调用。
 * @param {string} parentUriString
 * @param {[string, number][]} entries
 */
export function cacheChildEntries(parentUriString, entries) {
    parentUriToChildEntriesMap.set(parentUriString, entries);
}

/**
 * 清空整个工作区文件树缓存。
 * 在需要重建缓存时调用（如 include/exclude 配置变更、工作区变更）。
 */
export function clearWorkspaceFileTreeCache() {
    parentUriToChildEntriesMap.clear();
}

export function convertCacheMapToUriSet(rootUriString) {
    const uriSet = new Set(
        parentUriToChildEntriesMap.entries().flatMap(function* ([
            parentEntryUriString,
            subEntryUris,
        ]) {
            yield parentEntryUriString;
            const parentEntryUri = vscode.Uri.parse(parentEntryUriString);
            yield* subEntryUris.values().map(([entryName, _entryType]) => {
                return vscode.Uri.joinPath(
                    parentEntryUri,
                    entryName,
                ).toString();
            });
        }),
    );
    uriSet.delete(rootUriString);
    return uriSet;
}
