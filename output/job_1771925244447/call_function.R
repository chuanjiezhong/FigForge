library("OmicsFlowCoreFullVersion", character.only = TRUE)

      # 调用函数
      result <- transcriptome_normalize_matrix(expr_file = "/Users/多组学分析/OmicsFlowCoreFullVersion 示例/0_数据矫正/geneMatrix.txt", group_file = "/Users/多组学分析/OmicsFlowCoreFullVersion 示例/0_数据矫正/groups.txt", out_dir = "/Users/多组学分析/OmicsFlowCoreFullVersion 示例/0_数据矫正", log_cutoff = "NULL", overwrite = TRUE)

      # 保存结果
      if (is.data.frame(result)) {
        write.table(result, file.path("/Users/多组学分析/FigForge/output/job_1771925244447", "result.txt"), row.names = FALSE, sep = "\t")
      } else if (is.list(result)) {
        saveRDS(result, file.path("/Users/多组学分析/FigForge/output/job_1771925244447", "result.rds"))
      } else {
        writeLines(as.character(result), file.path("/Users/多组学分析/FigForge/output/job_1771925244447", "result.txt"))
      }
    