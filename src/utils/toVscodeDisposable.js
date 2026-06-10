import * as vscode from "vscode";

export const toVscodeDisposable = (target) =>
    new vscode.Disposable(() => {
        (target.unsubscribe?.() || target.unsubscribe) ??
            (target.dispose?.() || target.dispose) ??
            target();
    });
