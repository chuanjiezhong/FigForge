# Pipeline interpretation snippets (English)

> Derived from the **Methods (limma + pheatmap)** and **Results (Figure 1 heatmap captions)** structure in `docs/文章模版/3.docx`, generalized for **any contrast**.  
> Replace placeholders: `{groupA}`, `{groupB}`, `{tissue_or_species}`, `{heatmap_rel_path}`, `{volcano_path}`, `{limma_rule}`, etc.

---

## Methods — differential analysis and heatmap

**Differential expression.** **limma** was used to fit linear models on **log2-transformed, normalized** expression matrices and to compare **`{groupA}`** vs **`{groupB}`**. DEGs were defined as **`{limma_rule, e.g., |log2FC| > 1 and FDR < 0.05}`**, consistent with the analysis parameters used in this run.

**Heatmap.** **pheatmap** (R) was used to visualize expression patterns of **top up- / down-regulated DEGs** (or a user-supplied gene list). **Rows** represent genes and **columns** represent samples. Expression values were **`{scaling, e.g., row-wise z-scored}`** before coloring; the color scale indicates relative high/low expression (see figure legend for the exact palette). **`{If clustering is enabled: hierarchical clustering of rows/columns summarizes similarity of expression profiles; if disabled: row/column order follows the analysis settings.}`**

---

## Results — heatmap paragraph (example)

**Heatmap of DEG expression.** Compared with **`{groupA}`**, **`{groupB}`** yielded **`{N or description}`** differentially expressed genes. The heatmap (**`{heatmap_rel_path}`**) displays the expression patterns of representative DEGs across samples: color intensity reflects **scaled** expression; overall, up-regulated genes tend toward **`{direction/color wording}`** in **`{groupB}`**, while down-regulated genes show the opposite pattern, consistent with the experimental design.

**(Optional, linked to volcano plot)** The same gene set corresponds to significant features in the volcano plot (**`{volcano_path}`**): the heatmap emphasizes **co-expression across samples**, whereas the volcano plot emphasizes **effect size and significance per gene**.

---

## Discussion note (one sentence)

Heatmap interpretations must remain **consistent** with the **contrast definition**, **normalization**, and **thresholds** reported in Methods; optional downstream enrichment or WGCNA (as in template paper `3.docx`) should only be cited if those analyses were actually performed.
