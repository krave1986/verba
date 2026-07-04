import * as vscode from "vscode";
import { cacheChildEntries, convertCacheMapToUriSet } from "./cache.js";
import { getRootUri } from "../utils/workspace.js";
import { reconcileAllCheckedUrisWithFileSystem } from "../utils/reconcileWithFileSystem.js";
import { disposableRegistry } from "../utils/toVscodeDisposable.js";
import { debounceTime, Observable } from "rxjs";

export function traverseWorkspaceFileAndBuildMap() {
    // 从 根uri 开始下潜
    return traverseDown(getRootUri());
}

const traverseDown = async (parentEntryUri) => {
    // 因为我们希望可以尽快拿到这一层的子条目，并写入 Map 中，
    // 所以先不下潜，而是读完之后，马上写入。
    const subEntries = await vscode.workspace.fs.readDirectory(parentEntryUri);
    // 拿到子目录后，直接写入 Map
    cacheChildEntries(parentEntryUri.toString(), subEntries);
    // 此处返回的迭代器，之所以没有调用 toArray() 来生成新的数组，
    // 是因为后面利用了 Promise.all() 自带的遍历迭代器的底层实现。
    // 这样的写法，是该场景下，数组迭代最少的方式！
    const directorySubEntries = subEntries
        .values()
        .filter(([, entryType]) => entryType === vscode.FileType.Directory)
        .map(([name]) =>
            traverseDown(vscode.Uri.joinPath(parentEntryUri, name)),
        );
    return Promise.all(directorySubEntries);
};

export async function synchronouslyBuildWorkspaceFileTree(
    shouldFollowUpWithReconcileAfterRebuild = false,
) {
    // 直接调用建树方法
    await traverseWorkspaceFileAndBuildMap();
    // 然后根据 followUp 判断要不要走 reconcile
    shouldFollowUpWithReconcileAfterRebuild &&
        reconcileAllCheckedUrisWithFileSystem(
            convertCacheMapToUriSet(getRootUri().toString()),
        );
}

export const asynchronouslyBuildWorkspaceFileTree = (() => {
    let debouncedBuildSubscriber;
    let followUp;

    disposableRegistry.register(
        new Observable((subscriber) => {
            debouncedBuildSubscriber = subscriber;
            // 返回空函数作为 teardown，表示没有自定义清理逻辑。
            // RxJS 框架自身的脱钩行为（标记 subscription 关闭、切断 observer 链接）
            // 由框架内部自动处理，无需在此手动实现。
            return () => {};
        })
            .pipe(debounceTime(200))
            .subscribe({
                next: () => {
                    synchronouslyBuildWorkspaceFileTree(followUp);
                    followUp = false;
                },
            }),
    );

    return (shouldFollowUpWithReconcileAfterRebuild = false) => {
        // 只有当 followUp 为 false 时，才赋值。
        // 以防 onDidCreate 和 onDidDelete 混合触发时，
        // onDidCreate 在后面，把后续的 uri 比对给取消了。
        followUp ||= shouldFollowUpWithReconcileAfterRebuild;
        // 往 observable 中推事件
        debouncedBuildSubscriber.next();
    };
})();
