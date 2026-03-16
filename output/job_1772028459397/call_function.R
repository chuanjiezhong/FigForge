library("OmicsFlowCoreFullVersion", character.only = TRUE)

      # 调用函数
      result <- transcriptome_plot_heatmap_limma(expr_file = "/Users/多组学分析/OmicsFlowCoreFullVersion 示例/1_差异分析/merge.normalize.txt", out_dir = "/Users/多组学分析/OmicsFlowCoreFullVersion 示例/1_差异分析", group_regex = "(.+)_([^_]+)_([^_]+)", contrast = c("Control", "Disease"), logfc_thr = 1, adjp_thr = 0.05, top_n = 100000, cluster_cols = FALSE, palette = c("blue", "white", "red"), annotation_dataset_levels = c("GSE123456"), annotation_colors_list = list(Group=c("Control"="#1b8fed", "Disease"="#ef0606"), DataSet=c("GSE123456"="#23cf13")), scale_rows = "row", show_gene_names = FALSE, use_adj_pval = TRUE, goi_mode = "intersect_sig", fontsize = 12, image_format = "png", save_rds = TRUE, rds_file = "heatmap.rds")

      # 保存结果
      if (is.data.frame(result)) {
        write.table(result, file.path("/Users/多组学分析/FigForge/output/job_1772028459397", "result.txt"), row.names = FALSE, sep = "\t")
      } else if (is.list(result)) {
        saveRDS(result, file.path("/Users/多组学分析/FigForge/output/job_1772028459397", "result.rds"))
      } else {
        writeLines(as.character(result), file.path("/Users/多组学分析/FigForge/output/job_1772028459397", "result.txt"))
      }
    