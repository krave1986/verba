const time = Intl.DateTimeFormat().resolvedOptions().timeZone;
// 输出示例："Asia/Shanghai"
console.log(time);

const isostring = new Date().toISOString();

console.log(isostring);

const formatter = new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
});

const date = new Date(isostring);
console.log(formatter.format(date));
