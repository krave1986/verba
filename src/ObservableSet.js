// observableSet.js —— 继承 Set 的可观察 Set
import { Subject } from "rxjs";

export class ObservableSet extends Set {
    #subject = new Subject();

    constructor(iterable) {
        super(); // ⚠️ 不传 iterable，避免在私有字段就绪前调到重写的 add

        // 自己负责初始化数据：用 super.add 跳过通知
        if (iterable) {
            // 初始化数据：用 super.add 静默写入，不发通知。
            // 订阅只负责广播"变化"，初始装载不算变化，故这里不 next。
            for (const item of iterable) super.add(item);
        }
    }

    get changes$() {
        return this.#subject.asObservable();
    }

    add(value) {
        super.add(value);
        this.#subject.next(this);
        return this;
    }

    delete(value) {
        const result = super.delete(value);
        this.#subject.next(this);
        return result;
    }

    clear() {
        super.clear();
        this.#subject.next(this);
    }

    // 整体替换：清空 + 批量加 + 一次通知
    replaceAll(iterable) {
        super.clear();
        for (const item of iterable) super.add(item);
        this.#subject.next(this);
    }
}
