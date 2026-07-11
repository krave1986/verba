import { workspaceStore } from "../../utils/workspace.js";
import { debounceTime } from "rxjs";
import { disposableRegistry } from "../../utils/toVscodeDisposable.js";

export function loadLastCheckedUris() {
    return workspaceStore.get("derba.lastCheckedUris") ?? [];
}

/**
 * 隐式快照：订阅勾选集合的变化，防抖后自动写入 workspaceState。
 * 只负责"写"这一半；"读（启动恢复）"由 FileSelectorProvider 构造时完成。
 *
 * @param {import("rxjs").Observable} changes$ 勾选集合变化的事件流
 */
export function autoPersistCheckedUrisOnChange(changes$) {
    const subscription = changes$
        .pipe(debounceTime(200))
        .subscribe((checkedUris) => {
            workspaceStore.update("derba.lastCheckedUris", checkedUris);
        });

    disposableRegistry.register(subscription);
}
