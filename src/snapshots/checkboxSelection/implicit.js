import { workspaceStore } from "../../utils/workspace.js";
import { debounceTime } from "rxjs";
import { toVscodeDisposable } from "../../utils/toVscodeDisposable.js";

export function loadLastCheckedUris() {
    return workspaceStore.get("verba.lastCheckedUris") ?? [];
}

/**
 * 隐式快照：订阅勾选集合的变化，防抖后自动写入 workspaceState。
 * 只负责"写"这一半；"读（启动恢复）"由 FileSelectorProvider 构造时完成。
 *
 * @param {import("rxjs").Observable} changes$ 勾选集合变化的事件流
 * @returns {import("vscode").Disposable} 调用方在 dispose 时 .dispose()，或直接 push 进 context.subscriptions
 */
export function autoPersistCheckedUrisOnChange(changes$) {
    const subscription = changes$
        .pipe(debounceTime(500))
        .subscribe((checkedUris) => {
            workspaceStore.update("verba.lastCheckedUris", checkedUris);
        });

    return toVscodeDisposable(subscription);

    // ─────────────────────────────────────────
    // 下为原始代码
    // ─────────────────────────────────────────
    // // 在 subscription 外面封装 vscode 的 Disposable 是为了
    // // 能够在将其 push 进 context.subscriptions 进行优雅善后。
    // return new vscode.Disposable(() => {
    //     subscription.unsubscribe();
    // });
}
