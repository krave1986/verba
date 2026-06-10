import { Observable, debounceTime } from "rxjs";
import { reconcileAllCheckedUrisWithFileSystem } from "./reconcileWithFileSystem.js";

let collectedValidUris = new Set();
let isCollectingValidUris = false;
let fileSelectorProvider = null;

export function bindFileSelectorProviderToReconciler(provider) {
    fileSelectorProvider = provider;
}

export function activateUriCollection() {
    collectedValidUris = new Set();
    isCollectingValidUris = true;
}

export const submitGetChildrenUris = (() => {
    let getChildrenUriStreamSubscriber;

    new Observable((subscriber) => {
        getChildrenUriStreamSubscriber = subscriber;
        // 返回空函数作为 teardown，表示没有自定义清理逻辑。
        // RxJS 框架自身的脱钩行为（标记 subscription 关闭、切断 observer 链接）
        // 由框架内部自动处理，无需在此手动实现。
        return () => {};
    })
        .pipe(debounceTime(100))
        .subscribe({
            next: () => {
                isCollectingValidUris = false;
                reconcileAllCheckedUrisWithFileSystem(
                    collectedValidUris,
                    fileSelectorProvider,
                );
            },
        });

    return (uriStrings) => {
        if (isCollectingValidUris) {
            for (const uri of uriStrings) collectedValidUris.add(uri);
            getChildrenUriStreamSubscriber.next();
        }
    };
})();
