# 分支保护与三平台 CI

`main` 必须通过 PR 合入，禁止直接提交 / 推送、强推和删除。规则适用于管理员，没有绕过名单。规则源文件为仓库根目录的 `.github/rulesets/main.json`；GitHub 中已启用同名 ruleset，JSON 文件本身不会自动修改远端规则。

合入必须满足最新 `main` 的检查，且评审讨论全部解决。当前不强制独立审批人数，保留单人维护仓库通过 PR 正常合入的能力。

| 必需检查名称 | 环境 | 内容 |
| --- | --- | --- |
| Android | Ubuntu 宿主 + Android 15 / API 35 x86_64 模拟器 + 设备 Chrome | 类型、全部回归测试、数学渲染、课件笔记质检、生产构建，以及真实 Android 浏览器冒烟 |
| macOS | GitHub macOS runner + WebKit | 相同静态 / 回归 / 构建检查，以及 WebKit 浏览器冒烟 |
| Windows | GitHub Windows runner + Chromium | 相同静态 / 回归 / 构建检查，以及 Chromium 浏览器冒烟 |

Android 不是手机 viewport 模拟，测试会检查设备连接与浏览器 Android UA；macOS 的 WebKit 用于覆盖 Safari 内核行为，不等同于发布版 Safari 的完整兼容认证。此项目没有原生安装包构建任务。

CI 使用 Node.js 24，统一设置 `NEXT_PUBLIC_BASE_PATH=/teachdemo`，浏览器实际访问带此前缀的生产服务。每次 PR 和 `main` 推送触发，也可手动触发。文档变动不跳过三个必需检查。

`npm test` 自动发现 `tests/*.test.mjs`，后续自测和课堂测试放在该目录即可接入所有平台，不需要每个线程并发改脚本。

浏览器冒烟覆盖健康检查、首页进入、对话 / 自学 / 资料导航、课件资源子路径和笔记 IndexedDB 保存后刷新恢复。不依赖真实模型 API Key；PDF 生成与真实 AI 教学效果继续按功能验收清单单独验证。截图、Playwright trace 与生产服务日志上传为 `smoke-Android`、`smoke-macOS`、`smoke-Windows`，保留 7 天。

本地复现（在 `teaching-agent/`，使用独立工作树，避免覆盖开发服务的 `.next`）：

```powershell
npm ci
npm run typecheck
npm test
npm run test:math
node scripts/qa-slide-notes.mjs
$env:NEXT_PUBLIC_BASE_PATH = '/teachdemo'
npm run build
npx playwright install chromium
$env:CI_BROWSER = 'chromium'
npm run test:browser
```

macOS 设置 `CI_BROWSER=webkit` 并安装 `webkit`。Android 需要启动包含 Chrome 的 Google APIs 模拟器和 ADB，再以 `CI_BROWSER=android` 运行；脚本通过 `adb reverse` 把设备端口连接到本机生产服务，不占用用户的日常浏览器或笔记。

检查名 `Android` / `macOS` / `Windows` 是远端 ruleset 的契约，不随意改名。修改工作流和规则也走 PR，不临时放宽门禁合入。
