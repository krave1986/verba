import * as vscode from "vscode";

async function buildTree(uri, signal) {
    // 1. 优雅地检查是否已取消（替代 if(signal.aborted) throw...）
    signal.throwIfAborted();

    // 2. 发起底层 IPC 请求（注意：这一步发出去后，底层 IO 无法被 signal 撤回）
    const entries = await vscode.workspace.fs.readDirectory(uri);

    const keptEntries = entries.filter(([name]) => !isExcluded(name));

    // 3. 并发递归
    const children = await Promise.all(
        keptEntries.map(async ([name, type]) => {
            // 每次进入子节点前再次检查
            signal.throwIfAborted();

            const childUri = vscode.Uri.joinPath(uri, name);
            if (type === vscode.FileType.Directory) {
                const childChildren = await buildTree(childUri, signal);
                return { uri: childUri, type, children: childChildren };
            }
            return { uri: childUri, type };
        }),
    );

    return children;
}

// ================= 外部调用 =================

async function startBuilding() {
    // 场景：我们希望建树过程【要么】被 RxJS switchMap 废弃，【要么】最长不能超过 5 秒。
    const switchMapController = new AbortController();
    const timeoutSignal = AbortSignal.timeout(5000);

    // 使用 any 组合两个取消条件
    const finalSignal = AbortSignal.any([
        switchMapController.signal,
        timeoutSignal,
    ]);

    try {
        const tree = await buildTree(workspaceRootUri, finalSignal);
        provider.applyTree(tree);
    } catch (err) {
        if (finalSignal.aborted) {
            // 通过 reason 判断到底是怎么死的
            if (err.name === "TimeoutError") {
                console.warn("建树超时（5秒限制），已放弃本次中间态结果。");
            } else {
                console.log("建树被 switchMap 废弃，准备迎接下一次重建。");
            }
        } else {
            console.error("建树过程中发生了真实的文件系统错误:", err);
        }
    }
}

// 当 RxJS switchMap 决定废弃当前任务时：
// switchMapController.abort(new Error("SwitchMap cancelled"));
