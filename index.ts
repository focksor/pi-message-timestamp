/**
 * pi 扩展：为聊天消息显示时间戳
 *
 * - 用户消息：时间追加在消息 Markdown 末尾，随消息渲染在同一个背景框内部
 *   （斜体，如 `── 18:03:03 ──`），不再产生单独一行
 * - 助手消息：只标最终文本回复（跳过含工具调用的中间段），在回复下方渲染为一行灰色小字独立行
 *
 * 用户时间来源：
 * 1. 提交时通过 input 事件捕获（FIFO 队列，带 60 秒新鲜度保护）
 * 2. 恢复会话/重渲染时按文本反查 session 中的用户消息条目
 *
 * 仅影响显示，不改变进入 LLM 上下文的消息内容；时间随会话持久化。
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

/** 助手消息时间行的自定义条目类型名 */
const CUSTOM_TYPE = "message-timestamp";

/** 队列中提交时间的新鲜度上限（毫秒），过期视为无效 */
const TS_QUEUE_FRESH_MS = 60_000;

/**
 * 将 Unix 毫秒时间戳格式化为 HH:MM:SS；
 * 若不是今天，则在前面附带 MM-DD 日期
 */
function formatTimestamp(ts: number): string {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, "0");
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	const now = new Date();
	if (d.toDateString() !== now.toDateString()) {
		return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
	}
	return time;
}

/**
 * 将毫秒时长格式化为紧凑形式：
 * <1s → "<1s"；<60s → "xxs"；<1h → "xmxss"；否则 "xhxm"
 */
function formatDuration(ms: number): string {
	if (ms < 1000) return "<1s";
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h${m % 60}m`;
}

/** 从消息 content 中提取纯文本（兼容 string 与 block 数组两种形态） */
function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c) => (c as { type?: string }).type === "text")
		.map((c) => (c as { text?: string }).text ?? "")
		.join("\n");
}

export default function (pi: ExtensionAPI) {
	// 用户消息提交时间队列：input 事件入队，transformer 渲染时消费
	const pendingUserTs: number[] = [];
	// 会话上下文，session_start 时捕获，用于反查历史消息时间戳
	let sessionCtx: ExtensionContext | undefined;

	// 记录用户提交时刻（仅本扩展自用，不拦截输入）；
	// 限制长度防止 lookup 始终命中导致队列无限堆积
	pi.on("input", async (_event, ctx) => {
		// 顺带捕获 ctx：即使某些路径不触发 session_start，任意输入后反查也可用
		sessionCtx = ctx;
		pendingUserTs.push(Date.now());
		if (pendingUserTs.length > 16) {
			pendingUserTs.splice(0, pendingUserTs.length - 16);
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		sessionCtx = ctx;
	});

	// 按文本反查用户消息条目的时间戳（恢复会话/重渲染场景）
	function lookupUserMessageTs(markdown: string): number | undefined {
		const entries = sessionCtx?.sessionManager.getEntries();
		const target = markdown.trim();
		if (!entries || !target) return undefined;
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i] as { type?: string; timestamp?: unknown; message?: { role?: string; content?: unknown } };
			if (e?.type !== "message" || e.message?.role !== "user") continue;
			if (messageText(e.message.content).trim() !== target) continue;
			const t = e.timestamp;
			return typeof t === "number" ? t : typeof t === "string" ? Date.parse(t) : undefined;
		}
		return undefined;
	}

	// 用户消息：把时间追加到消息 Markdown 末尾，渲染进消息框内部
	pi.registerMarkdownTransformer((markdown, { messageType }) => {
		if (messageType !== "user") return markdown;

		// 防御：若上次渲染结果被重复传入，先剥掉已追加的时间行，避免叠加
		const base = markdown.replace(/\s*\*── .+ ──\*\s*$/, "");
		if (!base.trim()) return markdown;

		// 优先反查 session（此时条目通常已落盘且时间精确），失败再用提交时刻队列
		let ts = lookupUserMessageTs(base);
		if (ts === undefined) {
			while (pendingUserTs.length && Date.now() - pendingUserTs[0] > TS_QUEUE_FRESH_MS) {
				pendingUserTs.shift();
			}
			ts = pendingUserTs.shift();
		}
		if (ts === undefined) return base;
		return `${base}\n\n*── ${formatTimestamp(ts)} ──*`;
	});

	// 助手消息时间行：灰色小字独立行，只标最终文本回复；带整轮耗时（若有）
	pi.registerEntryRenderer(CUSTOM_TYPE, (entry, _options, theme) => {
		const data = entry.data as { ts?: number; durMs?: number } | undefined;
		const ts = typeof data?.ts === "number" ? data.ts : Date.now();
		let line = `── pi · ${formatTimestamp(ts)}`;
		if (typeof data?.durMs === "number" && data.durMs >= 0) {
			line += ` · ${formatDuration(data.durMs)}`;
		}
		return new Text(theme.fg("dim", `${line} ──`), 1, 0);
	});

	// 轮次结束时，若最后落盘的是不含工具调用的 assistant 消息（即最终文本回复），
	// 在其后追加时间条目 —— 此时消息条目已落盘，时间行渲染在回复下方
	// （若挂在 message_end 上，条目会排在消息条目之前，导致时间行跑到消息上方）
	pi.on("turn_end", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		const last = entries[entries.length - 1] as
			| { type?: string; message?: { role?: string; content?: unknown } }
			| undefined;
		if (!last || last.type !== "message" || last.message?.role !== "assistant") return;
		const content = Array.isArray(last.message.content) ? last.message.content : [];
		if (content.some((c) => (c as { type?: string }).type === "toolCall")) return;
		// 耗时 = 此刻 - 最近一条 user 消息的时间戳（包含中间工具执行的整轮等待）
		const now = Date.now();
		let durMs: number | undefined;
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i] as { type?: string; timestamp?: unknown; message?: { role?: string } };
			if (e?.type !== "message") continue;
			if (e.message?.role !== "user") continue;
			const t = e.timestamp;
			const userTs = typeof t === "number" ? t : typeof t === "string" ? Date.parse(t) : undefined;
			if (userTs !== undefined && now >= userTs) durMs = now - userTs;
			break;
		}
		pi.appendEntry(CUSTOM_TYPE, durMs !== undefined ? { ts: now, durMs } : { ts: now });
	});
}
