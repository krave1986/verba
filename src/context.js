import * as vscode from "vscode";
import { getRelativePath, getRootUri } from "./utils/workspace.js";

export async function extractContext(provider) {
    const checkedUriStrings = provider.getCheckedUris();
    const realUris = [];

    for (const uriString of checkedUriStrings) {
        const uri = vscode.Uri.parse(uriString);
        const entryStat = await vscode.workspace.fs.stat(uri);
        if (entryStat.type === vscode.FileType.File) realUris.push(uri);
    }

    const contextDelimiters = {
        scope: "## Relevant Workspace Files to this message\n\n",
        fence: "```",
    };

    // 获取相对工作区的相对路径
    // entry.uri.path.slice(rootUri.path.length + 1)
    const rootUri = getRootUri();

    let fileListString = realUris.reduce((finalListString, uri) => {
        const relativePath = getRelativePath(uri);
        finalListString += relativePath + "\n";
        return finalListString;
    }, contextDelimiters.scope);

    for (const uri of realUris) {
        const doc = await vscode.workspace.openTextDocument(uri);
        fileListString += `\n${contextDelimiters.fence}${getRelativePath(uri)}\n${doc.getText()}\n${contextDelimiters.fence}\n`;
    }

    await vscode.env.clipboard.writeText(fileListString);
}
