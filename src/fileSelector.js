import picomatch from "picomatch";
import * as vscode from "vscode";

class EntryNode {
    constructor(uri, type) {
        this.uri = uri;
        this.type = type;
        this.checked = false;
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

    // 用于构造属性结构中的每一个具体节点
    #buildTreeItem(entry, collapsibleState) {
        const label = entry.uri.path.split("/").at(-1);
        const item = new vscode.TreeItem(label, collapsibleState);
        item.resourceUri = entry.uri;
        item.checkboxState = entry.checked
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked;
        return item;
    }

    getTreeItem(entry) {
        // 如果是文件条目，则没有展开/折叠的概念，直接返回
        if (entry.type !== vscode.FileType.Directory) {
            return this.#buildTreeItem(
                entry,
                vscode.TreeItemCollapsibleState.None,
            );
        }
        // 如果是目录条目 ↓
        // @ts-ignore — workspaceFolders 在此处必然存在
        // 保证来自 getChildren() 的早返回：`if (!folder) return []`
        const rootUri = vscode.workspace.workspaceFolders[0].uri;
        // 计算相对于工作区根目录的路径，末尾加 "/" 以匹配目录模式（如 src/time/）
        const relativePath =
            // 这里调用的是字符串的 slice(start) 方法，
            // start 表示返回的子字符串的第一个字符，在原字符串中的索引位置。
            // 由于索引是从0开始的，uri长度正好到工作区根目录后面的斜杠，
            // 再 +1 的话，就正好从各子目录的相对路径的第一个字符开始了。
            // 于是，整个 relativePath 就是从相对路径的第1个字符开始，
            // 一直到结束，最后再跟上一个斜杠。完美。
            entry.uri.path.slice(rootUri.path.length + 1) + "/";
        const { collapsed } = this.#getConfig();
        const isCollapsed = picomatch(collapsed);
        // 默认全部展开，collapsed 是例外清单
        return this.#buildTreeItem(
            entry,
            isCollapsed(relativePath)
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.Expanded,
        );
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
        filtered.sort(([nameA, typeA], [nameB, typeB]) => {
            if (typeA !== typeB) {
                return typeA === vscode.FileType.Directory ? -1 : 1;
            }
            return nameA.localeCompare(nameB);
        });
        return filtered.map(
            ([name, type]) =>
                new EntryNode(vscode.Uri.joinPath(entry.uri, name), type),
        );
    }

    #emitter = new vscode.EventEmitter();
    // 逻辑：vscode 内部定义了这样一个类型的事件，类型为 onDidChangeTreeData ，
    // 下面的赋值操作，就是在告诉 vscode ：this.#emitter 就是这个类型的事件，
    // 如果该事件被触发，vscode 知道该如何去内部处理这个类型的事件。
    onDidChangeTreeData = this.#emitter.event;

    // 而我们需要做的，就是去根据一定的机制去触发这个事件。
    refresh(node = undefined) {
        this.#emitter.fire(node);
    }
}
