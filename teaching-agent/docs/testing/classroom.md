# 实时课堂验证记录

实现范围：教师验证与本人课堂恢复、真实入课二维码与手输码、三题型作答、修改/收题/公布/结束、
SQLite 持久化、权限视图、SSE 心跳与快照恢复、断线定时同步、根路径和子路径。
基于 #1 已合入的共用 catalog 判断可用题与难度，不再维护第二套可用性规则。
侧栏同时接入题库自测和实时课堂，原视图保持挂载。
部署与备份说明见 [deploy/classroom.md](../../deploy/classroom.md)。

## 自动化

```powershell
npm run typecheck
npm test
npm run test:math
node scripts/qa-slide-notes.mjs
npm run build
npm run test:browser
node --import ./scripts/register-ts.mjs scripts/classroom-load.mjs
```

根路径执行上述命令后，设置 `$env:NEXT_PUBLIC_BASE_PATH='/teachdemo'`，重新 build、test:browser 和 load。
不能只在运行时切换前缀。数据库测试始终使用操作系统临时目录，不连接真实课堂库。
多个 worktree 同时跑本地浏览器检查时，可设置 `CI_SMOKE_PORT=3150`；HTTPS 测试代理使用下一端口。

`tests/classroom.test.mjs` 由既有 npm test 自动发现，在 Android、macOS、Windows 全部执行。
覆盖参数/16 KiB 请求限制、来源检查、教师配置/所有权/会话过期、跨课堂隔离、同名不同人、
重复加入/提交/迟到旧命令、首次加入响应丢失后重试不重计人数、三题型及三态判题、同题不同轮次、状态幂等、结束冻结、
两个独立进程同时放行的收题/提交竞争、跨连接变更、SQLite 重开恢复、SSE 最新快照与取消清理。
HTTP/SSE/重连的学生视图显式检查答案/解析/grade 的缺失，学生页面与 SSR 入口没有题库导入。
整合 #1 后 npm test 包含 classroom.test.mjs 与 self-test.test.mjs，共 52 项，全部通过。

三平台生产浏览器 smoke 复用 `scripts/classroom-browser-check.mjs`：HTTPS 代理使用公开测试证书，
实际验证生产 Secure / HttpOnly Cookie；创建、二维码加载、手输入课、三题型发题/提交/收题/公布、
刷新不重复人数、请求失败可重试、结束通知；统一侧栏能进入两处新视图，对话草稿不丢失，
退出课堂视图后数据库教师 SSE 租约归零，重新进入恢复一条连接。Android 使用真实模拟器 Chrome，macOS WebKit，Windows Chromium。
截图、二维码和 trace 上传为 CI artifacts；测试证书私钥仅用于本地测试，绝不部署。

## 本机运行记录（2026-10-20）

Windows 11 x64 (10.0.26200)，Intel Core i7-10700，先用 Node.js v24.21.0 验证，再用生产固定的 v24.19.0 复验。
根路径生产构建、类型检查、全部回归、22 项数学检查、148 页课件质检和 Chromium HTTPS 闭环已通过。
已下载校验官方 Node.js v24.19.0，与生产固定版本一致，全部测试、子路径构建与 HTTPS 浏览器闭环通过。
二维码 PNG 使用独立 ZXing 解码器核对入课 URL，编码完全在本应用服务端进行，不请求外部图片服务。

| 100 名模拟学生，同出口 IP | 根路径 | /teachdemo |
| --- | --- | --- |
| SSE 状态更新 p95 | 514 ms | 489 ms |
| 提交响应 p95 | 1469 ms | 1131 ms |
| 成功持久提交 | 100 / 100 | 100 / 100 |
| Next.js 进程峰值 RSS | 187 MiB | 186 MiB |
| 20 秒空闲心跳 | 100 / 100 | 100 / 100 |
| 杀进程再启动恢复名单和提交 | 通过 | 通过 |

表中为 Node.js v24.19.0 的复验结果。压测使用真实 Next.js production HTTP/SSE、100 个独立 cookie、临时 SQLite WAL。
报告记录运行环境、延迟、RSS，且对状态 p95 ≤ 2 秒、无丢提交和 RSS ≤ 512 MiB 设置失败断言。
输出在 git 忽略的 `test-results/classroom-load-*`。

本机已有 Android 模拟器缺少 com.android.chrome，不能冒充 Android Chrome 验收；正式三平台结果以 PR CI 为准。

## 需现场完成的验收

当前工具环境没有两台可供操作的实体手机；下列项目保留为现场验收，不能以模拟器替代：

- 配置手机可达的 HTTPS/LAN origin，教师展示二维码；两台实体手机以不同姓名加入，各答一题。
- 同一手机分别用微信扫码内置浏览器、普通浏览器加入；确认相同设备同浏览器刷新不重复人数。
- 发布期间断网，提交必须提示失败；恢复网络后同步最近成功答案并可重试。
- 锁屏或后台后恢复，应先拉最新快照；教师收题后旧页面不得继续成功修改。
- 在目标 Linux Node.js 24 服务用户下检查数据库目录、WAL/SHM 可写，演练备份恢复。

此 PR 交付实现、配置和验证脚本，不执行生产发布，不记录真实学生数据。
