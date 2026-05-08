import * as vscode from "vscode";

// 勾选快照功能
const MAX_SNAPSHOTS = 4;

function loadSnapshots(context) {
    return context.workspaceState.get("verba.snapshots") ?? [];
}

function saveSnapshots(context, snapshots) {
    context.workspaceState.update("verba.snapshots", snapshots);
}

function saveSnapshot(context, provider) {
    // 如果当下 treeview 中，没有文件被勾选，则直接 return
    if (provider.numberOfCurrentCheckedUris === 0) return;
    // 加载当前存档过的快照
    const snapshots = loadSnapshots(context) ?? [[], []];
    // 获取所有已置顶快照
    const pinned = snapshots[0];

    if (pinned.length >= MAX_SNAPSHOTS) {
        // 如果置顶数量超出用户设定的最大快照槽位数的话，直接返回。
        // 大于的话，之后会在 quick pick 面板给出提示。
        // 清理掉所有 unpinned 快照，只保留 pinned
        snapshots[1] = [];
        saveSnapshots(context, snapshots);
        return;
    }

    // 判断当前勾选的快照，是否与存档快照中的某一个相同
    const isDuplicate = snapshots
        .flat()
        .some(
            (s) =>
                s.checkedUris.length === provider.numberOfCurrentCheckedUris &&
                s.checkedUris.every((uri) => provider.hasUri(uri)),
        );
    // 如果存在相同快照，则直接返回
    if (isDuplicate) return;

    // 如果前面的关卡都通过的话，说明当前所选文件节点，是可以加入到 unpinned 数组的
    snapshots[1].unshift({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        pinned: false,
        checkedUris: provider.getCheckedUris(),
    });

    // 快照超出槽位的数量，取反值，这样就可以配合 splice 使用了。
    const negativeOverflow =
        MAX_SNAPSHOTS - snapshots[0].length - snapshots[1].length;

    if (negativeOverflow < 0) {
        // splice(负数) 从倒数第 N 位截断至末尾，精准淘汰最旧快照
        snapshots[1].splice(negativeOverflow);
    }

    saveSnapshots(context, snapshots);
}

function showSnapshotPicker(context, provider) {
    const snapshots = loadSnapshots(context) ?? [[], []];
    const pinned = snapshots[0];
    const unpinned = snapshots[1];

    const items = [];

    // if (pinned.length > MAX_SNAPSHOTS) {
    //     items.push({
    //         label: `⚠️ 置顶快照（${pinned.length}）超出槽位上限（${MAX_SNAPSHOTS}），新快照将不会被保存`,
    //         kind: vscode.QuickPickItemKind.Separator,
    //     });
    // }

    if (pinned.length > 0) {
        items.push({
            label: "📌 已置顶",
            kind: vscode.QuickPickItemKind.Separator,
        });
        pinned.forEach((s) =>
            items.push({ label: s.id, description: s.createdAt, snapshot: s }),
        );
    }

    if (unpinned.length > 0) {
        items.push({
            label: "最近快照",
            kind: vscode.QuickPickItemKind.Separator,
        });
        unpinned.forEach((s) =>
            items.push({ label: s.id, description: s.createdAt, snapshot: s }),
        );
    }

    vscode.window.showQuickPick(items).then((selected) => {
        if (!selected?.snapshot) return;
        provider.restoreCheckedUris(selected.snapshot.checkedUris);
    });
}
