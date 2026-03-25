# =============================================================================
# FigForge — 解读稿「热图 / limma」中英片段（与 docs/文章模版/pipeline-interpretation-snippet-*.md 对齐）
# =============================================================================
# 用法：复制到 OmicsFlowCoreFullVersion 的 R/ 目录，在 write_pipeline_interpretation_reports()
#       生成 interpretation_zh.md / interpretation_en.md 时拼入返回的字符串。
# 依赖：仅 base R
# =============================================================================

#' 构建「Methods + Results」热图相关段落（中文）
#'
#' @param contrast 长度 2 的字符向量，c(参照组, 比较组)。
#' @param limma_rule 差异判定说明（可含百分号等特殊字符）。
#' @param row_scaling 行标准化说明。
#' @param cluster_note 聚类说明一句。
#' @param n_deg_text 差异基因数量或描述。
#' @param heatmap_rel_path 相对 out_dir 的热图路径。
#' @param volcano_rel_path 火山图路径；NA 或空则省略可选段。
#' @param up_color_note 上调在热图中的颜色/方向描述。
#' @param down_color_note 下调描述。
#'
#' @return Markdown 字符串。
pipeline_interpretation_heatmap_section_zh <- function(
    contrast = c("对照组", "实验组"),
    limma_rule = "|log2FC| > 1 且 FDR < 0.05",
    row_scaling = "按行 z-score 标准化",
    cluster_note = "样本与基因顺序按本次分析设定排列（若启用层次聚类，则用于展示表达模式相似性）。",
    n_deg_text = "若干",
    heatmap_rel_path = "heatmap.png",
    volcano_rel_path = NA_character_,
    up_color_note = "高表达/暖色",
    down_color_note = "低表达/冷色"
) {
  if (length(contrast) < 2L) contrast <- c("组1", "组2")
  ga <- contrast[[1]]
  gb <- contrast[[2]]
  vol <- volcano_rel_path
  vol_line <- if (is.na(vol) || !nzchar(as.character(vol))) {
    ""
  } else {
    paste0(
      "\n\n**（可选，与火山图联动）**：上述基因集合与火山图（**`", vol, "`**）中的显著点相对应；",
      "热图强调 **样本维度上的共表达模式**，火山图强调 **单基因的效应量与显著性**。"
    )
  }
  paste0(
    "## Methods（方法）— 差异分析与热图\n\n",
    "**差异表达分析**：采用 **limma** 对经 log2 转换并标准化后的表达矩阵进行线性建模，比较 **",
    ga, "** 与 **", gb, "**。差异基因判定标准为 **", limma_rule,
    "**（与本次分析脚本参数一致）。\n\n",
    "**热图**：使用 **pheatmap**（R）基于上述差异结果选取 **Top 上调 / Top 下调** 基因（或用户指定的感兴趣基因列表），绘制表达热图。",
    "**行**为基因，**列**为样本；表达量经 **", row_scaling,
    "** 后着色，色阶表示相对表达高低（与本次输出图例一致）。**", cluster_note, "**\n\n",
    "## Results（结果）— 热图\n\n",
    "**热图（差异基因表达谱）**：与 **", ga, "** 相比，**", gb, "** 中筛选得到 **", n_deg_text,
    "** 个差异表达基因。热图（见 **`", heatmap_rel_path,
    "`**）展示了其中 **代表性差异基因** 在各类样本中的表达分布：颜色深浅反映经标准化后的相对表达水平；",
    "整体上，上调基因在 **", gb, "** 中呈 **", up_color_note, "** 趋势，下调基因呈 **", down_color_note,
    "** 趋势，与分组设计一致。", vol_line, "\n\n",
    "## 讨论提示（占位）\n\n",
    "热图结果需在正文中与 **对比组定义**、**标准化与阈值** 保持一致；若未运行 WGCNA/通路富集等扩展分析，请删除模版中相应表述。\n"
  )
}

#' 构建「Methods + Results」热图段落（英文）
#'
#' @param contrast length-2 character vector.
#' @param limma_rule DEG rule text (may contain special characters).
#' @param row_scaling e.g. "row-wise z-scored".
#' @param cluster_note clustering sentence.
#' @param n_deg_text DEG count or description.
#' @param heatmap_rel_path relative path.
#' @param volcano_rel_path optional volcano path.
#' @param up_color_note wording for up pattern in comparison group.
#' @param down_color_note wording for down pattern.
#'
#' @return Markdown string.
pipeline_interpretation_heatmap_section_en <- function(
    contrast = c("Control", "Case"),
    limma_rule = "|log2FC| > 1 and FDR < 0.05",
    row_scaling = "row-wise z-scored",
    cluster_note = "Row/column order follows this analysis; if hierarchical clustering was enabled, it summarizes expression similarity.",
    n_deg_text = "N",
    heatmap_rel_path = "heatmap.png",
    volcano_rel_path = NA_character_,
    up_color_note = "higher intensity / warm colors",
    down_color_note = "the opposite pattern (lower intensity / cool colors)"
) {
  if (length(contrast) < 2L) contrast <- c("Group A", "Group B")
  ga <- contrast[[1]]
  gb <- contrast[[2]]
  vol <- volcano_rel_path
  vol_line <- if (is.na(vol) || !nzchar(as.character(vol))) {
    ""
  } else {
    paste0(
      "\n\n**(Optional, volcano plot)** The same gene set corresponds to significant features in the volcano plot (**`",
      vol, "`**): the heatmap emphasizes **co-expression across samples**, whereas the volcano plot emphasizes **effect size and significance per gene**."
    )
  }
  paste0(
    "## Methods — differential analysis and heatmap\n\n",
    "**Differential expression.** **limma** was used to fit linear models on **log2-transformed, normalized** expression matrices and to compare **",
    ga, "** vs **", gb, "**. DEGs were defined as **", limma_rule,
    "**, consistent with the analysis parameters used in this run.\n\n",
    "**Heatmap.** **pheatmap** (R) was used to visualize expression patterns of **top up- / down-regulated DEGs** (or a user-supplied gene list). ",
    "**Rows** represent genes and **columns** represent samples. Expression values were **", row_scaling,
    "** before coloring; the color scale indicates relative high/low expression (see figure legend). **", cluster_note, "**\n\n",
    "## Results — heatmap\n\n",
    "**Heatmap of DEG expression.** Compared with **`", ga, "`**, **`", gb, "`** yielded **`", n_deg_text,
    "`** differentially expressed genes. The heatmap (**`", heatmap_rel_path,
    "`**) displays expression patterns of representative DEGs across samples: color intensity reflects **scaled** expression; ",
    "overall, up-regulated genes tend toward **", up_color_note, "** in **`", gb, "`**, while down-regulated genes show **", down_color_note,
    "**, consistent with the experimental design.", vol_line, "\n\n",
    "## Discussion note\n\n",
    "Interpretations must remain **consistent** with the **contrast**, **normalization**, and **thresholds** in Methods; cite enrichment/WGCNA only if performed.\n"
  )
}

#' 从 pipeline 参数提取 contrast（可按你包内实际字段名调整）
#'
#' @param params 命名列表。
pipeline_interpretation_contrast_from_params <- function(params) {
  if (is.null(params)) return(c("Control", "Disease"))
  ct <- params$contrast
  if (is.null(ct)) return(c("Control", "Disease"))
  ct <- as.character(ct)
  if (length(ct) >= 2L) return(ct[1:2])
  c("Control", "Disease")
}
