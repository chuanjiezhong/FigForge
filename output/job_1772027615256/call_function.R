library("OmicsFlowCoreFullVersion", character.only = TRUE)

      # 调用函数
      result <- transcriptome_plot_heatmap_limma(expr_file = "/Users/多组学分析/OmicsFlowCoreFullVersion 示例/1_差异分析/merge.normalize.txt", out_dir = "/Users/多组学分析/OmicsFlowCoreFullVersion 示例/1_差异分析", group_regex = "(.+)_([^_]+)_([^_]+)", contrast = c("Control", "Disease"), logfc_thr = 1, adjp_thr = 0.05, top_n = 100000, cluster_cols = FALSE, palette = c("blue", "white", "red"), annotation_colors_list = list(Group=c("Control"="#0a7eea", "Disease"="#762121"), DataSet=c("DataSet"="#1e4870")), scale_rows = "row", show_gene_names = FALSE, use_adj_pval = TRUE, goi_mode = "intersect_sig", fontsize = 12, image_format = "pdf", save_rds = TRUE, rds_file = "heatmap.rds")

      # 保存结果
      if (is.data.frame(result)) {
        write.table(result, file.path("/Users/多组学分析/FigForge/output/job_1772027615256", "result.txt"), row.names = FALSE, sep = "\t")
      } else if (is.list(result)) {
        saveRDS(result, file.path("/Users/多组学分析/FigForge/output/job_1772027615256", "result.rds"))
      } else {
        writeLines(as.character(result), file.path("/Users/多组学分析/FigForge/output/job_1772027615256", "result.txt"))
      }
    