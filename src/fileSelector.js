import picomatch from "picomatch";
import * as vscode from "vscode";
import { EntryNode } from "./EntryNode.js";
import { getRootUri } from "./utils/workspace.js";
import { ObservableSet } from "./ObservableSet.js";
import { loadLastCheckedUris } from "./snapshots/checkboxSelection/implicit.js";
import { asyncScheduler, Observable, throttleTime } from "rxjs";
import { disposableRegistry } from "./utils/toVscodeDisposable.js";
import { isAbsolute } from "path";
import {
    clearWorkspaceFileTreeCache,
    readChildEntries,
} from "./workspaceFileTree/cache.js";

export class FileSelectorProvider {
    #context;
    onDidChangeTreeData;
    /**
     * 触发 treeView 刷新。经 100ms 节流，节流窗口内多次调用合并为一次。
     * @type {(options?: { node?: EntryNode, clearTree?: boolean }) => void}
     */
    refresh = () => {
        // 这个空函数是占位初始值，真正的实现在构造函数的 Observable 订阅回调里赋值
    };

    constructor(context) {
        this.#context = context;

        // 初始化时，先查一下上次关闭时的勾选状态，
        // 如果查到，则在初始化时，就直接装入 this.#checkedUris 中
        this.#checkedUris = new ObservableSet(loadLastCheckedUris());

        // 1. emitter 完美隐藏在局部变量中
        const emitter = new vscode.EventEmitter();
        // 逻辑：vscode 内部定义了这样一个类型的事件，类型为 onDidChangeTreeData ，
        // 下面的赋值操作，就是在告诉 vscode ：emitter 就是这个类型的事件，
        // 如果该事件被触发，vscode 知道该如何去内部处理这个类型的事件。
        this.onDidChangeTreeData = emitter.event;

        // 这个变量作为防抖标记，用来标记在 treeView 刷新前，是否需要清空文件树 Map，
        // 以防 getChildren 方法读到旧的文件树
        let shouldClearCacheBeforeRefresh = false;
        // 2. 创建 Observable 并直接订阅
        disposableRegistry.register(
            new Observable((subscriber) => {
                // 修复 this 丢失问题，安全地将 next 暴露给外部
                this.refresh = ({ node, clearTree = false } = {}) => {
                    shouldClearCacheBeforeRefresh ||= clearTree;
                    subscriber.next(node);
                };

                // 符合 RxJS 规范，返回一个空的 teardown 函数
                return () => {};
            })
                .pipe(
                    // 明确使用 asyncScheduler 代替 undefined
                    throttleTime(100, asyncScheduler, {
                        leading: false,
                        trailing: true,
                    }),
                )
                .subscribe({
                    // 我们需要做的，就是去根据一定的机制去触发这个事件。
                    next: (node) => {
                        // 如果节流过程中，哪怕出现一次是需要清空文件树的清空，
                        // 再释放时，就进行清空操作。
                        shouldClearCacheBeforeRefresh &&
                            clearWorkspaceFileTreeCache();
                        // 清空结束后，将指示器重置为 false
                        shouldClearCacheBeforeRefresh = false;
                        emitter.fire(node);
                    },
                }),
        );
    }
    // 获取针对 Verba 的用户设置
    // include: 作为首要白名单逻辑，先明确哪些文件需要展示
    // exclude: 作为次要黑名单逻辑，表示：需要在白名单的基础上，从白名单中排除哪些文件
    // collapse: 在确定最终需要包含哪些文件的基础上，再确定哪些目录是需要默认展开的
    #getConfig() {
        const config = vscode.workspace.getConfiguration("verba");
        const warnAndFilterAbsolutePaths = (patterns, settingName) => {
            const relativePathGlobPatterns = patterns.filter(
                (globPattern) => !isAbsolute(globPattern),
            );
            if (relativePathGlobPatterns.length !== patterns.length) {
                vscode.window.showWarningMessage(
                    `Verba: Absolute path detected in \`${settingName}\` — only workspace-relative glob patterns are supported (e.g. \`src/**\`). The affected rules have been ignored.`,
                );
            }
            return relativePathGlobPatterns;
        };

        // 给每条相对规则加上 **/ 前缀，使其匹配任意层级
        // 例：utils → **/utils（任意位置的 utils）
        //     src/utils → **/src/utils（任意位置下的 src/utils）
        const prefixWithGlobstar = (patterns) =>
            patterns.map((globPattern) => `**/${globPattern}`);

        return {
            included: prefixWithGlobstar(
                warnAndFilterAbsolutePaths(
                    config.get("include"),
                    "verba.include",
                ),
            ),
            excluded: prefixWithGlobstar(
                warnAndFilterAbsolutePaths(
                    config.get("exclude"),
                    "verba.exclude",
                ),
            ),
            expanded: prefixWithGlobstar(
                warnAndFilterAbsolutePaths(
                    config.get("expand"),
                    "verba.expand",
                ),
            ),
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

    /**
     * 对外暴露的流：持续推送当前被选中的 URI 数组快照
     */
    get uriSelection$() {
        return this.#checkedUris.changes$;
    }

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
        const { expanded } = this.#getConfig();
        const isExpanded = picomatch(expanded);
        // 默认全部折叠，expand 是例外清单
        return this.#buildTreeItem(
            entry,
            isExpanded(relativePath)
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed,
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
        const filtered = this.#filterEntries(entries, entry.uri);
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
        // ─────────────────────────────────────────
        // 下为原始代码
        // ─────────────────────────────────────────
        // const { entryNodes, uriStrings } = filtered.reduce(
        //     (acc, [name, type]) => {
        //         const entryUri = vscode.Uri.joinPath(entry.uri, name);
        //         const node = new EntryNode(entryUri, type);
        //         acc.entryNodes.push(node);
        //         acc.uriStrings.push(entryUri.toString());
        //         return acc;
        //     },
        //     { entryNodes: [], uriStrings: [] },
        // );
        // submitGetChildrenUris(uriStrings);
        // return entryNodes;
    }

    #filterEntries(entries, parentUri) {
        const { included, excluded } = this.#getConfig();
        const isIncluded = picomatch(included);
        const isExcluded = picomatch(excluded);
        const rootPath = getRootUri().path;
        // 先以 include 为门槛，确定哪些条目进入候选
        // 再以 exclude 为过滤，从候选中剔除不需要的
        // filtered 变量存放了过滤后，真正要在面板中展示的条目，包括目录和文件
        return entries.filter(([name, type]) => {
            // 拼出条目相对工作区根的完整路径，目录尾部加 "/"
            const entryRelativePath = vscode.Uri.joinPath(
                parentUri,
                name,
            ).path.slice(rootPath.length + 1);
            const testPath =
                type === vscode.FileType.Directory
                    ? entryRelativePath + "/"
                    : entryRelativePath;
            return isIncluded(testPath) && !isExcluded(testPath);
        });
    }

    async #readEntries(uri) {
        return (
            readChildEntries(uri.toString()) ??
            vscode.workspace.fs.readDirectory(uri)
        );
    }

    async #cascadeDownward(uri, checked) {
        const entries = this.#filterEntries(await this.#readEntries(uri), uri);
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
                parentUri,
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

    restoreCheckedUris(uris, { shouldRefresh = true } = {}) {
        this.#checkedUris.replaceAll(uris);
        if (shouldRefresh) {
            this.refresh({ clearTree: false });
        }
    }

    /**
     * 必须实现的方法：用于告诉 VSCode 当前节点的父节点是谁。
     * 这是 reveal 能够无缓存定位节点的核心！
     *
     *
     * @param {EntryNode} currentEntryNode
     * @returns {vscode.ProviderResult<EntryNode>}
     */
    getParent(currentEntryNode) {
        // 1. 先算出当前节点的上一级路径
        const parentUri = vscode.Uri.joinPath(currentEntryNode.uri, "..");

        // 2. 核心修正：如果它的上一级就是 rootUri，
        // 说明 currentEntryNode 本身就是 UI 树的最顶层节点（第一层）！
        // 在 UI 树中，顶层节点是没有父节点的，必须在这里提前返回 undefined。
        if (parentUri.toString() === getRootUri().toString()) {
            return undefined;
        }

        // 3. 否则，正常返回它的父节点
        return new EntryNode(parentUri, vscode.FileType.Directory);
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
