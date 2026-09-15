# pi-message-timestamp

pi 编码代理扩展：为聊天消息显示时间戳——用户消息的时间贴在消息框内部，助手回复在下方显示时间与耗时。

## 效果

- **用户消息**：时间追加在消息末尾，渲染在消息背景框内部（斜体，不占独立行）
- **助手消息**：最终文本回复下方一行灰色小字：时间 + 整轮耗时（含中间工具执行）；被中断的回复也会标注

```
帮我看看这个 bug             ← 用户消息
│ （框内末尾）── 14:32:05 ── │
这个问题的原因是 ……          ← 助手回复
── pi · 14:32:18 · 13s ──     ← 回复下方：时间 + 整轮耗时
```

时间来源：用户消息在提交时通过 `input` 事件捕获，恢复会话时按文本反查 session 条目；
助手消息在 `turn_end` 时记录，耗时 = 轮次结束时刻 - 最近一条用户消息时间戳（含中间工具执行）。
仅影响显示，不改变发给 LLM 的内容。

- 时间格式 `HH:MM:SS`；非当天的消息会附带 `MM-DD` 日期
- 工具输出（toolResult）不显示；含工具调用的中间 assistant 消息段也跳过，只标最终文本回复，避免刷屏
- 时间随会话持久化（不进入 LLM 上下文），恢复会话后仍会显示
- 流式输出期间不显示，消息定稿后才出现

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
# npm 发布后
pi install npm:pi-message-timestamp
# 或 git 仓库
pi install git:github.com/<user>/pi-message-timestamp
```

卸载：移除 `extensions` 数组条目或 `pi uninstall pi-message-timestamp`。

## 实现说明

- 监听 `turn_end` 事件（轮次结束、消息已落盘时触发），取事件触发时刻 `Date.now()` 作为回复完成时间（与真实落盘时间误差在毫秒级），并计算距最近一条用户消息的整轮耗时
- 通过 `pi.appendEntry()` 写入自定义条目 + `pi.registerEntryRenderer()` 注册渲染，条目不参与 LLM 上下文
- 依赖 pi 内置的 `@earendil-works/pi-tui`（声明为 peerDependencies），无第三方运行时依赖，单文件扩展
- 作为 pi 包分发时会被 `pi` manifest（package.json）索引，`pi-package` keyword 便于包市场发现
