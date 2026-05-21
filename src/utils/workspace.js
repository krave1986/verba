import * as vscode from "vscode";

export function getRootUri() {
    return vscode.workspace.workspaceFolders?.[0].uri ?? "";
}

export function getRelativePath(uri) {
    return uri.path.slice(getRootUri().path.length + 1);
}
