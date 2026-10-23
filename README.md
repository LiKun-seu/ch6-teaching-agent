# 第 6 章 · 钢筋混凝土梁承载力 — 智能教学系统

面向《混凝土结构设计原理》第六章「钢筋混凝土梁承载力计算原理」的教学应用：**引导式 AI 对话 + 148 页课件自学 + 题库自测 + 课堂实时答题 + 智能配筋实验**。

前端为 Next.js 15 / React 19，配筋实验由独立的 Python 服务提供四个 CatBoost 模型推理。

> 模型输出是统计预测，不是设计结果。不做选筋、不校核实际排布、不能替代规范计算，不得直接用于工程。

## 功能

| 模块 | 说明 |
|---|---|
| 引导对话 `/` | 苏格拉底式提问，不直接给答案；输出为协议化结构（判定行、选择题/判断题/计算卡、流程图、指定 PPT 页），掌握度按 K1–K14 记录 |
| 自学天地 | 148 页课件逐页 AI 要点、重点高亮、公式渲染，配扩展练习 |
| 自测与错题本 `/self-test` | 135 题 + K12–K14 补充题，判题、错题归档、笔记（IndexedDB） |
| 课堂互动 `/classroom` | 教师开课发题，学生凭课程码加入 `/join`，实时提交与判分，SQLite 存储 |
| 智能配筋实验 `/beam-lab` | 四个模型：给定弯矩求配筋面积、实配钢筋抗弯复核、A/B 两种配筋状态分类 |
| AI 讲解 | 右侧抽屉，携带当前题目与页面上下文调用模型 |

## 目录结构

```
teaching-agent/            Next.js 教学应用
  src/app/                 页面与 API 路由（chat SSE、beam 代理、classroom、materials）
  src/components/          对话、课件、自测、课堂、配筋实验等界面
  src/lib/                 状态机、协议解析、判题、课堂存储（SQLite）
  src/content/             知识库、题库、148 页课件要点、K12–K14 资料
  public/slides/           148 张课件页图
model-service/             FastAPI 推理服务
  beam_service/            接口、模型注册、训练代码快照（vendor）
  models/                  四个 .cbm 权重与 model_info
docs/beam-lab.md           配筋实验的运行、部署与验证说明
scripts/beam-preview.ps1   本地一键启动/停止/健康检查
.github/                   CI 工作流与仓库规则
```

## 本地运行

需要 **Node.js 24** 与 **Python 3.11**。

```bash
cd model-service
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt

cd ../teaching-agent
cp .env.example .env.local     # 填入模型通道配置
npm ci
npm run build
```

在仓库根目录启动（Windows）：

```powershell
.\scripts\beam-preview.ps1 -Action Start
```

浏览器打开 `http://127.0.0.1:3000/beam-lab`，`-Action Status` 查看健康状态，`-Action Stop` 停止。

也可以分开启动：

```bash
# 终端 1
cd model-service && .venv/bin/python -m uvicorn beam_service.app:app --host 127.0.0.1 --port 8001
# 终端 2
cd teaching-agent && npm run start -- --hostname 127.0.0.1 --port 3000
```

## 环境变量

复制 `teaching-agent/.env.example` 为 `.env.local` 后填写。**`.env.local` 已在 `.gitignore` 中，不会进入仓库。**

| 变量 | 用途 |
|---|---|
| `MODEL_PROVIDER` | 对话模型通道（`school` / `stepfun` 等） |
| `SCHOOL_CHAT_BASE_URL` / `SCHOOL_CHAT_API_KEY` / `SCHOOL_CHAT_MODEL` | 学校模型通道（需校园网或 VPN） |
| `BEAM_SERVICE_URL` | Python 服务地址，默认 `http://127.0.0.1:8001` |
| `CLASSROOM_TEACHER_ACCESS_CODE` | 教师开课口令 |
| `CLASSROOM_DB_PATH` | 课堂数据 SQLite 路径 |

四个 CatBoost 模型的预测**不依赖**大模型凭证；没配通道时配筋实验照常可用，只有 AI 讲解不可用。

## 四个模型

由 `model-service/models/manifest.json` 固定 SHA、特征顺序与类别顺序，服务启动时逐项校验。

| 模型 | 任务 | 测试集表现 |
|---|---|---|
| `area` | 给定梁条件与设计弯矩，预测所需受拉钢筋面积 As（mm²） | MAE 3.21 mm²，R² 0.99999（n=21,000） |
| `review` | 给定截面、材料与实配钢筋，预测抗弯承载力 Mu（kN·m） | MAE 1.018 kN·m，R² 0.99999（n=36,864） |
| `classify_a` | 设计状态三分类（不输入实配面积） | 准确率 99.87%，macro-F1 0.998（n=23,100） |
| `classify_b` | 实配状态三分类（输入实配面积，不输入弯矩） | 准确率 100%，macro-F1 1.000（n=37,458） |

A/B 的 100% 需谨慎解读：类别由确定性规则生成，特征与规则同源，属"规则可学性"验证，不代表对真实工程的判别能力。

`h0` 由环境类别、使用年限、保护层、箍筋直径与假定的单排纵筋直径推算，属"预估位置"。

## 测试

```bash
cd model-service && .venv/Scripts/python.exe -m unittest discover -s tests -v
cd teaching-agent && npm test && npm run typecheck && npm run build
```

浏览器验收：`node scripts/beam-browser-check.mjs`（需本机安装 Edge）。

## 数据说明

本仓库**不包含**训练数据集与原始课件（PDF/PPT/DOC）：单个数据集 73–109 MB，扫描件涉及版权。模型权重 `.cbm` 已包含，可直接推理；重新训练需另行准备数据。

## CI

`.github/workflows/ci.yml` 在 push / PR 到 `main` 时运行 macOS、Windows、Android 三项检查，其中 Android 依赖自托管模拟器，需按自身环境调整后再启用。

## 声明

本项目在 [ECdison6227/ch6-teaching-agent](https://github.com/ECdison6227/ch6-teaching-agent) 的原始教学网站基础上，增加了 Python 模型服务与智能配筋实验页面。

仅用于教学与研究。任何实际工程配筋必须由注册结构工程师按现行规范完成。
