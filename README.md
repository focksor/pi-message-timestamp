# pi-message-timestamp

pi 编码代理扩展：为聊天消息显示时间戳，并在 AI 工作时实时显示已耗时。

## 功能

1. **消息时间戳**
   - 用户消息：时间追加在消息框内部末尾（斜体小字），不占独立行
   - 助手消息：最终文本回复下方一行灰色小字：时间 + 整轮耗时（含中间工具执行）；被中断的回复也会标注
2. **AI 工作实时计时**：Agent 工作期间，最底部 footer 状态行每秒刷新已耗时（`⏳ 0:05` → `⏳ 1:23`），工作完全结束后自动消失

## 效果

```
帮我看看这个 bug             ← 用户消息
│ （框内末尾）── 14:32:05 ── │
这个问题的原因是 ……          ← 助手回复
── pi · 14:32:18 · 13s ──     ← 回复下方：时间 + 整轮耗时
   ……
⏳ 1:23                       ← 最底部 footer：AI 工作实时计时（每秒跳动）
```

## 实时工作计时

- **计时区间**：`agent_start`（开始工作）→ `agent_settled`（完全结束，即自动重试/压缩/后续消息全部处理完；比 `agent_end` 更准确）
- **实现**：`ctx.ui.setStatus()` 写入 footer 状态行 —— pi 内部每次 setStatus 都会触发 footer 重绘，因此无需接管或重建整个 footer
- **与自定义 footer 共存**：`pi-footer` 等接管 footer 的扩展会渲染可见的扩展状态行，计时仍会显示在其最底部
- **兜底**：定时器内检测 `ctx.isIdle()`，异常中断路径（如漏触发 `agent_settled`）下自动停止，不会空转；`session_shutdown` 时清理定时器

## 时间来源

- 用户消息：提交时通过 `input` 事件捕获（FIFO 队列，带 60 秒新鲜度保护）；恢复会话/重渲染时按文本反查 session 条目
- 助手消息：`turn_end` 时记录，耗时 = 轮次结束时刻 - 最近一条用户消息时间戳（含中间工具执行）
- 仅影响显示，不改变发给 LLM 的内容；时间随会话持久化，恢复会话后仍会显示

## 特性

- 时间格式 `HH:MM:SS`；非当天的消息会附带 `MM-DD` 日期
- 工具输出（toolResult）不显示；含工具调用的中间 assistant 消息段也跳过，只标最终文本回复，避免刷屏
- 计时显示为跑表样式：`m:ss`（如 `3:05`），超过 1 小时为 `h:mm:ss`（如 `1:02:03`）
- 流式输出期间消息时间不显示，消息定稿后才出现；实时计时则从工作开始即显示
- 无第三方运行时依赖，单文件扩展

## 安装

**方式一：本地目录注册**（适合本机自用/开发）。在 `~/.pi/agent/settings.json` 中注册：

```json
{
  "extensions": [
    "~/workSpace/pi-message-timestamp"
  ]
}
```

**方式二：作为 pi 包安装**（适合分发，已含 package.json manifest）：

```bash
pi install npm:pi-message-timestamp
# 或 git 仓库
pi install git:github.com/<user>/pi-message-timestamp
```

卸载：移除 `extensions` 数组条目或 `pi uninstall pi-message-timestamp`。

## 实现说明

- 监听 `turn_end` 事件（轮次结束、消息已落盘时触发），取事件触发时刻 `Date.now()` 作为回复完成时间（与真实落盘时间误差在毫秒级），并计算距最近一条用户消息的整轮耗时
- 通过 `pi.appendEntry()` 写入自定义条目 + `pi.registerEntryRenderer()` 注册渲染，条目不参与 LLM 上下文
- 实时计时依赖 `agent_start` / `agent_settled` 事件与 `ctx.ui.setStatus()`，不拦截输入、不修改消息
- 依赖 pi 内置的 `@earendil-works/pi-tui`（声明为 peerDependencies），无第三方运行时依赖，单文件扩展
- 作为 pi 包分发时会被 `pi` manifest（package.json）索引，`pi-package` keyword 便于包市场发现