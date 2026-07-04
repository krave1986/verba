const h = [1, 2, 3].values().map((x) => x * 10);

console.log(h.toArray()); // [10, 20, 30]
console.log(h.toArray()); // []  ← 坑!第二次空了,h 已耗尽

// 更隐蔽的踩法:把 helper 当成"可重复用的集合"传来传去
const evens = [1, 2, 3, 4].values().filter((x) => x % 2 === 0);
console.log([...evens]); // [2, 4]
for (const x of evens) console.log("再遍历:", x); // 什么都不打印,已耗尽

// 对照数组:数组能反复遍历,因为它每次新造 iterator(第 4 关)
const arr = [10, 20, 30];
console.log([...arr]); // [10, 20, 30]
console.log([...arr]); // [10, 20, 30]  ← 数组可重复,helper 不行
