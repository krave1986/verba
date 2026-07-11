import { debounceTime } from "rxjs";
import { disposableRegistry } from "./toVscodeDisposable.js";
import { workspaceStore } from "./workspace.js";

export function loadLastExpandedDirectoryUris() {
    return workspaceStore.get("derba.lastExpandedDirectoryUris") ?? [];
}

export function autoPersistExpandedDirectoryUrisOnChange(changes$) {
    const subscription = changes$
        .pipe(debounceTime(200))
        .subscribe((expandedUris) => {
            workspaceStore.update(
                "derba.lastExpandedDirectoryUris",
                expandedUris,
            );
        });

    disposableRegistry.register(subscription);
}
