# 第六章 · 引导式学习 Agent

《土木工程结构工程设计原理》第六章「钢筋混凝土梁承载力计算原理」的辅导应用：
**引导对话**（老师一步步带你推，不直接给答案）+ **自学天地**（148 页 PPT + AI 总结要点 + 扩展练习）。

## 跑起来

```bash
cd teaching-agent
cp .env.example .env.local     # 填入模型配置
npm install
npm run dev                    # http://localhost:3000
```

## 本地验证

```bash
npm run typecheck
npm test
npm run test:math
node scripts/qa-slide-notes.mjs
npm run build
```

`npm test` 不需要真实模型凭证，包含本地 HTTP 模拟模型、流式分块、连接取消、判题、笔记保存失败与重试的回归检查。真实模型的教学输出仍需配置通道后手工验证。

笔记优先使用 IndexedDB 保存，兼容读取旧版 localStorage 数据；首次保存成功后迁移旧副本。保存失败会在侧栏提示，当前页面里的笔记仍然保留，可点「重试保存」。纯图片收藏可以直接导出；未接入模型时，文字笔记按原文导出。

对话支持停止生成和失败重试，总等待时限为 120 秒。单张上传图片上限为 3 MB，支持 PNG、JPEG、WebP、GIF。未复核题或无法可靠匹配的描述性答案显示「待核对」。

## 两个页面

| 页面 | 作用 |
|---|---|
| `/` 引导对话 | 发题目/文字/图片，老师用苏格拉底式提问带你一步步推到答案 |
| `/study` 自学天地 | 章节导航 → PPT 页 → 本页要点（AI 总结、重点黄色高亮）→ 扩展练习 |

## 引导机制

输出的不是自由文本，而是一套协议：

```
[判定] 对·K5·一句话理由        ← 学生作答后的第一行（判定行，不展示给学生）
……1~2 句点评或引导语（仍不给最终答案）……
```card
{"kind":"choice","prompt":"…","options":[…],"topic":"K5","figure":{"kind":"slide","page":42}}
```                            ← 卡片（可选）
```diagram
<div>…HTML 流程图…</div>       ← 正文里的流程图（iframe 沙箱渲染）
```
```slide
42                            ← 正文里直接把第 42 页 PPT 发给学生
```
```

- **卡片类型**：`choice` 选择题 / `truefalse` 判断题 / `data` 数据补充卡（缺条件时逐项列出）/ `calc` 计算卡
- **卡片附图 `figure`**：`{"kind":"slide","page":N}` 挂一张 PPT 页，`{"kind":"diagram","html":"…"}` 挂一张流程图，学生可点开看大图
- **节奏约束**：讲概念/听讲解时**不出卡片**；求解类最多拆 3 步，同一知识点最多连问 2 张卡片就给阶段性小结；每轮只允许一张卡片（或一张图）
- **语气**：温和的助教口吻，先肯定思路再指出断点，不说"你错了"
- 卡片未作答时输入框禁用；答对推进、答错讲解后重问；掌握度按 K1~K14 记入左侧栏

> 实现要点：卡片内容会回写进对话历史（`[我上一轮给出的卡片]`），否则模型看不到自己上一轮问了什么，就无法判定学生的作答。

## 渲染

`src/components/Markdown.tsx` 统一处理所有文本：**Markdown + KaTeX**（`remark-math` + `rehype-katex`），不会再出现 `**` 星号或 `$...$` 源码；流式输出时公式未闭合会自动补齐定界符。

## 右上角「问 AI」

全局浮动按钮（`src/components/AiDrawer.tsx`）：点击后**从右侧滑出抽屉**，页面不跳转。任何组件都能带上下文唤起：

```tsx
const { ask } = useAiDrawer();
ask({ question: "这道题我还是不懂…", context: { page: 42, section: "K5 单筋矩形截面计算" } });
```

## 自学天地

- **本页要点**：AI 逐页总结（`src/content/slide-notes.json`，148 页全覆盖），通顺中文 + LaTeX 公式，`keys` 里的重点术语**黄色高亮**（渲染时跳过公式区间，不破坏 LaTeX）
- **乱码治理**：PPT 原文是从 .doc 抽的 OCR 碎片（"干货专用章""荔生煎"这种），展示前统一清洗过滤
- **扩展练习**：学生先自己作答 → 提交判定对错 → 答错（或主动点）才能查看答案与解析 → 还是不懂才点「问 AI」，右侧抽屉带着题目上下文打开
- **K12~K14**：受扭 / 挠度 / 裂缝三节没有 PPT 页，内容来自 `src/content/k12-14.md`（清华公开课件 + GB 50010 条文交叉核对），自测题在 `k12-14-questions.json`

## 目录

```
src/app/page.tsx              引导对话页
src/app/study/page.tsx        自学天地
src/app/api/chat/route.ts     SSE 流式对话 + 围栏块解析（verdict/card/diagram/slide）
src/app/api/ocr/route.ts      图片 OCR
src/lib/useChat.ts            对话状态机（首页与 AI 抽屉共用）
src/lib/models/provider.ts    模型通道抽象（school / stepfun）
src/lib/cards.ts              卡片协议（zod）+ figure 附图
src/lib/prompt.ts             苏格拉底式教学提示词
src/components/
  ChatView.tsx                消息区 + 输入区（首页与抽屉共用）
  AiDrawer.tsx                右上角问 AI 抽屉
  Markdown.tsx                Markdown + KaTeX 渲染
  FigureModal.tsx             流程图（iframe 沙箱）/ PPT 图弹窗
  AnswerCard.tsx  Composer.tsx  Sidebar.tsx  Typing.tsx
src/content/                  知识库 / 148 页幻灯片 / 135 道题库 / PPT 笔记 / K12~K14 资料
scripts/                      内容抽取、答案推导、PPT 笔记生成、质检、端到端校验
public/slides/                148 张 PPT 页面图
```

## 题库答案

题目原文未附答案，答案由模型基于知识库推导 + 独立复核 + 冲突仲裁生成：

| 指标 | 数量 |
|---|---|
| 总题数 | 135（+ K12~K14 补充 15 题） |
| 有答案 | 134 |
| 两轮一致（已复核） | 100 |
| 待复核（答案表标 `*`） | 34 |
| 仍无答案 | 1（SC-57，题干数据不足） |

## 数据与质量

- `slide-notes.json`：148 页要点由视觉模型逐页生成，已通过全量质检 —— **公式 KaTeX strict 模式零错误、定界符全部配对、无 OCR 乱码与残缺条目**
- `scripts/e2e-check.mjs`：4 个场景的端到端协议校验（缺条件卡 / 流程图 / 判定闭环 / PPT 图推送）

## 待办

- [ ] 34 道待复核答案的人工抽查（集中在 SC-43~62 与填空题）
- [ ] 题库中公式缺失题的逐题核对（原 .doc 公式为嵌入对象）
- [ ] 学校内网模型（Deepseek V4 Flash / 千问）实机联调
- [ ] 掌握度阈值（答对 ≥2 次且正确率 ≥60%）用真实学习数据校准
