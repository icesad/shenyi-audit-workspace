# 审计底稿多模型测试工具

米老师和李老师可以用同一份模拟案例比较不同模型的底稿文本，再在 WPS 里核对各模型的草稿。账账、期初、汇总金额和模板写入由程序控制。模型填写授权的文字栏，项目组复核事实、证据和结论后才能正式归档。

## 快速开始

安装 Python 3.10 或更新版本，在此目录的终端执行。Windows 可用 `py` 替换 `python3`。

```sh
python3 -m pip install -r requirements.txt
python3 lab.py
python3 configure.py
```

第一条运行命令用固定模拟结果，不需要 API Key。第二条可以依次选 OpenAI、Claude、Gemini 或 OpenAI 兼容接口。输入各自的模型 ID 和 Key，接口处直接回车开始对比。兼容接口可接各服务商提供的 Chat Completions 地址，也可用本地兼容服务。Key 在终端输入时隐藏，仅保留在当前进程。API 请求由各自账户计量，默认只发送自造案例及通用规则。

各次结果放在 `outputs/北京时间日期-序号/`。每个模型有一份 WPS 可编辑工作簿和一份验证 JSON，另有独立的「审计待核与模型对比」Excel。对比指标包括通过表数、覆盖字段、索引及证据错误、耗时和写入位置。文字是否符合证据、CPA 复核要求和行业实际仍需逐项看稿。相同提示词有相同指纹，便于复测。

## 文件和处理范围

| 位置 | 内容 |
| --- | --- |
| [standards.md](standards.md) | B类单体、阶段1—4及共用表，从收件到归档的要求、两份编排指引和科目取数方法。所有模型使用同一份标准。 |
| [checks.py](checks.py) | 四项账账、上年TB调整衔接、逐凭证平衡、摘要筛查、对方科目、银行一对多、分户FIFO和工时预算。 |
| [lab.py](lab.py) | 核对门槛、程序索引及勾选、测试说明覆盖、证据范围验证、经授权空白格填报及模型对比。 |
| [demo.py](demo.py) | 自造资料和自造模板。覆盖承接、风险、收入测试、试算及排除项目。 |
| [providers.py](providers.py) | [OpenAI](https://developers.openai.com/api/reference/resources/chat)、[Anthropic](https://platform.claude.com/docs/en/api/messages)、[Gemini](https://ai.google.dev/gemini-api/docs/text-generation)及兼容接口。 |

当前自动化覆盖标准化资料到草稿和待核的流程。历史原件的列映射、逐册合并及总目录链接检查、真实签署、科目全套专业判断、正式报告和印刷导出依据标准文件由项目组操作。模拟模板带本册说明、工作表目录和明细表。自有模板以客户实际文件及允许填写的格子为准。

## 项目本地接入

```sh
mkdir -p private
python3 demo.py > private/case.json
python3 lab.py --case private/case.json --template private/template.xlsx
```

按导出的 JSON 样式映射真实项目原件。`balances` 放选定汇总层级，`book_controls` 放各明细账四项原数，`prior` 登记审定期末及已入账、未入账、列报差或待核调整。金额用两位小数以内的字符串，余额借正贷负，红字保留在原借贷栏。借贷及期初核对失败后只输出差额和待核。凭证、合计行、比较期间及多币种先在取数层核清。

给拟编制的每张表登记 `index`、`sheet`、`checkmark`、`refs`、`cells`。`refs` 与 `facts` 的来源编号对应。`cells` 只记录原模板可填的空白格，例如 `{"承接理由":"B6"}`。`calculated_cells` 为已核实的金额及目标格，模型看不到此输入栏。原冻结、保护、目录和公式需逐册检查。透视表、控件等编辑器无法安全重写的模板可直接使用校验后的草稿 JSON 按原模板填列。

指定 `needs` 内容及负责方 `owner` 为 `firm` 或 `client`，对应输出事务所或客户待确认行。`test: true` 检查测试目的、步骤、结果、结论与四条说明。对于模拟案例也可使用 `--models` 提供配置，参考 [models.example.json](models.example.json)。各 Key 由所选接口默认环境变量或 `key_env` 读取。真实案例如需使用外部模型，应先确认客户授权和外发字段，再显式增加 `--allow-api-case`。

## 复核与验收

```sh
python3 -m unittest -v
```

仓库内容使用程序、通用方法和自造资料。实际客户原件、对外报告、签名、内部项目配置和 API Key 存放于本地。提交前查看 Git 变更，逐次核对范围。新增科目时优先补模板映射和确定性检查，把证据链和测试步骤写入标准，并给出可复现的模拟样本。
