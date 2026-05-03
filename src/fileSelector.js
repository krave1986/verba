import picomatch from "picomatch";
import * as vscode from "vscode";

class EntryNode {
    constructor(uri, type) {
        this.uri = uri;
        this.type = type;
    }
}

export class FileSelectorProvider {
    // 获取针对 Verba 的用户设置
    // include: 作为首要白名单逻辑，先明确哪些文件需要展示
    // exclude: 作为次要黑名单逻辑，表示：需要在白名单的基础上，从白名单中排除哪些文件
    // collapse: 在确定最终需要包含哪些文件的基础上，再确定哪些目录是需要默认展开的
    #getConfig() {
        const config = vscode.workspace.getConfiguration("verba");
        return {
            included: config.get("include"),
            excluded: config.get("exclude"),
            collapsed: config.get("collapse"),
        };
    }

    getTreeItem(entry) {
        const label = entry.uri.path.split("/").at(-1);
        const collapsibleState =
            entry.type === vscode.FileType.Directory
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
        return new vscode.TreeItem(label, collapsibleState);
    }

    async getChildren(entry) {
        if (!entry) {
            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder) return [];
            // 根节点：把工作区根目录伪装成 EntryNode，让后续代码统一处理
            entry = { uri: folder.uri };
        }
        const entries = await vscode.workspace.fs.readDirectory(entry.uri);
        // entries 是一个大数组，每个元素呢，又都是一个子数组。
        // 每个子数组代表一个条目，格式是 [name, type]。
        // name 是文件或目录的名称，只是名称，不含路径。
        // type 是 vscode.FileType 枚举的数值：
        //  1 → vscode.FileType.File，普通文件
        //  2 → vscode.FileType.Directory，目录
        const { included, excluded } = this.#getConfig();
        const isIncluded = picomatch(included);
        const isExcluded = picomatch(excluded);
        // 先以 include 为门槛，确定哪些条目进入候选
        // 再以 exclude 为过滤，从候选中剔除不需要的
        // filtered 变量存放了过滤后，真正要在面板中展示的条目，包括目录和文件
        const filtered = entries.filter(([name, type]) => {
            const testPath =
                type === vscode.FileType.Directory ? name + "/" : name;
            return isIncluded(testPath) && !isExcluded(testPath);
        });
        return filtered.map(
            ([name, type]) =>
                new EntryNode(vscode.Uri.joinPath(entry.uri, name), type),
        );
    }
}
