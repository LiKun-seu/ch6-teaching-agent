# 工作区规则

## 分支与合入规则

1. `main` 仅通过 Pull Request 合入，禁止直接在 `main` 上修改、提交或推送；管理员和自动化同样遵守，不绕过 GitHub ruleset。
2. 开工前确认当前分支。每个任务使用独立分支；多个线程使用独立 Git worktree，不共享工作目录切换分支。
3. PR 合入前必须与最新 `main` 兼容，且 GitHub Actions 的 `Android`、`macOS`、`Windows` 三个检查全部成功，评审讨论已解决。禁止跳过、伪造检查或临时关闭规则合入。
4. 禁止强推或删除 `main`。CI 配置调整也通过分支和 PR，保持三个必需检查名称与 `.github/rulesets/main.json` 一致。
5. 本项目为网页应用：Android 检查在真实 Android 模拟器的 Chrome 中运行；macOS 使用 WebKit，Windows 使用 Chromium。不得以 Linux 构建或手机尺寸模拟代替 Android 检查。

## 界面组件：禁止手搓，必须用组件库

适用目录：`teaching-agent`。做界面时按本节执行，不要用 div 和手写样式重造一套控件。

### 硬性规则

1. 按钮、弹窗（含抽屉、对话框）、卡片、导航（含侧栏）、输入框、图标、动画、AI 聊天相关界面，必须用下面组件库里已经提供的组件。禁止自己搓这些控件。
2. 不要新建自定义 UI 组件文件去重造上述能力。禁止再写一套平行的 `Button`、`Dialog` / `Modal`、`Card`、`Input`、侧栏、图标或聊天气泡。业务页面可以组合这些库，把业务状态、数据请求和路由留在页面与 hooks 里。
3. 已经装进 `teaching-agent` 的依赖优先用，不要为了同一能力再引入另一套库。
4. 下表里尚未安装的库，不要擅自 `npm install`。只有同时满足这两条才可以装：当前页面确实没有这项能力，并且用户在当次任务里明确要求安装。没明确说「安装」，就继续用已有组件组合，或停下来问用户。

### 本项目已经有的（优先用这些）

依赖见 `teaching-agent/package.json`。shadcn 组件在 `teaching-agent/src/components/ui/`：

| 已有 | 路径或包 | 用来做 |
| --- | --- | --- |
| Button | `src/components/ui/button.tsx` | 按钮 |
| Card | `src/components/ui/card.tsx` | 卡片 |
| Sheet | `src/components/ui/sheet.tsx` | 抽屉、侧滑面板 |
| Sidebar | `src/components/ui/sidebar.tsx` | 侧栏导航 |
| Input | `src/components/ui/input.tsx` | 输入框 |
| Tooltip | `src/components/ui/tooltip.tsx` | 悬停提示 |
| Separator | `src/components/ui/separator.tsx` | 分隔 |
| Skeleton | `src/components/ui/skeleton.tsx` | 加载占位 |
| 图标 | `lucide-react` | 图标，不要手绘 SVG 图标集，也不要换别的图标库 |
| 动画 | `motion` | 已有动效需求先用它 |

还缺的 shadcn 基础件（例如 Dialog），从 [shadcn/ui](https://ui.shadcn.com) 官方组件补进 `src/components/ui`，不要在业务目录手写一份。补组件若要新增 npm 依赖，仍须用户当次明确要求后再装。

### 按界面需求选库

先查上表已有组件能不能覆盖。盖不住时，按下表选库里的现成组件来组合，仍然不要手写平行控件：

| 需求 | 用 |
| --- | --- |
| 基础 UI、弹窗、按钮、导航、输入 | 已安装的 shadcn；无样式、要完全自己定样式的交互用 Base UI |
| 图标 | Lucide（已安装 `lucide-react`） |
| 普通动效 | 已安装的 `motion` |
| 精致动画、卡片、过渡 | Magic UI |
| 极简动效、文字和布局动画 | Motion Primitives |
| 高级卡片、交互特效 | Aceternity UI |
| 动画文字、按钮、背景 | React Bits |
| AI 聊天、思考过程、工具调用展示 | AI Elements |
| 完整 AI 聊天交互 | assistant-ui |
| AI 聊天组件、输入框 | Prompt Kit |
| 模型工具调用产生的交互式结果卡片 | Tool UI |
| Agent 状态、任务、动态结果 | Agents Kit |

### 组件库清单

推荐度保持原表，不要自行改级。官网只写已核对过的地址。

| 组件库 | 主要用途 | 官网 | 推荐度 |
| --- | --- | --- | --- |
| shadcn/ui | 基础 UI、弹窗、按钮、导航 | https://ui.shadcn.com | ⭐⭐⭐⭐⭐ |
| AI Elements | AI 聊天、思考、工具调用 | https://elements.ai-sdk.dev | ⭐⭐⭐⭐⭐ |
| assistant-ui | 完整 AI 聊天交互 | https://www.assistant-ui.com | ⭐⭐⭐⭐⭐ |
| Prompt Kit | AI 聊天组件、输入框 | https://www.prompt-kit.com | ⭐⭐⭐⭐⭐ |
| Magic UI | 精致动画、卡片、过渡效果 | https://magicui.design | ⭐⭐⭐⭐⭐ |
| Motion Primitives | 极简动效、文字和布局动画 | https://motion-primitives.com | ⭐⭐⭐⭐⭐ |
| Aceternity UI | 高级卡片、交互特效 | https://ui.aceternity.com | ⭐⭐⭐⭐ |
| React Bits | 动画文字、按钮、背景 | https://reactbits.dev | ⭐⭐⭐⭐ |
| Tool UI | AI 生成的交互式结果卡片 | https://www.assistant-ui.com/docs/tools/tool-ui | ⭐⭐⭐⭐⭐ |
| Agents Kit | Agent 状态、任务、动态结果 | https://agents-ui.github.io/agents-kit/ | ⭐⭐⭐⭐ |
| Base UI | 无样式、可定制交互组件 | https://base-ui.com | ⭐⭐⭐⭐⭐ |
| Lucide | 极简风格图标 | https://lucide.dev | ⭐⭐⭐⭐⭐ |

未安装：AI Elements、assistant-ui、Prompt Kit、Magic UI、Motion Primitives、Aceternity UI、React Bits、Tool UI、Agents Kit、Base UI。已安装：shadcn（上表所列组件）、`lucide-react`、`motion`。
