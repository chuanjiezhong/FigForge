library(OmicsFlowCore)

        # 调用函数
        result <- run_pathway_correlation_analysis(expr_file = "/Users/多组学分析/figforge 测试/merge.normalize.txt", gmt_file = "/Users/多组学分析/figforge 测试/GO_BP_pathways_displayed.gmt", aggregate_by = "cell", celltype_col = "cellType", group_col = "group", gene_file = undefined, outDir = "/Users/多组学分析/figforge 测试", method = "gsva", kcdf = "Gaussian", tau = 1, maxDiff = true, cor_method = "spearman", pathway_order_file = undefined, pathway_order = undefined, show_numbers = "auto", show_numbers_threshold = 15, plot_method = "corrplot", colors = undefined, width = 14, height = 10, title = "Pathway Correlation Heatmap (Spearman)", label_cex = undefined, number_cex = undefined, save_scores = true, save_cor_matrix = true, save_pvalue = true, save_significance = true, input_type = "matrix")
        
        # 保存结果
        if (is.data.frame(result)) {
          write.table(result, file.path("/Users/多组学分析/FigForge/output/job_1768554523794", "result.txt"), row.names = FALSE, sep = "\	")
        } else if (is.list(result)) {
          saveRDS(result, file.path("/Users/多组学分析/FigForge/output/job_1768554523794", "result.rds"))
        } else {
          writeLines(as.character(result), file.path("/Users/多组学分析/FigForge/output/job_1768554523794", "result.txt"))
        }
      