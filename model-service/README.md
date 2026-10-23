# CatBoost 梁配筋教学推理服务

四个固定正式 CBM 的 CPU 推理部署包。原训练目录没有修改，运行时只读取本包 `models/`；不读取训练数据、不训练模型、不访问云端模型。

## 本地运行

使用独立 Python 3.11 环境，在本目录执行：

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn beam_service.app:app --host 127.0.0.1 --port 8001
```

FastAPI 在单个 worker 的 lifespan 中加载且校验四个权重一次；每次请求复用。启动校验失败时拒绝提供服务。默认只供同机网站后端访问，浏览器通过网站自己的 `/api/beam/*` 代理；本服务未开放跨域。

本机核验可复用既有 CatBoost 环境和工作区新增依赖，无需改原环境：

```powershell
$env:PYTHONPATH = 'F:\Codex\2026-10-22\https-github-com-ecdison6227-ch6-teaching\work\python-service-deps'
& 'G:\minconda\envs\rcbeam311\python.exe' -m unittest discover -s tests -v
```

## HTTP 契约

`GET /health` 返回加载数量和版本；`GET /v1/manifest` 返回固定发布清单。模型文件总计 3,296,008 字节；清单包含 SHA256、元数据 SHA256、特征顺序、类别顺序、候选及运行编号。模型原始权重 SHA256 同时固定在加载器中，防止误换清单版本。

`POST /v1/design`：给定弯矩求配筋，调用分类 A，规则允许时调用面积回归。

```json
{"b_mm":250,"h_mm":500,"concrete":"C30","steel":"HRB400","M_design_kNm":175}
```

可选字段：`h0_mm`（数字或 null；省略则预估）、`environment_class`（默认 I）、`design_life_years`（50）、`stirrup_d_mm`（8）、`assumed_longitudinal_d_mm`（20）。预估采用原保护层、箍筋、单排纵筋算法，沿用原面积 Predict 入口 `allow_unlisted_diameters=True`，允许其他正有限直径，偏离50年、箍筋8/10 mm、纵筋20 mm采样假设时提示。填写 h0 时跳过环境、年限、直径等预估几何条件计算及相关组合检查；推荐直接省略这些无关字段。h0 未验证钢筋实际排布。

`POST /v1/review`：实配复核，调用分类 B，规则允许时调用 Mu 回归。

```json
{"b_mm":200,"h_mm":450,"h0_mm":414,"concrete":"C30","steel":"HRB400","As_provided_mm2":603,"M_design_kNm":82}
```

`M_design_kNm` 可省略或为 null，只有比较需求时使用；不影响 Mu 特征或预测。

尺寸 mm、面积 mm²、强度 MPa、弯矩 kN·m。仅接受 JSON 数字，布尔、数值字符串、非有限值、额外字段与非法截面等返回中文 HTTP 422。梁高为 200～800 每 50 mm 一档或 900；梁高≤300 的梁宽为 150/200，其余按 h/3～h/2、50 mm 步长规则。材料固定 C30/C35/C40 与 HRB400/HRB500。

结果包含 `task, status, inputs, geometry, classification, prediction, reference, comparison, warnings, model_versions, scope`。`classification.class_name` 是少筋/适筋/超筋简称，`classification.label` 是 A 或 B 的真实语义；`probabilities` 明确按少筋、适筋、超筋排列，为未经独立校准的模型原始概率。

设计的确定性状态为 `ok` / `needs_redesign`，最小配筋控制通过 `reference.control=minimum_reinforcement` 体现。复核状态为 `ok` / `below_minimum_reinforcement` / `beyond_single_reinforced_method`。回归只在确定性规则 `ok` 时执行，其余 `prediction`、`comparison` 为 null，分类仍展示。分类器的输出不会决定是否允许回归。

面积原公式给出 `ok` 后，服务还将该所需面积送原复核规则做一致性检查；包括极小 h0 导致最小配筋面积超出单筋上限的情形，服务顶层返回 `needs_redesign` 并暂停回归。`reference` 原公式字段保留，新增 `consistency_check` 展示这项范围冲突。

`reference` 完整保留复制的原公式函数各字段。`comparison.model_minus_reference` 与 `relative_error_percent` 为有符号差值；复核带 M 时另有 `model_meets, reference_meets, decision_disagrees`。原始回归值仅由对应特征模块进行一次尺度逆变换，不夹紧、不用公式替换预测。训练特征单项范围超出时有警告；范围内并不保证组合已被验证。

## 正式模型与来源

| key | 用途 | run_id | 候选 |
| --- | --- | --- | --- |
| area | 配筋面积回归 | 18600dc9d0f740c5990c6a893bf575ab | normalized_fine11 |
| review | 抗弯承载力回归 | 8406fbae9e6e421197f3d819fbc9c5b6 | normalized_quantized7 |
| classify_a | 给定 M 的设计状态 | 211e8ce946034986af9d9b929aedf201 | physical10 |
| classify_b | 给定 As 的实配状态 | 16a8dc0e821d49a7a333e70dafa7a853 | physical_balanced10 |

分类目录名称中的 run 短码与模型内部 run_id 不相同，本包固定使用实际 `model_info.json` 与 CBM 元数据一致的上述 run_id，不依据目录名推断。`beam_service/vendor/{area,review,classify_a,classify_b}/` 为原纯推理模块副本，唯一必要调整是包内相对导入；A/B 配置各自隔离。没有复制训练程序及历史候选。

## 验证

```powershell
python -m unittest discover -s tests -v
```

测试实际加载四个权重，覆盖 golden（As=1215.3500269576261 mm²、Mu=82.25017067719503 kN·m）、A/B 三类及语义差异、单筋边界、最小配筋、零弯矩、分类不门控回归、训练范围提示、模型判断与公式判断分歧、非法 JSON/类型/非有限及极端输入、损坏权重/元数据/清单、特征与类别顺序。

适用范围为原脚本限定的普通非抗震、非预应力矩形单筋截面；结果用于教学，尚不包含选筋布置、抗剪、裂缝、挠度等完整梁设计。公开部署前由维护者配置服务网络访问控制与进程管理。
