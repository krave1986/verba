// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { FileSelectorProvider } from "./fileSelector.js";
import {
    saveSnapshot,
    showSnapshotPicker,
} from "./snapshots/checkboxSelection/explicit.js";
import { extractContext } from "./context.js";
import { initWorkspaceStore } from "./utils/workspace.js";
import { autoPersistCheckedUrisOnChange } from "./snapshots/checkboxSelection/implicit.js";
import {
    activateUriCollection,
    bindFileSelectorProviderToReconciler,
} from "./utils/getChildrenDrivenUriReconciler.js";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
export function activate(context) {
    // 必须最先调用：注入 workspaceState，后续所有 workspaceStore.* 才可用
    initWorkspaceStore(context);

    const provider = new FileSelectorProvider(context);
    bindFileSelectorProviderToReconciler(provider);
    activateUriCollection();
    const treeView = vscode.window.createTreeView("verba.fileSelector", {
        treeDataProvider: provider,
        manageCheckboxStateManually: true,
    });
    registerTreeViewEvents(treeView, provider);
    registerFileWatcher(provider, context);
    // 把 treeView 加入 context 订阅，以便在插件停用时，
    // 由 vscode 自动清理，以免造成内存溢出。
    context.subscriptions.push(
        treeView,
        autoPersistCheckedUrisOnChange(provider.uriSelection$),
        provider.treeRefreshSubscription,
        vscode.commands.registerCommand("verba.saveSnapshot", () =>
            saveSnapshot(context, provider),
        ),
        vscode.commands.registerCommand("verba.showSnapshotPicker", () =>
            showSnapshotPicker(context, provider),
        ),
        vscode.commands.registerCommand("verba.extractContext", () => {
            extractContext(provider);
        }),
        vscode.workspace.onDidChangeConfiguration((configChangeEvent) => {
            if (
                configChangeEvent.affectsConfiguration("verba.include") ||
                configChangeEvent.affectsConfiguration("verba.exclude")
            ) {
                activateUriCollection();
                provider.refresh();
            }
        }),
    );
}

function registerFileWatcher(provider, context) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, "**/*"),
            false, // ignoreCreateEvents
            true, // ignoreChangeEvents
            false,
        );
        watcher.onDidCreate(() => provider.refresh());
        watcher.onDidDelete(() => {
            activateUriCollection();
            provider.refresh();
        });
        context.subscriptions.push(watcher);
    }
}

function registerTreeViewEvents(treeView, provider) {
    treeView.onDidChangeCheckboxState(async (checkboxStateChangeEvent) => {
        for (const [entryNode, checkState] of checkboxStateChangeEvent.items) {
            const checked = checkState === vscode.TreeItemCheckboxState.Checked;
            await provider.cascade(entryNode.uri, entryNode.type, checked);
        }
        provider.refresh();
    });
    treeView.onDidChangeSelection((selectionChangeEvent) => {
        const entry = selectionChangeEvent.selection[0];
        if (!entry || entry.type !== vscode.FileType.File) return;
        vscode.window.showTextDocument(entry.uri, {
            preview: false,
            preserveFocus: false,
        });
    });
}

// This method is called when your extension is deactivated
export function deactivate() {}
