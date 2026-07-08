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
import { disposableRegistry } from "./utils/toVscodeDisposable.js";
import {
    asynchronouslyBuildWorkspaceFileTree,
    synchronouslyBuildWorkspaceFileTree,
} from "./workspaceFileTree/traverser.js";
import { bindFileSelectorProviderToReconciler } from "./utils/reconcileWithFileSystem.js";
import { clearWorkspaceFileTreeCache } from "./workspaceFileTree/cache.js";
import { EntryNode } from "./EntryNode.js";
import { autoPersistExpandedDirectoryUrisOnChange } from "./utils/expandedDirectoryUris.js";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
export function activate(context) {
    // 必须最先调用：注入 workspaceState，后续所有 workspaceStore.* 才可用
    initWorkspaceStore(context);

    // 构建内存中的文件树，并且在构建完毕后，需要将内存文件树与持久化了的 uri 们进行比对
    synchronouslyBuildWorkspaceFileTree(true);
    const provider = new FileSelectorProvider(context);
    bindFileSelectorProviderToReconciler(provider);
    const treeView = vscode.window.createTreeView("verba.fileSelector", {
        treeDataProvider: provider,
        manageCheckboxStateManually: true,
    });
    treeView.onDidExpandElement((expandEvent) => {
        provider.recordExpandedDirectory(expandEvent.element.uri.toString());
    });
    treeView.onDidCollapseElement((collapseEvent) => {
        provider.recordCollapsedDirectory(collapseEvent.element.uri.toString());
    });
    registerTreeViewEvents(treeView, provider);
    registerFileWatcher(provider, context);
    autoPersistCheckedUrisOnChange(provider.uriSelection$);
    autoPersistExpandedDirectoryUrisOnChange(
        provider.expandedDirectoryUriSelection$,
    );
    // 把 treeView 加入 context 订阅，以便在插件停用时，
    // 由 vscode 自动清理，以免造成内存溢出。
    context.subscriptions.push(
        treeView,
        ...disposableRegistry.getAll(),
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
                clearWorkspaceFileTreeCache();
                void synchronouslyBuildWorkspaceFileTree(true);
                provider.refresh({ clearTree: false });
            }
            if (configChangeEvent.affectsConfiguration("verba.expand")) {
                provider.refresh({ clearTree: false });
            }
        }),
    );
    // 以下为调试时才注入的代码
    if (context.extensionMode === vscode.ExtensionMode.Development) {
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "verba.temporaryDebug",
                async () => {
                    const testUri = vscode.Uri.parse(
                        "file:///d%3A/vscode-extensions/test-projects/parent_one/branch_one/branch.js",
                    );
                    const testNode = new EntryNode(
                        testUri,
                        vscode.FileType.File,
                    );
                    await treeView.reveal(testNode, {
                        expand: true,
                        select: true,
                        focus: true,
                    });
                    console.log("debug结束！");
                },
            ),
        );
    }
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
        watcher.onDidCreate(() => {
            provider.refresh({ clearTree: true });
            asynchronouslyBuildWorkspaceFileTree();
        });
        watcher.onDidDelete(() => {
            provider.refresh({ clearTree: true });
            asynchronouslyBuildWorkspaceFileTree(true);
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
        provider.refresh({ clearTree: false });
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
