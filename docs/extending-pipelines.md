# 扩展新流程（预留口子）

后续增加 **OmicsFlow** 或其它组学流程时，按下面清单接入即可；不必改 FigForge 核心架构——**R 包暴露定义 + 文档注册**为主。

---

## 1. R 包（OmicsFlowCoreFullVersion）

| 步骤 | 说明 |
|------|------|
| **实现流程函数** | 在 `R/` 下新增 `xxx_pipeline_yyy.R`（或按模块拆分），末尾写 `artifacts.json` / `_pipeline/status/` 与现有转录组流程一致更佳。 |
| **导出** | `NAMESPACE` 中 `export()` 新函数；`DESCRIPTION` 若用 Collate 需包含新文件。 |
| **流程图定义** | 在 `transcriptome_pipeline_defs.R`（或后续抽成 `pipeline_registry.R`）的 `transcriptome_pipeline_defs()` 返回的 `list()` 里 **追加一个新 key**，例如 `my_new_pipeline = list(pipeline_name = ..., steps = list(...))`。FigForge 通过 IPC 调用 `transcriptome_pipeline_defs()`，**下拉框与节点图会自动出现新流程**（只要 key 与函数名一致）。 |
| **步骤结构** | 每个 `step` 建议保留：`step_id`、`name`、`config_key`、`fn`、`overridable_params`、`outputs_keys`（与 `write_step_status` / `artifacts` 对齐）。 |
| **解读稿（可选）** | 若需与转录组一样生成中英解读，在流程结束处调用 `write_pipeline_interpretation_reports()`，或仿照 `pipeline_interpretation_report.R` 为新领域写专用模板。 |
| **解读稿模版片段（FigForge 仓库）** | `docs/文章模版/pipeline-interpretation-snippet-zh.md` / `pipeline-interpretation-snippet-en.md`：从示例论文 `3.docx` 抽象出的 **limma + 热图（pheatmap）** 中英写法；逻辑说明见 **`3-论文模版逻辑说明.md`**。 **可复制的 R 实现**：仓库根目录 **`r-integration/pipeline_interpretation_heatmap_snippets.R`**（含 `pipeline_interpretation_heatmap_section_zh()` / `_en()`），对接说明见 **`r-integration/README.md`**。 |

> **约定**：新 pipeline 的 **入口函数名** 必须与 `transcriptome_pipeline_defs()` 里的 **list 名称**一致，以便 FigForge `generateRFunctionScript(pipelineName, ...)` 能直接调用。

---

## 2. FigForge 前端 / 文档

| 步骤 | 说明 |
|------|------|
| **function-docs.json** | 在 `OmicsFlowCoreFullVersion` 包条目下为新函数增加一条：`name`、`description`、`detailedParameters`（与 `SharedParameterForm` 字段类型一致），否则右侧「全局参数」可能为空。 |
| **Pipeline 页** | `renderer/.../PipelineView/index.tsx` 中 **datasets**、兜底 `pipelineParams` 等仅针对 `transcriptome_pipeline_multi*` 做了特殊 UI；**纯全局参数的新流程一般无需改 TS**，除非需要类似 `DatasetsBuilder` 的专用表单——届时为 `pipelineName === 'your_pipeline'` 加分支即可。 |
| **IPC** | 已存在 `get-pipeline-defs` → `transcriptome_pipeline_defs()`，**一般不用改主进程**。 |

---

## 3. 可选：外部脚本型 Pipeline

若流程是 **独立目录 + main.R**（非单函数入口），可走现有 `PipelineManager` + `run-r-pipeline` 路径；与当前「单函数 OmicsFlow」并行存在即可。详见 `main/r-engine/pipeline-config.ts`、`pipeline-manager.ts`。

---

## 4. 自检清单

- [ ] R：`devtools::document()` / `R CMD check` 无报错  
- [ ] `transcriptome_pipeline_defs()` 含新 pipeline，且 `getPipelineDefs` 在 App 里能拉到  
- [ ] `function-docs.json` 已加条目（至少 `description` + 主要参数）  
- [ ] 跑一次 `generateRFunctionScript` + 实际执行，确认 `out_dir/_pipeline/` 结构符合预期  

---

*文档版本：与 README「Pipeline 与单函数」一节配合阅读。*
