# R 包对接：解读稿热图段落

## canonical 实现位置（已并入 R 包）

**OmicsFlowCoreFullVersion** 的 `R/pipeline_interpretation_report.R` 已内置：

- `artifact_rel_to_out()` — 产物路径相对 `out_dir`
- `interpretation_deg_narrative_helpers()` — 由 `deg_heatmap` 参数生成叙述用中英文短句
- `pipeline_interpretation_heatmap_section_zh()` / `_en()` — 论文式 limma + 热图段落（支持 `heading_prefix`，默认 `"###"` 嵌在 §3 下）
- `write_pipeline_interpretation_reports()` 在 **§3 结果概述** 末尾自动拼入上述中英叙述

跑完转录组 pipeline 后，`_pipeline/interpretation_zh.md` / `interpretation_en.md` 即含 **Methods/Results 热图叙述模版**。

---

## 本目录 `pipeline_interpretation_heatmap_snippets.R`（可选）

与包内函数**语义对齐**的独立副本，便于在 FigForge 仓库内对照或同步文案；**以 R 包内实现为准**。

修改模版措辞时：

1. 优先改 **OmicsFlowCoreFullVersion** `pipeline_interpretation_report.R` 中对应函数；或  
2. 同时更新 `docs/文章模版/pipeline-interpretation-snippet-zh.md` / `en.md`。
