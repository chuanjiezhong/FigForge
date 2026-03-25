# 文章模版目录说明

| 文件 | 说明 |
|------|------|
| `1.docx` / `2.docx` / `3.docx` | 示例论文 Word 模版（含排版与图表）。**`3.docx`** 为完整多组学论文示例，含 **limma、pheatmap 热图、WGCNA** 等方法描述与图注。 |
| **`3-论文模版逻辑说明.md`** | 说明 **`3.docx` 的篇章逻辑**及**热图在文中的叙述角度**（中文）。 |
| **`pipeline-interpretation-snippet-zh.md`** | 供写入 **`_pipeline/interpretation_zh.md`** 或 R 包解读模版的**中文片段**（方法 + 结果 + 热图解释）。 |
| **`pipeline-interpretation-snippet-en.md`** | 同上，**英文**片段。 |

将片段并入 **OmicsFlowCoreFullVersion** 的 `write_pipeline_interpretation_reports()` / `pipeline_interpretation_report.R` 后，Pipeline 运行结束即可在输出目录 `_pipeline/` 生成带热图说明的中英解读稿；FigForge 右侧「结果解读」会预览对应 Markdown。
