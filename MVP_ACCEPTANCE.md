# 本地 MVP 验收证据

验收日期：2026-08-19
完成定义：根目录首阶段要求与 `PRD.md` v0.1；只要求可在本地运行和验证，不包含公开发布或生产部署。

## P0

| 需求                                    | 状态 | 实现与证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MEM-01 导入前说明格式、去向和边界       | 通过 | 导入界面完整列出 Markdown/TXT/JSON/JSONL/NDJSON/Context Package v0.1；`accept` 与解析器共用扩展名契约。`stream-importer.test.ts` 逐一解析 6 个扩展名，`production-shell.test.ts` 同时断言桌面/浏览器可见文案。                                                                                                                                                                                                                                                                         |
| MEM-02 每个问题引用原始记录             | 通过 | 分析器、声明式规则和清理清单均生成 `sourceIds`；问题卡可定位记录及 URI、locator、revision。`analyzer.test.ts`、`custom-rules.test.ts`、`cleanup.test.ts` 覆盖单来源、双来源和跨平台引用。                                                                                                                                                                                                                                                                                              |
| MEM-03 邮箱、电话、证件、地址、密钥脱敏 | 通过 | 导入、显示、持久化、修正历史、快照差异和导出均复用安全净化；secret 记录隐藏正文和来源元数据。`analyzer.test.ts`、`importer.test.ts`、`storage.test.ts`、`snapshot.test.ts` 与 E2E 覆盖假凭据不出现在页面、持久化副本和导出。                                                                                                                                                                                                                                                           |
| MEM-04 区分删除建议与实际删除           | 通过 | 状态为“建议删除”，人工清理清单明确工具未登录平台、未执行删除或修正。`cleanup.test.ts` 断言不出现“删除成功”等误导措辞。                                                                                                                                                                                                                                                                                                                                                                 |
| MEM-05 导出默认排除 secret              | 通过 | Context Package 和迁移 Markdown 默认丢弃 secret 记录，导出前再次扫描已知凭据；`exporter.test.ts` 与 `analyzer.test.ts` 验证泄露为零，E2E 检查下载文件。                                                                                                                                                                                                                                                                                                                                |
| 核心视图：全部记忆/时间线               | 通过 | 新建独立“全部记忆”标签，不依赖问题列表；显示标题/摘要、类型、作用域、置信度、敏感级别、标签、URI、locator、platform、revision、观察/导入时间和所属快照，同屏展示导入、修正和快照时间线。`memory-workspace.test.ts` 断言真实 0 问题记录可见与上述元数据；对 opaque declared-secret 修订原因同时检查 `buildMemoryTimeline` 序列化和最终 DOM，原文均不存在且 detail 为固定占位。`workspace-tabs.test.ts` 覆盖四标签键盘循环；响应式 CSS 在 860px/520px 断点保留整个元数据列表并纵向堆叠。 |

P0 成功场景证据：

- “住在上海”与“已搬到杭州”作为带双来源的时间相关冲突，不自动删除旧记录。
- 假 API Key、密码和 URL 凭据在记录、错误、索引、快照和导出中均不保留明文。
- 2026-08-19 在 Chromium、Firefox、WebKit 中 9/9 完成生产构建加载、无外部请求、无障碍扫描、导入、脱敏导出和一键清除。
- 所有规则检查均为本地确定性代码，不依赖模型或在线服务；结果明确标记 `rule` 或 `inference`。
- 0 问题记录经分析器确认为空问题集后，仍能在“全部记忆”中查看详情、来源和快照归属。

## P1

| 需求                      | 状态 | 实现与证据                                                                                                                                    |
| ------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| MEM-06 修正并保留历史     | 通过 | 支持修正标题、内容、作用域和原因；保留 before/after、时间和本地修订来源，且历史再次脱敏。`corrections.test.ts` 覆盖正常、secret 和非法原因。  |
| MEM-07 按平台人工清理清单 | 通过 | 清单按 ChatGPT、Claude、Codex、本地文件、其他来源分类；每步含动作、完整来源引用和人工执行声明。`cleanup.test.ts` 覆盖排序、跨平台与缺失来源。 |
| MEM-08 两份快照差异       | 通过 | 支持新增、删除、修改、未变化，稳定 ID 优先并以 URI + locator 回退；secret 两侧均隐藏。`snapshot.test.ts` 覆盖全部差异类型与字段级变化。       |

此外已实现搜索、筛选、时间线、声明式自定义规则、浏览器本地持久化，以及可选的 macOS
Tauri 加密资料库、系统验证、原生文件选择和加密备份。后者提高本地安全性，但不是 PRD P0
完成的前提。

## P2 / 上线边界

PRD v0.1 没有定义 P2 功能。本轮把以下能力明确留在“公开上线”边界，不阻塞本地 MVP：

- Developer ID 正式签名、Apple 公证、staple、Gatekeeper 与正式 DMG 分发；
- 真实更新 HTTPS 地址、Minisign 公钥/离线私钥、签名清单、升级与回滚演练；
- Intel 与 Apple Silicon 真机矩阵、Touch ID/系统密码完整体验和跨版本迁移实测；
- 生产托管、监控、支持渠道、发布审批、真实用户数据和凭据接入。

## 复验命令

```bash
npm ci --ignore-scripts
npm run check:offline
# 环境允许监听本机端口和访问 npm 公告服务时：
npm run check
```

可选 macOS 安全核心：

```bash
cd src-tauri
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo test --locked --features sqlcipher
cargo build --locked --release
```

通过这些命令只证明本地候选满足本轮完成定义，不等于已经签名、公证、部署或公开上线。

## 2026-08-19 本轮实测记录

- `npm run check:offline`：通过。
- Vitest：15 个测试文件、117 项测试全部通过。
- 覆盖率：statements 90.34%、branches 80.85%、functions 91.95%、lines 94.88%。
- TypeScript、ESLint、Prettier、Vite 生产构建、secret scan：全部通过。
- CycloneDX 1.6 npm SBOM：3 个生产组件，校验通过。
- 许可证清单：3 个 npm、259 个双架构 Rust 生产依赖，锁文件一致性通过。
- Rust 默认测试 38/38、SQLCipher 39/39；`cargo fmt`、全特性 Clippy `-D warnings`、离线 release build：全部通过。
- Playwright：Chromium、Firefox、WebKit 共 9/9 通过；覆盖安全响应头、零外部请求、axe、导入、持久化脱敏、下载导出和清除后不重建数据。
- npm 高危依赖审计：0 个漏洞。
- 供应商格式假 Token 已改为运行时分段生成；仓库静态前缀扫描与项目 secret scan 均通过。
- 本轮没有生成新的签名、公证、桌面 GUI、真实设备或托管 GitHub Actions 证据；这些边界仍按 `GA_READINESS.md` 处理。
