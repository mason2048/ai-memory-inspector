# macOS GA Readiness

更新日期：2026-08-19
目标：macOS 13+、免费无账号、中文首发、Developer ID 直接分发的个人桌面产品。

状态只使用三类：`已验证`、`部分`、`阻断`。源代码测试、应用打包、签名公证、真实设备验收和公开发布是不同证据层。

| 能力                  | 状态               | 当前证据                                                                                                          | 进入 GA 的完成条件                                                               |
| --------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| PRD P0 检查流程       | 已验证（Web MVP）  | 主动导入、来源引用、脱敏、删除措辞和 secret 导出排除有单元与 E2E 覆盖                                             | 用桌面真实加密存储和原生选择器重跑相同验收                                       |
| macOS 13+ Tauri 外壳  | 部分               | 已实现解锁、加密数据工作区、原生选择与备份；已配置 macOS 13 下限、最小 IPC、严格 CSP                              | 在签名候选上完成桌面 GUI、睡眠/恢复和故障路径真机验收                            |
| 系统身份验证          | 部分               | Keychain `userPresence` + ThisDeviceOnly 主密钥链已实现并双架构编译                                               | 正式签名设备验收 Touch ID/系统密码/取消/升级连续性                               |
| 全量本地加密          | 部分               | 桌面业务状态已接入 direct-key AES-256-GCM 唯一资料库；禁止明文回退                                                | 桌面故障注入、睡眠/崩溃/多进程和真实迁移 fixture 验收                            |
| 完整备份/恢复         | 部分               | `.amibackup` v1、独立 Argon2id 口令、认证加密、原生选择和原子恢复测试已实现                                       | 跨设备 GUI 实测、迁移前自动检查点与前两版真实备份 fixture                        |
| 自动锁定与遮罩        | 部分               | 10 分钟自动锁、失焦/后台遮罩已实现                                                                                | 与真实密钥生命周期集成；睡眠、锁屏、多窗口和异常路径桌面 E2E                     |
| 签名自动更新          | 阻断               | 基础默认关闭；已实现单 HTTPS 端点/Minisign 公钥 overlay 生成与失败关闭门禁                                        | 提供真实端点/公钥，完成离线签名 manifest、降级拒绝、撤销、分批发布和真实更新验收 |
| Developer ID DMG      | 阻断               | 已有正式图标源、hardened runtime、最小 entitlements 和未签名打包验证                                              | Developer ID 签名、公证、staple、Gatekeeper 与干净设备安装验收                   |
| Apple Silicon + Intel | 部分               | 未签名 universal `.app` 已构建，主二进制含 `x86_64 arm64`、minOS 13.0                                             | 两架构真实设备启动、签名嵌套二进制与 notarized DMG 验收                          |
| 默认无遥测            | 已验证（当前构建） | 无遥测依赖，生产 CSP `connect-src 'none'`，E2E 断言无外部请求                                                     | updater 上线后继续保证记忆数据与诊断零外传，并增加网络 allowlist 测试            |
| 质量与供应链          | 部分               | npm 锁定、覆盖率、三浏览器 E2E、secret scan、双架构生产许可证清单；CI 已配置精确版本 Cargo audit 与 Rust/npm SBOM | 在托管 CI 实跑新门禁；补桌面 E2E、校验和和产物 provenance                        |
| 公开支持与合规        | 阻断               | 已有双语说明、私密漏洞报告路由、隐私 Issue 模板、隐私/威胁模型、双许可证与第三方清单                              | 仓库发布后启用并验证私密漏洞报告，落实支持负责人、分发声明与人工 notice 审核     |

## P0 开发顺序

1. 原生身份与密钥：先保证系统验证和 Keychain 访问控制正确，再允许桌面 UI 进入业务区。
2. 单一加密资料库：实现事务 CRUD、schema、并发版本、崩溃恢复、精确清除和迁移检查点。
3. 原生导入与全量备份：文件对话框返回用户授权句柄；Rust 预检并流式处理；备份恢复不依赖主 Keychain。
4. 更新和发布链：更新签名与 Apple 代码签名使用不同密钥；overlay 只从公开构建变量生成并经过静态门禁，再接生产端点和离线私钥签名服务。
5. 候选门禁：锁定同一版本、同一源修订和同一产物，完成 universal、签名、公证、staple、干净设备验收后才可发布。

## 不可替代的验收证据

- `npm run check` / `cargo test`：代码候选质量证据。
- `npm run license:check`：两份生产锁图许可证字段与已提交清单一致的证据；不替代人工法律审查。
- `npm run updater:release-config:check`：基础默认关闭、生产 overlay 形状和输入拒绝策略的静态证据；不证明真实端点或签名可用。
- `.app` / `.dmg` 可生成：打包证据。
- `codesign --verify`、`spctl --assess`、`stapler validate`：签名、公证与 Gatekeeper 证据。
- macOS 13 Intel、macOS 13 Apple Silicon、当前 macOS 的首次安装/升级/恢复：兼容性证据。
- 真实发布端点上的签名更新、撤销与回滚演练：运维证据。

缺少后面任一层时，不得把前一层描述为“已生产上线”。

当前仓库没有真实 `AMI_UPDATER_ENDPOINT`、`AMI_UPDATER_PUBLIC_KEY`、更新私钥或发布托管权限；
因此配置生成能力已具备，但签名自动更新仍是外部阻断项。

## 当前外部环境验证记录

- universal `.app` 已实际构建并进入锁定状态；系统身份验证失败时仍保持锁定，没有明文回退。
- 主二进制已确认包含 `arm64` 与 `x86_64`。
- 当前产物只有 ad-hoc/linker 签名，`spctl` 拒绝；这证明 fail-closed 行为，不证明可分发。
- 进入 GA 前仍需 Developer ID 签名、公证与 staple，Apple Silicon/Intel 真机验收，以及真实 HTTPS updater/Minisign 端点的更新与回滚演练。
