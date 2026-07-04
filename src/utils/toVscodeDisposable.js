import * as vscode from "vscode";

const toVscodeDisposable = (target) =>
    new vscode.Disposable(() => {
        (target.unsubscribe?.() || target.unsubscribe) ??
            (target.dispose?.() || target.dispose) ??
            target();
    });

const registeredDisposables = [];

export const disposableRegistry = {
    register(target) {
        registeredDisposables.push(toVscodeDisposable(target));
    },
    getAll() {
        return registeredDisposables;
    },
};
