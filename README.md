<p align="center">
  <img src="icons/clock.svg" width="76" height="76" alt="时区切换器图标">
</p>

<h1 align="center">Time Zone Convertor</h1>

<p align="center">时区切换器：让网页时间，跟随你的选择。</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-125%2B-13786b" alt="Chrome 125 及以上">
  <img src="https://img.shields.io/badge/Manifest-V3-13786b" alt="Manifest V3">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-13786b" alt="MIT License"></a>
</p>

一个无需构建、无需账号、无需服务端的 Chrome 扩展。选择地区时区并开启开关后，插件会自动将普通网页使用的时区切换到目标地区，支持夏令时、关闭恢复、重启恢复与实际生效检测。

A lightweight Chrome extension that automatically applies a selected IANA time zone to web pages using Chrome's native timezone emulation.

> **使用前须知：**启用时 Chrome 会显示调试提示条。关闭提示条或打开 DevTools 可能终止相关连接，之后需要点击“重新应用”。插件修改网页使用的时区，不修改系统时钟、IP 或地理位置。

[安装](#安装) · [使用](#使用) · [检测与排查](#检测与排查) · [支持范围](#支持范围) · [开发与测试](#开发与测试) · [PDF 教程](时区切换器-使用教程.pdf)

## 界面预览

<p align="center">
  <img src="docs/images/popup.png" width="340" alt="插件弹窗：搜索目标时区、预览时间并检测当前网页">
</p>

<details>
<summary>查看详细检测界面</summary>

![检测与帮助页面](docs/images/diagnostics.png)

</details>

截图来自真实测试环境；日期、时钟和标签页数量仅为示例。

## 功能

- **地区时区选择**：搜索中文城市、英文地区或 IANA 标识，例如 `Asia/Shanghai`、`America/New_York`。
- **自动应用**：处理现有网页、新标签、页面导航和浏览器重启；每分钟核对可能遗漏的标签。
- **原生日期规则**：通过 Chrome 原生模拟处理 `Date`、`Intl` 的默认时区，按地区规则处理夏令时和非整点偏移。
- **关闭恢复**：关闭插件内开关后，先清除覆盖，再断开调试连接。
- **设置持久化**：在本机保存开关和目标时区，重启后继续使用。
- **生效检测**：从当前网页读取实际时区、本地时间、UTC 偏移及冬夏偏移，显示暂停、失败和子目标警告。

## 安装

要求 **桌面版 Chrome 125 或以上版本**。日常使用无需安装 Node.js，也无需执行构建命令。

### 1. 获取源码

可以[下载源码 ZIP](https://github.com/NeverBetterEnough/time-zone-convertor/archive/refs/heads/main.zip) 并完整解压，或使用 Git：

```bash
git clone https://github.com/NeverBetterEnough/time-zone-convertor.git
```

### 2. 加载到 Chrome

1. 在 Chrome 地址栏打开 `chrome://extensions`。
2. 打开页面右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择**直接包含 `manifest.json` 的目录**，例如克隆后的 `time-zone-convertor` 文件夹。
5. 点击工具栏拼图图标，将“时区切换器”固定到工具栏。

加载后**默认开启，默认时区为 `Asia/Shanghai`**。已打开的普通网页会自动处理。

保留加载时使用的目录；不要直接选择 ZIP 文件或仓库的父目录。移动目录后，需要重新加载扩展。

完整图文说明见 [PDF 使用教程](时区切换器-使用教程.pdf)。教程中的 `E:\ChromeTimezoneSwitcher` 是本地安装示例，请替换为你的实际目录。

## 使用

### 切换时区

1. 打开一个普通 HTTP / HTTPS 网页，点击插件图标。
2. 搜索城市或地区，选择目标时区。
3. 点击“保存并应用到所有网页”，保持“自动切换”开启。
4. 在“当前标签页”区域确认网页报告的时区和检测结果。

| 地区 | 时区标识 | 规则示例 |
| --- | --- | --- |
| 上海 / 北京 | `Asia/Shanghai` | UTC+08:00 |
| 东京 | `Asia/Tokyo` | UTC+09:00 |
| 纽约 | `America/New_York` | 冬季 UTC-05:00，夏季 UTC-04:00 |
| 伦敦 | `Europe/London` | 冬季 UTC+00:00，夏季 UTC+01:00 |
| 加德满都 | `Asia/Kathmandu` | UTC+05:45 |
| 协调世界时 | `UTC` | UTC+00:00 |

浏览器可能将部分标识规范化为别名，这是正常行为。地区规则由 Chrome 内置的时区数据库处理。

### 各个按钮的作用

| 操作 | 行为 |
| --- | --- |
| 自动切换开关 | 开启自动应用；关闭后恢复系统时区 |
| 保存并应用到所有网页 | 保存所选时区并应用；关闭状态下只保存设置 |
| 重新应用 | 手动恢复当前标签的连接并重新设置时区 |
| 应用并刷新此页 | 应用设置后重新加载当前网页，关闭状态下只刷新 |
| 检测与帮助 | 打开详细检测页，选择网页并查看原生日期接口的实际结果 |

**刷新前请保存网页中的编辑内容。**网页可能缓存旧的时间字符串或格式化器，插件不会自动刷新所有标签。

上方地区时钟只是预览；判断是否生效，应查看“网页报告时区”与检测结果。

## 检测与排查

点击“检测与帮助”，选择需要检测的网页，再点击“检测”。

| 状态 | 含义 | 建议操作 |
| --- | --- | --- |
| 检测通过 | 网页报告的时区与设置一致 | 继续使用；页面内容仍旧时可刷新 |
| 待确认 | 已应用但尚未确认实际值一致 | 等待页面加载后再检测，或重新应用 |
| 已暂停 | 用户取消调试，或 DevTools 等导致连接终止 | 关闭 DevTools，再点击重新应用 |
| 应用失败 | 连接受限或与其他调试工具冲突 | 关闭冲突工具后重试，检查浏览器策略 |
| 不支持 | 当前页面不能处理 | 切换到普通 HTTP / HTTPS 网页 |
| 已关闭 | 插件内开关关闭 | 按需重新开启 |

### 常见问题

**为什么出现“正在调试此浏览器”的提示？** 这是 `chrome.debugger` 的浏览器提示。插件通过该接口使用 Chrome 原生时区模拟；关闭提示条会终止相关连接。

**关闭提示条后为什么不自动恢复？** 插件尊重主动取消，不会反复抢回暂停的标签。点击“重新应用”恢复当前页；保存设置或在检测页点击“重新应用到所有网页”可批量恢复。

**检测通过，但网站显示的时间仍未变化？** 网站可能按账号设置、服务器规则、固定 UTC 或显式指定时区显示时间，也可能缓存了旧值。先保存编辑内容，再刷新确认。

**如何恢复或卸载？** 建议先关闭插件内开关，确认恢复，再到扩展管理页停用或移除。强制停用或卸载时后台没有清理机会；若页面仍显示旧时间，请刷新或重新打开标签。

## 支持范围

本项目使用 **`chrome.debugger` + `Emulation.setTimezoneOverride`**，按标签和相关调试目标应用时区；Chrome 没有向普通扩展提供全浏览器统一修改时区的设置接口。

- **支持**普通 `http://`、`https://` 网页。
- **跳过** Chrome 内部页、扩展页、Chrome 网上应用店、`file://` 页面和休眠标签；休眠标签唤醒后重新检查。
- 跨进程 iframe 会递归连接。对关联 Worker 尝试原生覆盖；命令不可用时检查继承的时区，不一致时显示警告。
- 已运行的 Service Worker / Shared Worker 能否关联取决于 Chrome 的目标关系，**不保证所有后台环境都覆盖**。
- 自动连接与页面启动之间存在时序窗口，**无法保证早于首次访问的所有网页脚本**。
- Chrome 的共享渲染进程可能影响时区模拟。本项目统一给支持的标签使用同一时区，**不支持按网站设置不同的时区**。
- 不修改 Windows / macOS / Linux 系统时区、系统时钟、时间戳、IP、定位、浏览器语言或网站账号设置。
- 无痕窗口默认不运行。本版本未对无痕模式或其他 Chromium 浏览器作兼容性承诺。
- 企业浏览器策略、DevTools、其他调试扩展或时区工具可能限制连接或导致冲突。

## 权限与隐私

| 权限 | 用途 |
| --- | --- |
| `debugger` | 设置原生时区模拟，读取检测值，管理相关 iframe / Worker |
| `storage` | 本机保存设置，在浏览器会话内保存连接与暂停状态 |
| `tabs` | 识别普通网页、监听标签与导航、在检测页列出标签 |
| `alarms` | 每分钟核对遗漏的标签；关闭且清理完成后移除闹钟 |

扩展运行时代码没有服务器请求、遥测或第三方 CDN，不上传浏览数据。持久存储仅包含开关与时区；运行状态保存在 `storage.session`。检测页的网页标题仅用于本地选择标签。

## 开发与测试

要求 Node.js 20+。测试依赖通过 npm 安装，扩展本身无需构建。

```bash
git clone https://github.com/NeverBetterEnough/time-zone-convertor.git
cd time-zone-convertor
npm ci
npm test
```

### 真实浏览器测试

```bash
npx playwright install chromium
npm run test:e2e
```

也可以通过 `CHROMIUM_PATH` 指定 Chromium / Chrome for Testing 的可执行文件。PowerShell 示例：

```powershell
$env:CHROMIUM_PATH = 'C:\path\to\chrome.exe'
npm run test:e2e
```

普通品牌版 Chrome 的新版本不再接受 `--load-extension` 命令行参数，因此自动化测试使用 Chromium；日常安装仍按开发者模式加载。

测试使用隔离临时浏览器配置和本地 HTTP 服务，不读取或修改日常 Chrome 配置。报告与截图生成在 `test-results/`，不会提交到 Git。

初始版本已通过 **11 项单元与后台状态测试、15 项 Chromium 153.0.8010.12 端到端检查**。覆盖范围包括：

- 默认应用、设置验证、并发设置串行处理、用户取消后保持暂停、清理失败重试。
- 纽约冬夏令时、UTC+05:45 偏移、时间戳保持不变。
- 跨域 iframe、专用 / 嵌套 / 共享 Worker 及关联 Service Worker。
- 多标签切换、导航、关闭恢复、再次启用、刷新、中文搜索和重启恢复。
- 弹窗高度检查与从网页读取实际时区的检测界面。

改动代码后，在 `chrome://extensions` 点击插件卡片上的重新加载按钮，再刷新需要验证的网页。

## 项目结构

```text
manifest.json               Manifest V3 配置
background.js              后台连接、应用、清理与状态管理
core.js                    时区校验、页面范围与静态检测表达式
popup.html / .css / .js     插件弹窗
zones.js                   时区列表与常见城市中文名称
diagnostics.*              检测与帮助页面
icons/                     SVG 源图与 PNG 图标
docs/images/               README 的真实界面截图
tests/                     单元、后台状态与浏览器测试
tools/create-icons.ps1     Windows 图标生成脚本
时区切换器-使用教程.pdf       中文图文教程
LICENSE                    MIT 许可证
```

## 参与贡献

欢迎提交 [Issue](https://github.com/NeverBetterEnough/time-zone-convertor/issues) 或 Pull Request。反馈问题时，请提供 Chrome 版本、目标时区、重现步骤以及检测页结果，并移除网址、标题等不希望公开的信息。

提交代码前运行 `npm test`；涉及调试连接、时区应用或界面操作的修改，也请运行 `npm run test:e2e`。不要提交浏览器配置、凭据、`.env` 或测试产生的临时文件。

## 技术参考

- [chrome.debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Emulation.setTimezoneOverride](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setTimezoneOverride)
- [Chrome 对调试提示条的说明](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code#browserdebugger)

## 许可证

本项目采用 [MIT License](LICENSE)。
