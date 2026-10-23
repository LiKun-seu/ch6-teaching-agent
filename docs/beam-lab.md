# 智能配筋实验：本地运行与后续部署

本功能在原教学网站中增加“智能配筋实验”导航和 `/beam-lab` 页面。两个入口组合调用四个正式 CatBoost 模型，模型在 Python 服务启动时加载一次，网站只向该服务发送截面参数。

## 当前电脑运行

本地依赖和生产构建已准备。打开仓库根目录的 PowerShell：

```powershell
.\scripts\beam-preview.ps1 -Action Start
.\scripts\beam-preview.ps1 -Action Status
```

浏览器访问 `http://127.0.0.1:3000/beam-lab`。停止时执行：

```powershell
.\scripts\beam-preview.ps1 -Action Stop
```

启动器只监听本机，使用独立的 `model-service/.venv`。日志与本次启动的进程记录位于 `.beam-local/`；停止时核对进程启动时间，避免结束不属于本次预览的进程。端口可以通过 `-Port`、`-ModelPort` 调整。

## 两个示例

| 入口 | 默认输入 | 实际预测 | 公式参考 |
|---|---|---|---|
| 给定弯矩求配筋 | b=250、h=500、C30、HRB400、M=175；I类、50年、箍筋8、预估纵筋20，得到h0=462 | 1215.3500 mm² | 1212.3763 mm² |
| 实配钢筋复核 | b=200、h=450、h0=414、C30、HRB400、As=603、M=80 | 82.2502 kN·m | 81.6327 kN·m |

A 的分类描述弯矩需求对应的设计状态；B 的分类描述实配面积区间。B 处于适筋区间时，仍需分别比较模型 Mu、公式 Mu 与 M。复核弯矩留空时只给承载力。

预测、公式参考和状态检查分别显示。最小配筋或单筋上限不满足当前方法时，回归结果为空，页面显示原因。修改输入后旧结果清除，结果 JSON 包含四个模型版本。

## 在其它电脑安装

需要 Node.js 24 和 Python 3.11。服务可使用全新的虚拟环境；当前电脑的环境复用了原训练环境的只读包，新增接口依赖装在独立虚拟环境中。

```powershell
cd model-service
python -m venv .venv
.\.venv\Scripts\python.exe -X utf8 -m pip install -r requirements.txt
cd ..\teaching-agent
npm ci
npm run build
cd ..
.\scripts\beam-preview.ps1 -Action Start
```

也可分别运行：

```powershell
# 一个终端，model-service 目录
.\.venv\Scripts\python.exe -X utf8 -m uvicorn beam_service.app:app --host 127.0.0.1 --port 8001
# 另一个终端，teaching-agent 目录
npm run start -- --hostname 127.0.0.1 --port 3000
```

网站服务端环境变量 `BEAM_SERVICE_URL` 默认为 `http://127.0.0.1:8001`。模型文件位于 `model-service/models`，原始训练目录不参与部署或运行。模型与说明文件的 SHA、特征顺序、类别顺序及内嵌版本信息在启动时核对。

## AI 讲解

“请 AI 讲解本次结果”已接入原网站的 AI 面板，发送本次参数、规则状态、模型输出及公式参考。四个 CatBoost 模型的预测不依赖大模型凭证。本机已在不进 Git 的 `.env.local` 中接通学校 DeepSeek 通道，准确模型 ID 为 `DeepSeek-V4-Flash`（以学校 `/v1/models` 实际返回为准，大小写须一致）。已用网站的 Node 运行环境验证流式回复，并通过一次真实浏览器文字对话确认页面显示正常。学校接口仍需校园网或 VPN 可达。

配置方式沿用 `teaching-agent/.env.example` 中已有通道，将真实值写入不进 Git 的 `.env.local`，重启网站服务。服务端模型配置变更后重启网站即可，无需重新构建网站或重新训练 CatBoost。学校网络不可达时先检查校园网/VPN；终端工具采用系统代理时也可能收到访问限制，应以网站实际 Node 运行环境的连通性为准。教学讲解质量与图片输入需分别验证。

## 已执行的验证

- Python：18 项模型与接口测试，包括两个回归 golden、A/B 三类别、规则边界、非法数值和模型完整性。
- 网站：58 项回归测试全部通过，其中新增 6 项代理契约、故障与取消测试。
- TypeScript 类型检查、Next.js 生产构建、数学渲染及148页课件质检通过。
- Windows Chromium/Edge 独立浏览器：14 项端到端场景通过，含390px布局、真实预测、JSON导出、空弯矩、边界、AI缺配置提示与错误重试。
- 预览脚本的启动、停止、重启和健康检查。

运行命令：

```powershell
cd model-service
.\.venv\Scripts\python.exe -X utf8 -B -m unittest discover -s tests -v
cd ..\teaching-agent
npm test
npm run typecheck
npm run test:math
node scripts/qa-slide-notes.mjs
npm run build
# 预览启动后，Windows本机已安装Edge时：
node scripts/beam-browser-check.mjs
```

本地浏览器验收记录与截图在成品外层的 `approval/`。Android、macOS 的正式 CI 尚未执行，不能将本地验证当作三平台检查全部通过。

## 公开部署前

当前是本地审批版，尚未推送或发布。审批后再确定服务器、域名、AI通道及代码和课件的授权范围。生产环境建议网站和 Python 服务部署在同一主机，Python 保持回环监听，网站通过服务端变量连接。Python 依赖需在目标系统重新安装，虚拟环境不可从 Windows 直接复制到 Linux。

若继续使用原仓库的 `/teachdemo` 前缀，需要在构建前设置 `NEXT_PUBLIC_BASE_PATH=/teachdemo` 并保持运行配置一致，按照原仓库规则在合并前完成 Android、macOS、Windows 三个 CI 检查。

原 `scripts/package-deploy.mjs` 面向原网站发布包，不包含新 Python 服务。发布新功能时需同时部署 `model-service`、四个权重与其运行环境；不要仅执行旧网站发布脚本。
