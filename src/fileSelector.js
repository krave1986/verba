import picomatch from "picomatch";
import * as vscode from "vscode";
import { EntryNode } from "./EntryNode.js";
import { getRootUri } from "./utils/workspace.js";
import { ObservableSet } from "./ObservableSet.js";

export class FileSelectorProvider {
    #context;

    constructor(context) {
        this.#context = context;

        // 初始化时，先查一下上次关闭时的勾选状态，
        // 如果查到，则在初始化时，就直接装入 this.#checkedUris 中
        this.#checkedUris = new ObservableSet(
            context.workspaceState.get("verba.lastCheckedUris") ?? [],
        );
    }
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
    // 可以把 treeItem 大概理解为：带UI状态的 EntryNode
    #buildTreeItem(entry, collapsibleState) {
        const entryLabel = entry.uri.path.split("/").at(-1);
        const item = new vscode.TreeItem(entryLabel, collapsibleState);
        // 给 item 设置 id ，以便 vscode 在管理节点的 展开\关闭 状态时，能够记住节点的对应状态
        item.id = entry.uri.toString();
        item.resourceUri = entry.uri;
        // 通过我们自己维护的集合 #checkedUris ，来找出当前条目是否被勾选
        item.checkboxState = this.#checkedUris.has(item.id)
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked;
        return item;
    }

    // 存放被用户勾选的文件 URIs
    #checkedUris;

    // 条目打勾
    check(uriString) {
        this.#checkedUris.add(uriString);
    }

    // 条目取消勾选
    uncheck(uriString) {
        this.#checkedUris.delete(uriString);
    }

    // 这里的 entry 参数全都是我们所定义的 EntryNode 实例
    // 通过 getTreeItem 函数，vscode 会得到 EntryNode 与 item 的一一对应的关系
    getTreeItem(entry) {
        // 如果是文件条目，则没有展开/折叠的概念，直接返回
        if (entry.type !== vscode.FileType.Directory) {
            return this.#buildTreeItem(
                entry,
                vscode.TreeItemCollapsibleState.None,
            );
        }
        // 如果是目录条目 ↓

        // 这里的 rootUri 必然存在，
        // 保证来自 getChildren() 的早返回：`if (!folder) return []`
        const rootUri = getRootUri();
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

    // 除项目根目录外，这里传入的 entry 参数也都是我们定义的 EntryNode 实例
    async getChildren(entry) {
        if (!entry) {
            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder) return [];
            // 根节点：把工作区根目录伪装成 EntryNode，让后续代码统一处理
            entry = { uri: folder.uri };
        }
        const entries = await this.#readEntries(entry.uri);
        // entries 是一个大数组，每个元素呢，又都是一个子数组。
        // 每个子数组代表一个条目，格式是 [name, type]。
        // name 是文件或目录的名称，只是名称，不含路径。
        // type 是 vscode.FileType 枚举的数值：
        //  1 → vscode.FileType.File，普通文件
        //  2 → vscode.FileType.Directory，目录
        const filtered = this.#filterEntries(entries);
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

    #filterEntries(entries) {
        const { included, excluded } = this.#getConfig();
        const isIncluded = picomatch(included);
        const isExcluded = picomatch(excluded);
        // 先以 include 为门槛，确定哪些条目进入候选
        // 再以 exclude 为过滤，从候选中剔除不需要的
        // filtered 变量存放了过滤后，真正要在面板中展示的条目，包括目录和文件
        return entries.filter(([name, type]) => {
            const testPath =
                type === vscode.FileType.Directory ? name + "/" : name;
            return isIncluded(testPath) && !isExcluded(testPath);
        });
    }

    async #readEntries(uri) {
        return vscode.workspace.fs.readDirectory(uri);
    }

    // 而我们需要做的，就是去根据一定的机制去触发这个事件。
    refresh(node = undefined) {
        this.#emitter.fire(node);
    }

    async #cascadeDownward(uri, checked) {
        const entries = this.#filterEntries(await this.#readEntries(uri));
        for (const [name, type] of entries) {
            const childUri = vscode.Uri.joinPath(uri, name);
            checked
                ? this.check(childUri.toString())
                : this.uncheck(childUri.toString());
            if (type === vscode.FileType.Directory) {
                // 必须 await，确保递归完全填满 #checkedUris 后，外层才继续执行 refresh()
                await this.#cascadeDownward(childUri, checked);
            }
        }
    }

    async #cascadeUpward(uri, rootUri, propagateUncheckedUpward) {
        const parentUri = vscode.Uri.joinPath(uri, "..");
        if (parentUri.path === rootUri.path) return;
        if (propagateUncheckedUpward) {
            this.uncheck(parentUri.toString());
        } else {
            const entries = this.#filterEntries(
                await this.#readEntries(parentUri),
            );
            const allChecked = entries.every(([name]) =>
                this.#checkedUris.has(
                    vscode.Uri.joinPath(parentUri, name).toString(),
                ),
            );
            allChecked
                ? this.check(parentUri.toString())
                : this.#assertParentUnchecked(parentUri.toString());
            // 如果上述断言报错，而逻辑没问题，则替换成下面这行代码 ↓
            // : this.uncheck(parentUri.toString());
            propagateUncheckedUpward = !allChecked;
        }
        await this.#cascadeUpward(parentUri, rootUri, propagateUncheckedUpward);
    }

    async cascade(uri, entryType, checked) {
        checked ? this.check(uri.toString()) : this.uncheck(uri.toString());
        const rootUri = getRootUri();
        await Promise.all([
            // 向下级联
            entryType === vscode.FileType.Directory
                ? this.#cascadeDownward(uri, checked)
                : Promise.resolve(),
            // 向上级联
            this.#cascadeUpward(uri, rootUri, !checked),
        ]);
    }

    getCheckedUris() {
        return [...this.#checkedUris];
    }

    hasUri(uriString) {
        return this.#checkedUris.has(uriString);
    }

    // 注意，这里是 getter
    get numberOfCurrentCheckedUris() {
        return this.#checkedUris.size;
    }

    /** @type {ReturnType<typeof setTimeout> | null} */
    #refreshTimer = null;

    scheduleRefresh() {
        if (this.#refreshTimer) return;
        this.#refreshTimer = setTimeout(() => {
            this.#refreshTimer = null;
            this.refresh();
        }, 300);
    }

    restoreCheckedUris(uris) {
        this.#checkedUris.replaceAll(uris);
        this.refresh();
    }

    // 这是一个仅在开发期生效的检查。
    //
    // 背景：在 #cascadeUpward 里，当用户勾选了某个子节点、向上冒泡到父目录时，
    // 如果父目录的子节点并没有全部勾选，那么父目录本身就应该是未勾选状态。
    // 经过分析，正常情况下走到这里时，父目录必然已经是未勾选的，
    // 所以这里其实不需要再做任何事（原本的 this.uncheck(parentUri.toString()) 是多余的）。
    //
    // 但这个"必然"是基于当前级联逻辑推导出来的。万一哪天逻辑改了、
    // 或者出现了没预料到的调用路径，导致父目录这时候竟然是勾选状态，
    // 那就说明上面的分析不再成立。为了不让这种错误被悄悄掩盖，
    // 这里在开发期主动检查：一旦发现父目录处于勾选状态，立即抛出异常，
    // 让程序停在这一行，方便用断点查看当时的调用栈和状态。
    //
    // 仅在开发期（Development）启用，生产环境不会触发，不影响已发布的插件。
    #assertParentUnchecked(parentUriString) {
        if (
            this.#context.extensionMode === vscode.ExtensionMode.Development &&
            this.#checkedUris.has(parentUriString)
        ) {
            throw new Error(
                `父目录本应是未勾选状态，但实际发现它已被勾选: ${parentUriString}`,
            );
        }
    }
}
