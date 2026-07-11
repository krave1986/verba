import * as vscode from "vscode";
import picomatch from "picomatch";
import { Observable, Subject, asyncScheduler, debounceTime, throttleTime } from "rxjs";
import { isAbsolute } from "path";
//#region src/EntryNode.js
var EntryNode = class {
	/** @type {vscode.Uri} */
	uri;
	/** @type {vscode.FileType} */
	type;
	constructor(uri, type) {
		this.uri = uri;
		this.type = type;
	}
};
//#endregion
//#region src/utils/workspace.js
function getRootUri() {
	return vscode.workspace.workspaceFolders?.[0].uri ?? "";
}
function getRelativePath(uri) {
	return uri.path.slice(getRootUri().path.length + 1);
}
/** @type {import("vscode").Memento} */
let workspaceState;
/**
* 在 activate 中调用一次，注入当前扩展的 workspaceState。
* ⚠️ 必须在使用 workspaceStore 的任何方法之前调用。
* @param {import("vscode").ExtensionContext} context
*/
function initWorkspaceStore(context) {
	workspaceState = context.workspaceState;
}
const workspaceStore = {
	/**
	* 取值。沿用 Memento.get。
	* 传了 defaultValue 时，key 不存在则返回它（Memento 原生支持的重载）。
	* @template T
	* @param {string} key
	* @param {T} [defaultValue]
	* @returns {T | undefined}
	*/
	get: (key, defaultValue) => workspaceState.get(key, defaultValue),
	/**
	* 存值。沿用 Memento.update。
	* ⚠️ 异步：返回 Promise。写完不立即读可不 await；写完要马上读到则必须 await。
	* @param {string} key
	* @param {unknown} value
	* @returns {Thenable<void>}
	*/
	update: (key, value) => workspaceState.update(key, value),
	/**
	* 删除一个 key。
	* ⚠️ Memento 没有原生 delete 方法 —— 删除的约定是写入 undefined。
	* 此方法封装该约定，返回 Promise（同 update，异步落盘）。
	* @param {string} key
	* @returns {Thenable<void>}
	*/
	delete: (key) => workspaceState.update(key, void 0),
	/**
	* 列出当前存储的所有 key。沿用 Memento.keys。
	* @returns {readonly string[]}
	*/
	keys: () => workspaceState.keys()
};
//#endregion
//#region src/ObservableSet.js
var ObservableSet = class extends Set {
	#subject = new Subject();
	constructor(iterable) {
		super();
		if (iterable) for (const item of iterable) super.add(item);
	}
	get changes$() {
		return this.#subject.asObservable();
	}
	add(value) {
		if (this.has(value)) return this;
		super.add(value);
		this.#subject.next([...this]);
		return this;
	}
	delete(value) {
		const result = super.delete(value);
		if (result) this.#subject.next([...this]);
		return result;
	}
	clear() {
		if (this.size === 0) return;
		super.clear();
		this.#subject.next([...this]);
	}
	replaceAll(iterable) {
		super.clear();
		for (const item of iterable) super.add(item);
		this.#subject.next([...this]);
	}
};
//#endregion
//#region src/utils/toVscodeDisposable.js
const toVscodeDisposable = (target) => new vscode.Disposable(() => {
	(target.unsubscribe?.() || target.unsubscribe) ?? (target.dispose?.() || target.dispose) ?? target();
});
const registeredDisposables = [];
const disposableRegistry = {
	register(target) {
		registeredDisposables.push(toVscodeDisposable(target));
	},
	getAll() {
		return registeredDisposables;
	}
};
//#endregion
//#region src/snapshots/checkboxSelection/implicit.js
function loadLastCheckedUris() {
	return workspaceStore.get("derba.lastCheckedUris") ?? [];
}
/**
* 隐式快照：订阅勾选集合的变化，防抖后自动写入 workspaceState。
* 只负责"写"这一半；"读（启动恢复）"由 FileSelectorProvider 构造时完成。
*
* @param {import("rxjs").Observable} changes$ 勾选集合变化的事件流
*/
function autoPersistCheckedUrisOnChange(changes$) {
	const subscription = changes$.pipe(debounceTime(200)).subscribe((checkedUris) => {
		workspaceStore.update("derba.lastCheckedUris", checkedUris);
	});
	disposableRegistry.register(subscription);
}
//#endregion
//#region src/workspaceFileTree/cache.js
/** @type {Map<string, [string, number][]>} */
const parentUriToChildEntriesMap = /* @__PURE__ */ new Map();
/**
* 读取某个目录的子条目缓存。
* 返回 undefined 表示缓存未命中（该目录尚未被扫描）。
* @param {string} parentUriString
* @returns {[string, number][] | undefined}
*/
function readChildEntries(parentUriString) {
	return parentUriToChildEntriesMap.get(parentUriString);
}
/**
* 将某个目录的子条目写入缓存。
* 只在键和值都完整准备好后调用。
* @param {string} parentUriString
* @param {[string, number][]} entries
*/
function cacheChildEntries(parentUriString, entries) {
	parentUriToChildEntriesMap.set(parentUriString, entries);
}
/**
* 清空整个工作区文件树缓存。
* 在需要重建缓存时调用（如 include/exclude 配置变更、工作区变更）。
*/
function clearWorkspaceFileTreeCache() {
	parentUriToChildEntriesMap.clear();
}
function convertCacheMapToUriSet(rootUriString) {
	const uriSet = new Set(parentUriToChildEntriesMap.entries().flatMap(function* ([parentEntryUriString, subEntryUris]) {
		yield parentEntryUriString;
		const parentEntryUri = vscode.Uri.parse(parentEntryUriString);
		yield* subEntryUris.values().map(([entryName, _entryType]) => {
			return vscode.Uri.joinPath(parentEntryUri, entryName).toString();
		});
	}));
	uriSet.delete(rootUriString);
	return uriSet;
}
//#endregion
//#region src/utils/expandedDirectoryUris.js
function loadLastExpandedDirectoryUris() {
	return workspaceStore.get("derba.lastExpandedDirectoryUris") ?? [];
}
function autoPersistExpandedDirectoryUrisOnChange(changes$) {
	const subscription = changes$.pipe(debounceTime(200)).subscribe((expandedUris) => {
		workspaceStore.update("derba.lastExpandedDirectoryUris", expandedUris);
	});
	disposableRegistry.register(subscription);
}
//#endregion
//#region src/fileSelector.js
var FileSelectorProvider = class {
	#context;
	onDidChangeTreeData;
	/**
	* 触发 treeView 刷新。经 100ms 节流，节流窗口内多次调用合并为一次。
	* @type {(options?: { node?: EntryNode, clearTree?: boolean }) => void}
	*/
	refresh = () => {};
	constructor(context) {
		this.#context = context;
		this.#checkedUris = new ObservableSet(loadLastCheckedUris());
		this.#currentlyExpandedDirectoryUris = new ObservableSet(loadLastExpandedDirectoryUris());
		const emitter = new vscode.EventEmitter();
		this.onDidChangeTreeData = emitter.event;
		let shouldClearCacheBeforeRefresh = false;
		disposableRegistry.register(new Observable((subscriber) => {
			this.refresh = ({ node, clearTree = false } = {}) => {
				shouldClearCacheBeforeRefresh ||= clearTree;
				subscriber.next(node);
			};
			return () => {};
		}).pipe(throttleTime(100, asyncScheduler, {
			leading: false,
			trailing: true
		})).subscribe({ next: (node) => {
			shouldClearCacheBeforeRefresh && clearWorkspaceFileTreeCache();
			shouldClearCacheBeforeRefresh = false;
			emitter.fire(node);
		} }));
	}
	#getConfig() {
		const config = vscode.workspace.getConfiguration("derba");
		const warnAndFilterAbsolutePaths = (patterns, settingName) => {
			const relativePathGlobPatterns = patterns.filter((globPattern) => !isAbsolute(globPattern));
			if (relativePathGlobPatterns.length !== patterns.length) vscode.window.showWarningMessage(`Derba: Absolute path detected in \`${settingName}\` — only workspace-relative glob patterns are supported (e.g. \`src/**\`). The affected rules have been ignored.`);
			return relativePathGlobPatterns;
		};
		const prefixWithGlobstar = (patterns) => patterns.map((globPattern) => `**/${globPattern}`);
		return {
			included: prefixWithGlobstar(warnAndFilterAbsolutePaths(config.get("include"), "derba.include")),
			excluded: prefixWithGlobstar(warnAndFilterAbsolutePaths(config.get("exclude"), "derba.exclude"))
		};
	}
	#buildTreeItem(entry, collapsibleState) {
		const entryLabel = entry.uri.path.split("/").at(-1);
		const item = new vscode.TreeItem(entryLabel, collapsibleState);
		item.id = entry.uri.toString();
		item.resourceUri = entry.uri;
		item.checkboxState = this.#checkedUris.has(item.id) ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
		return item;
	}
	#checkedUris;
	#currentlyExpandedDirectoryUris;
	/**
	* 对外暴露的流：持续推送当前被选中的 URI 数组快照
	*/
	get uriSelection$() {
		return this.#checkedUris.changes$;
	}
	check(uriString) {
		this.#checkedUris.add(uriString);
	}
	uncheck(uriString) {
		this.#checkedUris.delete(uriString);
	}
	/**
	* 对外暴露的流：持续推送当前展开目录的 URI 数组快照
	*/
	get expandedDirectoryUriSelection$() {
		return this.#currentlyExpandedDirectoryUris.changes$;
	}
	recordExpandedDirectory(uriString) {
		this.#currentlyExpandedDirectoryUris.add(uriString);
	}
	recordCollapsedDirectory(uriString) {
		this.#currentlyExpandedDirectoryUris.delete(uriString);
	}
	getTreeItem(entry) {
		if (entry.type !== vscode.FileType.Directory) return this.#buildTreeItem(entry, vscode.TreeItemCollapsibleState.None);
		return this.#buildTreeItem(entry, this.#currentlyExpandedDirectoryUris.has(entry.uri.toString()) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
	}
	async getChildren(entry) {
		if (!entry) {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) return [];
			entry = { uri: folder.uri };
		}
		const entries = await this.#readEntries(entry.uri);
		const filtered = this.#filterEntries(entries, entry.uri);
		filtered.sort(([nameA, typeA], [nameB, typeB]) => {
			if (typeA !== typeB) return typeA === vscode.FileType.Directory ? -1 : 1;
			return nameA.localeCompare(nameB);
		});
		return filtered.map(([name, type]) => new EntryNode(vscode.Uri.joinPath(entry.uri, name), type));
	}
	#filterEntries(entries, parentUri) {
		const { included, excluded } = this.#getConfig();
		const isIncluded = picomatch(included);
		const isExcluded = picomatch(excluded);
		const rootPath = getRootUri().path;
		return entries.filter(([name, type]) => {
			const entryRelativePath = vscode.Uri.joinPath(parentUri, name).path.slice(rootPath.length + 1);
			const testPath = type === vscode.FileType.Directory ? entryRelativePath + "/" : entryRelativePath;
			return isIncluded(testPath) && !isExcluded(testPath);
		});
	}
	async #readEntries(uri) {
		return readChildEntries(uri.toString()) ?? vscode.workspace.fs.readDirectory(uri);
	}
	async #cascadeDownward(uri, checked) {
		const entries = this.#filterEntries(await this.#readEntries(uri), uri);
		for (const [name, type] of entries) {
			const childUri = vscode.Uri.joinPath(uri, name);
			checked ? this.check(childUri.toString()) : this.uncheck(childUri.toString());
			if (type === vscode.FileType.Directory) await this.#cascadeDownward(childUri, checked);
		}
	}
	async #cascadeUpward(uri, rootUri, propagateUncheckedUpward) {
		const parentUri = vscode.Uri.joinPath(uri, "..");
		if (parentUri.path === rootUri.path) return;
		if (propagateUncheckedUpward) this.uncheck(parentUri.toString());
		else {
			const allChecked = this.#filterEntries(await this.#readEntries(parentUri), parentUri).every(([name]) => this.#checkedUris.has(vscode.Uri.joinPath(parentUri, name).toString()));
			allChecked ? this.check(parentUri.toString()) : this.#assertParentUnchecked(parentUri.toString());
			propagateUncheckedUpward = !allChecked;
		}
		await this.#cascadeUpward(parentUri, rootUri, propagateUncheckedUpward);
	}
	async cascade(uri, entryType, checked) {
		checked ? this.check(uri.toString()) : this.uncheck(uri.toString());
		const rootUri = getRootUri();
		await Promise.all([entryType === vscode.FileType.Directory ? this.#cascadeDownward(uri, checked) : Promise.resolve(), this.#cascadeUpward(uri, rootUri, !checked)]);
	}
	getCheckedUris() {
		return [...this.#checkedUris];
	}
	/**
	* 一次性、背靠实时数据的展开目录 URI 迭代器，只在 reconcile 场景消费一次。
	* @returns {IterableIterator<string>}
	*/
	getOneTimeLiveIteratorOfExpandedDirectoryUri() {
		return this.#currentlyExpandedDirectoryUris.values();
	}
	hasUri(uriString) {
		return this.#checkedUris.has(uriString);
	}
	get numberOfCurrentCheckedUris() {
		return this.#checkedUris.size;
	}
	restoreCheckedUris(uris, { shouldRefresh = true } = {}) {
		this.#checkedUris.replaceAll(uris);
		if (shouldRefresh) this.refresh({ clearTree: false });
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
		const parentUri = vscode.Uri.joinPath(currentEntryNode.uri, "..");
		if (parentUri.toString() === getRootUri().toString()) return;
		return new EntryNode(parentUri, vscode.FileType.Directory);
	}
	#assertParentUnchecked(parentUriString) {
		if (this.#context.extensionMode === vscode.ExtensionMode.Development && this.#checkedUris.has(parentUriString)) throw new Error(`父目录本应是未勾选状态，但实际发现它已被勾选: ${parentUriString}`);
	}
};
//#endregion
//#region src/snapshots/checkboxSelection/explicit.js
const MAX_SNAPSHOTS = 4;
function loadSnapshots() {
	return workspaceStore.get("derba.snapshots") ?? [[], []];
}
function saveSnapshots(snapshots) {
	workspaceStore.update("derba.snapshots", snapshots);
}
async function saveSnapshot(context, provider) {
	if (provider.numberOfCurrentCheckedUris === 0) return;
	const snapshots = loadSnapshots();
	if (snapshots[0].length >= MAX_SNAPSHOTS) {
		snapshots[1] = [];
		saveSnapshots(snapshots);
		return;
	}
	const matchingIndex = findMatchingSnapshotIndex(snapshots, provider);
	if (matchingIndex !== -1) {
		const [snapshotLevel1Index, snapshotLevel2Index] = matchingIndex >= snapshots[0].length ? [1, matchingIndex - snapshots[0].length] : [0, matchingIndex];
		const subSnapshots = snapshots[snapshotLevel1Index];
		const matchingSnapshot = subSnapshots[snapshotLevel2Index];
		vscode.window.showInformationMessage(`快照「${matchingSnapshot.name}」已存在。`);
		matchingSnapshot.createdAt = (/* @__PURE__ */ new Date()).toISOString();
		subSnapshots.unshift(subSnapshots.splice(snapshotLevel2Index, 1)[0]);
		saveSnapshots(snapshots);
		return;
	}
	const name = await vscode.window.showInputBox({
		prompt: "给这个快照起个名字",
		placeHolder: "例如：登录模块相关文件"
	});
	if (name === void 0) return;
	snapshots[1].unshift({
		id: crypto.randomUUID(),
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		pinned: false,
		name,
		description: "",
		checkedUris: provider.getCheckedUris()
	});
	const negativeOverflow = MAX_SNAPSHOTS - snapshots[0].length - snapshots[1].length;
	if (negativeOverflow < 0) snapshots[1].splice(negativeOverflow);
	saveSnapshots(snapshots);
}
const buildQpItems = (snapshots) => snapshots.flat().map((s, index) => ({
	label: s.name,
	description: s.description,
	detail: initDateTimeFormatter().format(new Date(s.createdAt)),
	iconPath: new vscode.ThemeIcon(s.pinned ? "pinned" : "dash"),
	indices: [s.pinned ? 0 : 1, s.pinned ? index : index - snapshots[0].length],
	buttons: [{
		iconPath: new vscode.ThemeIcon(s.pinned ? "pinned" : "pin"),
		tooltip: s.pinned ? "取消置顶" : "置顶"
	}, {
		iconPath: new vscode.ThemeIcon("edit"),
		tooltip: "编辑"
	}]
}));
function findMatchingSnapshotIndex(snapshots, provider) {
	return snapshots.flat().findIndex((s) => s.checkedUris.length === provider.numberOfCurrentCheckedUris && s.checkedUris.every((uri) => provider.hasUri(uri)));
}
function showSnapshotPicker(context, provider) {
	const previousCheckedUris = provider.getCheckedUris();
	const snapshots = loadSnapshots();
	const [pinned] = snapshots;
	const qp = vscode.window.createQuickPick();
	qp.ignoreFocusOut = true;
	qp.keepScrollPosition = true;
	qp.matchOnDescription = true;
	qp.matchOnDetail = true;
	if (pinned.length > MAX_SNAPSHOTS) qp.prompt = `❌ 置顶快照（${pinned.length}）超出槽位上限（${MAX_SNAPSHOTS}），取消置顶多余快照将其删除。`;
	qp.items = buildQpItems(snapshots);
	const matchingIndex = findMatchingSnapshotIndex(snapshots, provider);
	if (matchingIndex !== -1) qp.activeItems = [qp.items[matchingIndex]];
	qp.onDidChangeActive((activeItems) => {
		const active = activeItems[0];
		if (!active) return;
		const snapshot = snapshots[active.indices[0]][active.indices[1]];
		provider.restoreCheckedUris(snapshot.checkedUris);
	});
	let accepted = false;
	qp.onDidAccept(() => {
		accepted = true;
		qp.hide();
	});
	qp.onDidHide(() => {
		if (!accepted) provider.restoreCheckedUris(previousCheckedUris);
		qp.dispose();
	});
	qp.onDidTriggerItemButton(async ({ item, button }) => {
		const [groupIndex, itemIndex] = item.indices;
		const snapshot = snapshots[groupIndex][itemIndex];
		switch (button.tooltip) {
			case "置顶":
			case "取消置顶": {
				const targetGroup = snapshot.pinned ? 1 : 0;
				snapshots[groupIndex].splice(itemIndex, 1);
				snapshot.pinned = !snapshot.pinned;
				snapshots[targetGroup].some((snapshotInTheGroup, index, snapshotTargetGroup) => {
					if (snapshot.createdAt >= snapshotInTheGroup.createdAt) {
						snapshotTargetGroup.splice(index, 0, snapshot);
						return true;
					}
				}) || snapshots[targetGroup].push(snapshot);
				saveSnapshots(snapshots);
				qp.items = buildQpItems(snapshots);
				break;
			}
			case "编辑": {
				const name = await vscode.window.showInputBox({
					prompt: "修改快照名称",
					value: snapshot.name
				});
				if (name === void 0) break;
				let description = await vscode.window.showInputBox({
					prompt: "修改描述（可选，直接回车跳过）",
					value: snapshot.description
				});
				snapshot.name = name;
				snapshot.description = description ?? snapshot.description;
				saveSnapshots(snapshots);
				qp.items = buildQpItems(snapshots);
				break;
			}
		}
	});
	qp.show();
}
function initDateTimeFormatter() {
	const locale = vscode.workspace.getConfiguration("derba").get("locale") || vscode.env.language;
	return new Intl.DateTimeFormat(locale, {
		month: "long",
		day: "numeric",
		weekday: "long",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false
	});
}
//#endregion
//#region src/context.js
async function extractContext(provider) {
	const checkedUriStrings = provider.getCheckedUris();
	const realUris = [];
	for (const uriString of checkedUriStrings) {
		const uri = vscode.Uri.parse(uriString);
		if ((await vscode.workspace.fs.stat(uri)).type === vscode.FileType.File) realUris.push(uri);
	}
	const contextDelimiters = {
		scope: "## Relevant Workspace Files to this message\n\n",
		fence: "```"
	};
	getRootUri();
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
//#endregion
//#region src/utils/reconcileWithFileSystem.js
let fileSelectorProvider = null;
function bindFileSelectorProviderToReconciler(provider) {
	fileSelectorProvider = provider;
}
function reconcileAllCheckedUrisWithFileSystem(collectedValidUris) {
	const snapshots = loadSnapshots();
	let snapshotsChanged = false;
	snapshots.flat().forEach((snapshot) => {
		const filtered = snapshot.checkedUris.filter((uri) => collectedValidUris.has(uri));
		if (filtered.length !== snapshot.checkedUris.length) {
			snapshot.checkedUris = filtered;
			snapshotsChanged = true;
		}
	});
	if (snapshotsChanged) workspaceStore.update("derba.snapshots", snapshots);
	const currentCheckedUris = fileSelectorProvider.getCheckedUris();
	const filteredUris = currentCheckedUris.filter((uri) => collectedValidUris.has(uri));
	if (filteredUris.length !== currentCheckedUris.length) fileSelectorProvider.restoreCheckedUris(filteredUris, { shouldRefresh: false });
	for (const uri of fileSelectorProvider.getOneTimeLiveIteratorOfExpandedDirectoryUri()) if (!collectedValidUris.has(uri)) fileSelectorProvider.recordCollapsedDirectory(uri);
}
//#endregion
//#region src/workspaceFileTree/traverser.js
function traverseWorkspaceFileAndBuildMap() {
	return traverseDown(getRootUri());
}
const traverseDown = async (parentEntryUri) => {
	const subEntries = await vscode.workspace.fs.readDirectory(parentEntryUri);
	cacheChildEntries(parentEntryUri.toString(), subEntries);
	const directorySubEntries = subEntries.values().filter(([, entryType]) => entryType === vscode.FileType.Directory).map(([name]) => traverseDown(vscode.Uri.joinPath(parentEntryUri, name)));
	return Promise.all(directorySubEntries);
};
async function synchronouslyBuildWorkspaceFileTree(shouldFollowUpWithReconcileAfterRebuild = false) {
	await traverseWorkspaceFileAndBuildMap();
	shouldFollowUpWithReconcileAfterRebuild && reconcileAllCheckedUrisWithFileSystem(convertCacheMapToUriSet(getRootUri().toString()));
}
const asynchronouslyBuildWorkspaceFileTree = (() => {
	let debouncedBuildSubscriber;
	let followUp;
	disposableRegistry.register(new Observable((subscriber) => {
		debouncedBuildSubscriber = subscriber;
		return () => {};
	}).pipe(debounceTime(200)).subscribe({ next: () => {
		synchronouslyBuildWorkspaceFileTree(followUp);
		followUp = false;
	} }));
	return (shouldFollowUpWithReconcileAfterRebuild = false) => {
		followUp ||= shouldFollowUpWithReconcileAfterRebuild;
		debouncedBuildSubscriber.next();
	};
})();
//#endregion
//#region src/extension.js
/**
* @param {vscode.ExtensionContext} context
*/
function activate(context) {
	initWorkspaceStore(context);
	synchronouslyBuildWorkspaceFileTree(true);
	const provider = new FileSelectorProvider(context);
	bindFileSelectorProviderToReconciler(provider);
	const treeView = vscode.window.createTreeView("derba.fileSelector", {
		treeDataProvider: provider,
		manageCheckboxStateManually: true
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
	autoPersistExpandedDirectoryUrisOnChange(provider.expandedDirectoryUriSelection$);
	context.subscriptions.push(treeView, ...disposableRegistry.getAll(), vscode.commands.registerCommand("derba.saveSnapshot", () => saveSnapshot(context, provider)), vscode.commands.registerCommand("derba.showSnapshotPicker", () => showSnapshotPicker(context, provider)), vscode.commands.registerCommand("derba.extractContext", () => {
		extractContext(provider);
	}), vscode.workspace.onDidChangeConfiguration((configChangeEvent) => {
		if (configChangeEvent.affectsConfiguration("derba.include") || configChangeEvent.affectsConfiguration("derba.exclude")) {
			clearWorkspaceFileTreeCache();
			synchronouslyBuildWorkspaceFileTree(true);
			provider.refresh({ clearTree: false });
		}
	}));
	if (context.extensionMode === vscode.ExtensionMode.Development) context.subscriptions.push(vscode.commands.registerCommand("derba.temporaryDebug", async () => {
		const testNode = new EntryNode(vscode.Uri.parse("file:///d%3A/vscode-extensions/test-projects/parent_one/branch_one/branch.js"), vscode.FileType.File);
		await treeView.reveal(testNode, {
			expand: true,
			select: true,
			focus: true
		});
		console.log("debug结束！");
	}));
}
function registerFileWatcher(provider, context) {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (workspaceFolder) {
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, "**/*"), false, true, false);
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
			preserveFocus: false
		});
	});
}
function deactivate() {}
//#endregion
export { activate, deactivate };

//# sourceMappingURL=extension.mjs.map