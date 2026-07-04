import { loadSnapshots } from "../snapshots/checkboxSelection/explicit.js";
import { workspaceStore } from "./workspace.js";

let fileSelectorProvider = null;

export function bindFileSelectorProviderToReconciler(provider) {
    fileSelectorProvider = provider;
}

export function reconcileAllCheckedUrisWithFileSystem(collectedValidUris) {
    // ── 快照：原地修改每个快照的 checkedUris ──
    const snapshots = loadSnapshots();

    let snapshotsChanged = false;
    snapshots.flat().forEach((snapshot) => {
        const filtered = snapshot.checkedUris.filter((uri) =>
            collectedValidUris.has(uri),
        );
        if (filtered.length !== snapshot.checkedUris.length) {
            snapshot.checkedUris = filtered;
            snapshotsChanged = true;
        }
    });
    if (snapshotsChanged) {
        workspaceStore.update("verba.snapshots", snapshots);
    }

    // ── provider：过滤当前内存中的勾选集合 ──
    const currentCheckedUris = fileSelectorProvider.getCheckedUris();
    const filteredUris = currentCheckedUris.filter((uri) =>
        collectedValidUris.has(uri),
    );
    if (filteredUris.length !== currentCheckedUris.length) {
        fileSelectorProvider.restoreCheckedUris(filteredUris, {
            shouldRefresh: false,
        });
    }
}
