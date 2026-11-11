# dsh-completion-notify

给 [DeepSeek Harness](https://github.com/deepseek-ai) 的「完成提醒」插件。

会话在**后台**跑完时，屏幕右下角弹出一张跟随深浅色主题的卡片：产品名 + 会话名 + 回答片段；点一下直接回到那个对话。灵感来自 Codex 的任务完成提醒。

> Windows 专用。原因见 [为什么不用系统通知](#为什么不用系统通知)。

## 特性

- **只在后台完成时提醒**：你正看着的那个会话跑完不会打扰；切到别的窗口 / 别的会话才提醒。
- **跟随主题**：深色、浅色两套配色，和当前 DSH 主题一致；圆角、细边框、系统字体、DPI 清晰。
- **有信息量**：显示会话名 + 该会话最后一段回答文字（纯文本，约 160 字，两行省略）。
- **点击即达**：把应用窗口唤到前台，并直接打开那个会话。
- **不打扰**：卡片不抢焦点（不会打断你打字）、不进 Alt+Tab、10 秒自动消失、点一下立即关闭。
- **提示音**：Web Audio 合成的两声轻音，可关。
- 设置里可单独关闭「应用内提示条」（默认关闭）。

## 环境要求

- DeepSeek Harness **Desktop**，Windows 10/11
- 开发与验证版本：DSH `0.2.1-rc.2`

## 安装

1. 克隆仓库：

   ```powershell
   git clone https://github.com/Hz106/dsh-completion-notify.git
   ```

2. 让 DSH 安装这个本地包（插件 → 从本地目录安装，或让 agent 调 `plugin_manager`）：

   ```
   plugin_manager install_bundle target="<克隆下来的绝对路径>"
   ```

   路径指向仓库根目录（就是 `package.json` 所在的那一层）。

3. 打开 **设置 → 通用**，最下面会出现「完成提醒」一行；点 **发送测试提醒**，右下角应弹出卡片。

> 这是本地目录安装：profile 里会建一个指向克隆目录的符号链接，所以之后 `git pull` 更新源码后，浏览器半边会热重载；Host 半边需要禁用/启用插件（或重启应用）才会加载新代码。

## 卸载

- 插件页移除该 bundle，或

  ```
  plugin_manager remove_bundle target="dsh-completion-notify"
  ```

## 使用

| 场景 | 是否提醒 |
| --- | --- |
| 你在看会话 A，会话 B 跑完 | ✅ |
| 窗口最小化 / 切到别的应用，当前会话跑完 | ✅ |
| 你正看着这个会话，它跑完 | ❌ |
| 子 Agent（subagent）会话结束 | ❌ |
| 总开关关闭 | ❌ |

设置行（设置 → 通用 → 完成提醒）包含：总开关、提示音、应用内提示条（默认关）、系统通知权限状态、发送测试提醒。

设置保存在 `localStorage` 的 `dsh.completion-notify.v1`。

## 实现

### 为什么不用系统通知

这个桌面应用没有声明 AppUserModelID，Windows 会**静默丢弃**它发出的 toast；渲染进程的 `Notification` 即使"创建成功"也看不到。部分机器上系统通知还会按应用被拦截。

所以链路是：

```
页面检测完成
   └─ POST /completion-notify/toast
        └─ Host（Node）用 PowerShell 画一张 WinForms 卡片
             └─ 点击：SetForegroundWindow 应用主窗口 + POST /completion-notify/click
                  └─ 页面轮询 /completion-notify/pending → uiWorkspace.openSession(会话)
```

卡片是插件自己的窗口，所以**不依赖系统通知设置**；代价是它不会出现在 Windows 通知中心里。

### 文件

| 文件 | 作用 |
| --- | --- |
| `client.js` | 浏览器半边：检测完成、主题、设置行、提示音、点击后打开会话 |
| `index.js` | Host 半边：路由、回答片段缓存、拉起卡片进程 |
| `toast.ps1` | PowerShell + WinForms 的卡片实现（圆角、主题、淡入、点击） |
| `cordis.patch.yml` | bundle patch，把插件行插进 profile |
| `locale/*.json` | 插件列表里的标题与描述 |

### 数据来源

- **完成判定**：`shell.overlay` 槽位的标准 props `useSessionStatus` / `useSessions`。`completionUnread` 正是侧栏"后台完成"标记，语义与应用一致；窗口失焦时，当前会话也算后台。
- **回答片段**：Host 订阅 `session/event`，缓存每个会话**最后一条有文字**的 `assistant/message`（纯文本块）。后台会话的正文页面并未加载，所以只能由 Host 侧取。
- **主题**：页面读 `body[data-ds-dark-theme]`，随请求带给 Host。

## 已知限制

- 仅 Windows。其他平台 Host 半边直接返回，页面退回浏览器 `Notification`（通常无效）。
- 卡片不会出现在 Windows 通知中心，没有历史记录。
- 点击聚焦依赖进程名 `DeepSeek Harness`；应用改名后需同步改 `toast.ps1` 里的 `AppProcessName`。
- 回答片段只取纯文本，不保留代码块结构。
- 依赖 DSH 客户端包 `@deepseek-ai/dsh-client-ui-session`、`dsh-client-ui-settings-general` 的槽位契约；DSH 大版本升级后可能需要适配。

## 开发

```powershell
node dev/harness.mjs
```

`dev/harness.mjs` 用迷你 React hook 运行时 + 假浏览器，跑逻辑检查（前台不响、后台响、失焦响、子 Agent 不响、开关关不响、点击切换、测试按钮返回值等）。

诊断日志与生成的脚本：`%TEMP%\dsh-completion-notify\`（`events.log`、`card.ps1`、`helper.err.log`）。

`package.json` 里 `"private": true`，避免误发到 npm；只作 GitHub 分发。

## License

MIT，见 [LICENSE](LICENSE)。
