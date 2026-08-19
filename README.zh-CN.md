# AI Memory Inspector · AI 记忆检查器

[English](README.md) · [中文操作说明](docs/USER_GUIDE.zh-CN.md) ·
[安全策略](SECURITY.md) · [隐私边界](PRIVACY.md)

AI Memory Inspector 是一款本地优先的 AI 记忆检查工具。它只处理你主动选择或粘贴的可见
记录，可以发现重复项、部分冲突、过期或无来源记录以及已知敏感模式，并支持查看时间线、
比较快照、生成脱敏导出和人工清理清单。

> **v0.3.0 源码预览。** 当前仓库只公开源代码，不提供可下载应用、签名 DMG、GitHub
> Release、生产服务或自动更新。macOS 桌面壳尚未完成 Developer ID 签名、Apple 公证和真机
> 发布验收，外部阻断项见 [GA_READINESS.md](GA_READINESS.md)。

本工具不能读取 ChatGPT、Claude、Codex 或其他厂商没有公开的内部记忆；不会读取浏览器
Cookie、登录任何平台，也不能证明平台侧记录已经被修改或删除。

## 已实现能力

- 导入 Markdown、TXT、JSON、JSONL、NDJSON、Context Package v0.1，或直接粘贴文本。
- 查看全部规范化记录、来源元数据、检查结果、修正历史和本地时间线。
- 比较两份导入快照，区分新增、删除、修改和未变化记录。
- 在显示、保存和导出前检测并脱敏已知凭据及个人信息模式。
- 导出脱敏 Context Package、迁移 Markdown 和按平台分组的人工清理清单；默认排除
  `secret` 记录。
- 运行字段白名单和复杂度受限的声明式本地规则；不会把导入内容当作代码执行。
- 以浏览器开发模式运行，或从源码启动 macOS Tauri 候选。

## 浏览器与桌面模式边界

| 模式                 | 保存位置                                                            | 原生能力                                                                      |
| -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 浏览器开发模式       | 净化后的项目数据写入浏览器 `localStorage`                           | 没有系统验证、原生保险库或完整加密备份                                        |
| macOS Tauri 源码候选 | 单一 AES-256-GCM 加密项目容器；设备密钥受 Keychain 用户在场策略保护 | 原生文件选择、系统解锁、锁定/失焦遮罩、独立口令保护的 `.amibackup` 导出与恢复 |

浏览器版本没有应用服务端、账号、遥测、广告或第三方 API；生产 CSP 禁止对外连接。桌面
原生安全桥接不可用时必须保持锁定，不能回退到浏览器明文存储。

## 快速启动浏览器开发模式

需要 Node.js 24.14.1、npm 11.11.0。

```bash
git clone https://github.com/mason2048/ai-memory-inspector.git
cd ai-memory-inspector
npm ci --ignore-scripts
npm run dev -- --host 127.0.0.1 --port 4173
```

打开 `http://127.0.0.1:4173`，按 `Ctrl+C` 停止。应用不会自动填充示例数据；首次体验建议
主动导入 `examples/` 下的完全虚构文件。

## 从源码启动 macOS Tauri 候选

除上述 Node/npm 版本外，还需要 Rust 1.85 或更新版本、Xcode Command Line Tools 和 Tauri 2
的 macOS 前置依赖：

```bash
npm ci --ignore-scripts
npm exec tauri -- dev
```

系统应在加密保险库打开前要求用户在场验证。原生导入和备份对话框由 Rust 打开，渲染层既
不提供也不接收文件系统路径。这个开发运行不是已签名或已公证的应用。

完整的首次操作、检查、时间线、快照比较、修正、脱敏、导出、备份、恢复、数据清理和故障
排查见 [中文操作说明](docs/USER_GUIDE.zh-CN.md)。

## 验证

不依赖浏览器监听端口的前端与供应链门禁：

```bash
npm run check:offline
```

机器允许监听 `127.0.0.1`、已经安装 Playwright 浏览器且可访问 npm 安全公告服务时，运行：

```bash
npm exec playwright install chromium firefox webkit
npm run check
```

原生核心需要单独验证：

```bash
cd src-tauri
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo test --locked --features sqlcipher
cargo build --locked --release
```

源码检查通过不等于完成签名、公证、Gatekeeper、真实设备兼容、更新安全或生产验收。

## 安全与隐私

- 只导入你有权处理的数据；提交缺陷时必须使用虚构数据。
- 脱敏只能降低误泄露风险，不能保证识别所有凭据或个人信息。
- “建议删除”和清理清单只是人工建议，不是厂商平台的删除回执。
- “清除全部本地数据”只覆盖本应用管理的存储，不覆盖下载、备份、浏览器/系统快照或平台数据。
- 不要在公开 Issue 中提交漏洞、记忆导出、凭据或个人信息；请使用
  [GitHub 私密漏洞报告](https://github.com/mason2048/ai-memory-inspector/security/advisories/new)。

处理敏感测试材料前，请阅读 [SECURITY.md](SECURITY.md)、[PRIVACY.md](PRIVACY.md) 和
[THREAT_MODEL.md](THREAT_MODEL.md)。

## 贡献与许可证

提交 PR 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。项目采用 `MIT OR Apache-2.0` 双许可证，
使用者可任选 [MIT](LICENSE-MIT) 或 [Apache-2.0](LICENSE-APACHE)。锁定的生产依赖许可证信息见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
