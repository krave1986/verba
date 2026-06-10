import * as vscode from "vscode";
import { workspaceStore } from "../../utils/workspace.js";

// 勾选快照功能
const MAX_SNAPSHOTS = 4;

export function loadSnapshots() {
    return workspaceStore.get("verba.snapshots") ?? [[], []];
}

function saveSnapshots(snapshots) {
    workspaceStore.update("verba.snapshots", snapshots);
}

export async function saveSnapshot(context, provider) {
    // 如果当下 treeview 中，没有文件被勾选，则直接 return
    if (provider.numberOfCurrentCheckedUris === 0) return;
    // 加载当前存档过的快照
    const snapshots = loadSnapshots();
    // 获取所有已置顶快照
    const pinned = snapshots[0];

    if (pinned.length >= MAX_SNAPSHOTS) {
        // 如果置顶数量超出用户设定的最大快照槽位数的话，直接返回。
        // 大于的话，之后会在 quick pick 面板给出提示。
        // 清理掉所有 unpinned 快照，只保留 pinned
        snapshots[1] = [];
        saveSnapshots(snapshots);
        return;
    }

    // 判断当前勾选的快照，是否与存档快照中的某一个相同
    const matchingIndex = findMatchingSnapshotIndex(snapshots, provider);
    // 如果存在相同快照，则直接返回
    if (matchingIndex !== -1) {
        // 先定位快照的一二级索引
        const [snapshotLevel1Index, snapshotLevel2Index] =
            matchingIndex >= snapshots[0].length
                ? [1, matchingIndex - snapshots[0].length]
                : [0, matchingIndex];
        // 根据索引拿到一级快照组
        const subSnapshots = snapshots[snapshotLevel1Index];
        // 根据索引拿到快照本照
        const matchingSnapshot = subSnapshots[snapshotLevel2Index];
        vscode.window.showInformationMessage(
            `快照「${matchingSnapshot.name}」已存在。`,
        );
        matchingSnapshot.createdAt = new Date().toISOString();
        // 在一级快照内部，原地修改数组顺序
        subSnapshots.unshift(subSnapshots.splice(snapshotLevel2Index, 1)[0]);
        saveSnapshots(snapshots);
        return;
    }

    // 提示用户输入勾选快照名
    const name = await vscode.window.showInputBox({
        prompt: "给这个快照起个名字",
        placeHolder: "例如：登录模块相关文件",
    });
    if (name === undefined) return;
    // 如果前面的关卡都通过的话，说明当前所选文件节点，是可以加入到 unpinned 数组的
    snapshots[1].unshift({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        pinned: false,
        name,
        description: "",
        checkedUris: provider.getCheckedUris(),
    });

    // 快照超出槽位的数量，取反值，这样就可以配合 splice 使用了。
    const negativeOverflow =
        MAX_SNAPSHOTS - snapshots[0].length - snapshots[1].length;

    if (negativeOverflow < 0) {
        // splice(负数) 从倒数第 N 位截断至末尾，精准淘汰最旧快照
        snapshots[1].splice(negativeOverflow);
    }

    saveSnapshots(snapshots);
}

const buildQpItems = (snapshots) =>
    snapshots.flat().map((s, index) => ({
        label: s.name,
        description: s.description,
        detail: initDateTimeFormatter().format(new Date(s.createdAt)),
        iconPath: new vscode.ThemeIcon(s.pinned ? "pinned" : "dash"),
        indices: [
            s.pinned ? 0 : 1,
            s.pinned ? index : index - snapshots[0].length,
        ],
        buttons: [
            {
                iconPath: new vscode.ThemeIcon(s.pinned ? "pinned" : "pin"),
                tooltip: s.pinned ? "取消置顶" : "置顶",
            },
            { iconPath: new vscode.ThemeIcon("edit"), tooltip: "编辑" },
        ],
    }));

function findMatchingSnapshotIndex(snapshots, provider) {
    return snapshots
        .flat()
        .findIndex(
            (s) =>
                s.checkedUris.length === provider.numberOfCurrentCheckedUris &&
                s.checkedUris.every((uri) => provider.hasUri(uri)),
        );
}

export function showSnapshotPicker(context, provider) {
    const previousCheckedUris = provider.getCheckedUris();
    const snapshots = loadSnapshots();
    const [pinned] = snapshots;

    const qp = vscode.window.createQuickPick();
    qp.ignoreFocusOut = true;
    qp.keepScrollPosition = true;
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;

    if (pinned.length > MAX_SNAPSHOTS) {
        qp.prompt = `❌ 置顶快照（${pinned.length}）超出槽位上限（${MAX_SNAPSHOTS}），取消置顶多余快照将其删除。`;
    }

    qp.items = buildQpItems(snapshots);

    const matchingIndex = findMatchingSnapshotIndex(snapshots, provider);
    if (matchingIndex !== -1) {
        qp.activeItems = [qp.items[matchingIndex]];
    }

    qp.onDidChangeActive((activeItems) => {
        const active = activeItems[0];
        if (!active) return;
        const snapshot = snapshots[active.indices[0]][active.indices[1]];
        provider.restoreCheckedUris(snapshot.checkedUris);
    });

    let accepted = false;

    qp.onDidAccept(() => {
        accepted = true;
        qp.hide();
    });

    qp.onDidHide(() => {
        if (!accepted) {
            provider.restoreCheckedUris(previousCheckedUris);
        }
        qp.dispose();
    });

    qp.onDidTriggerItemButton(async ({ item, button }) => {
        // 置顶/取消置顶逻辑
        const [groupIndex, itemIndex] = item.indices;
        const snapshot = snapshots[groupIndex][itemIndex];

        switch (button.tooltip) {
            case "置顶":
            case "取消置顶": {
                const targetGroup = snapshot.pinned ? 1 : 0;
                snapshots[groupIndex].splice(itemIndex, 1);
                snapshot.pinned = !snapshot.pinned;
                snapshots[targetGroup].some(
                    (snapshotInTheGroup, index, snapshotTargetGroup) => {
                        if (
                            snapshot.createdAt >= snapshotInTheGroup.createdAt
                        ) {
                            snapshotTargetGroup.splice(index, 0, snapshot);
                            return true;
                        }
                    },
                ) || snapshots[targetGroup].push(snapshot);
                saveSnapshots(snapshots);
                qp.items = buildQpItems(snapshots);
                break;
            }
            case "编辑": {
                const name = await vscode.window.showInputBox({
                    prompt: "修改快照名称",
                    value: snapshot.name,
                });
                if (name === undefined) break;
                let description = await vscode.window.showInputBox({
                    prompt: "修改描述（可选，直接回车跳过）",
                    value: snapshot.description,
                });
                snapshot.name = name;
                snapshot.description = description ?? snapshot.description;
                saveSnapshots(snapshots);
                qp.items = buildQpItems(snapshots);
                break;
            }
        }
    });

    qp.show();
}

function initDateTimeFormatter() {
    const locale =
        vscode.workspace.getConfiguration("verba").get("locale") ||
        vscode.env.language;
    const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
        month: "long",
        day: "numeric",
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    return dateTimeFormatter;
}
