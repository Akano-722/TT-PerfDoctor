# 更新日志

版本号遵循 `主版本.次版本.修订号`。每条只写用户能感知到的变化；修复类注明触发条件。

## 0.3.1 — 2026-10-24

提交：`4297a37`

### 修复

- **样式类 A/B 勾选后无效**：主题常用 `#bg1 { background-image: ... !important }` 这类高优先级规则，旧实现用 `body.ttpd-* *` 选择器压不过它。现在改为对候选元素逐个设置**内联 `!important`**，关闭开关时恢复原有内联值。
- `getPropertyPriority` 不可用的环境（例如部分测试宿主）不再抛错。

### 新增

- A/B 新增「**暂停所有视频 / 音频**」：对正在播放的 `<video>`/`<audio>` 调用 `pause()`。用于画中画、背景视频、音乐可视化——`display:none` 不会停止解码，只有暂停才会。

### 说明

- 样式类开关只作用于勾选那一刻已存在的节点；主题/扩展重建节点后需要重新勾选。
- 本版本没有改变报告结构，`experiments` 中新增 `pauseMedia` 状态。

## 0.3.0 — 2026-10-24

提交：`e1f1e94`

### 新增

- **定位探针**
  - 「空白遮罩 2.5s」：隐藏 `#ttpd-root` 之外的所有页面层后测 rAF，用来区分「画得多」还是「有人在算」。
  - 「iframe 内 2s」：新建 1×1 同源 iframe 测 rAF，判断是页面自身还是宿主/合成器限速。
  - 「扫描视觉嫌疑」：按占屏面积列出大面积 fixed 层、`filter`/`backdrop-filter`、背景图、CSS 动画、canvas、video、iframe。
- **TT 内置 Perf HUD 集成**：录制开始时自动 `enable()`，结束时读取 `snapshot()` 并恢复原状态。报告新增 `ttPerf`，包含长任务、事件循环延迟、invoke、内嵌 runtime、堆等数据。
- **A/B 扩充**
  - 关闭滤镜 / 模糊 / 阴影
  - 移除整页背景图
  - 隐藏 canvas / video
  - 暂停 Web Animations
  - 彻底移除全部 iframe（唯一能停掉 iframe 内脚本的开关）
- **归因增强**：调用栈支持任意协议（`http` / `https` / `file` / `blob` / 自定义 scheme）；无法解析时保留最多 3 条 `debugStacks`，写入报告。

### 变更

- 报告新增 `probe`、`visual`、`ttPerf` 字段。
- 空白遮罩期间自动关闭面板并停止采样，减少测量干扰。
- 面板新增「定位探针」区块。

## 0.2.0 — 2026-10-24

提交：`1e35511`

### 新增

- **来源归因**：按调用栈把 `addEventListener`、`setTimeout`、`setInterval` 聚合到来源文件与行号；按回调函数缓存，每秒最多采样 400 次调用栈。
- **常驻 interval 跟踪**：显示仍然存活的 interval 数量与最久存活时长。
- **第一批 A/B**：禁用动画/过渡、隐藏聊天内 iframe、隐藏聊天外 iframe。
- JSR 渲染深度增加 1 / 3 两档。

### 变更

- 当消息 DOM 已限制在 20 楼以内时，不再提示「没开虚拟化」，避免误判。

## 0.1.0 — 2026-10-24

提交：`2bb4a8d`

### 新增

- 首个版本：帧率、主线程占用、点击→下一帧延迟、单次峰值阻塞、DOM/iframe/监听器采样。
- 30 秒录制与汇总。
- 基线记录与泄漏对比。
- 聊天扫描：总楼数、字符数、swipe、含 iframe/script/HTML 的楼层、最重消息。
- JSON 报告复制。
- 可逆优化：CSS 性能模式（`content-visibility` + 图片懒加载）、JSR 渲染深度、关闭流式渲染。
- 环境读取：ChatSurface 托管状态、JSR / LittleWhiteBox 渲染设置、宿主信息。
