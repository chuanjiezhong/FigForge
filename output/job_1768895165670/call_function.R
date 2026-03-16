library("OmicsFlowCore", character.only = TRUE)

      # 调用函数
      result <- run_pathway_correlation_analysis(expr_file = "/Users/多组学分析/figforge 测试/merge.normalize.txt", gmt_file = "/Users/多组学分析/figforge 测试/GO_BP_pathways_displayed.gmt", aggregate_by = "cell", celltype_col = "cellType", group_col = "group", outDir = "/Users/多组学分析/figforge 测试", method = "gsva", kcdf = "Gaussian", tau = 1, maxDiff = TRUE, cor_method = "spearman", show_numbers = "true", show_numbers_threshold = 15, plot_method = "corrplot", width = 14, height = 10, title = "Pathway Correlation Heatmap (Spearman)", save_scores = TRUE, save_cor_matrix = TRUE, save_pvalue = TRUE, save_significance = TRUE, input_type = "matrix")

      # 保存结果
      if (is.data.frame(result)) {
        write.table(result, file.path("/Users/多组学分析/FigForge/output/job_1768895165670", "result.txt"), row.names = FALSE, sep = "\t")
      } else if (is.list(result)) {
        saveRDS(result, file.path("/Users/多组学分析/FigForge/output/job_1768895165670", "result.rds"))
      } else {
        writeLines(as.character(result), file.path("/Users/多组学分析/FigForge/output/job_1768895165670", "result.txt"))
      }
    