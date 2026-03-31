import type { ReactNode } from 'react'
import type { Edge, Node } from 'reactflow'
import type { ComposerModuleDef, PipelineStepDef } from './pipelineComposerTypes'

export type ComposerNodeData = {
  moduleKey: string
  functionName: string
  title: string
  subtitle?: string
  params: Record<string, unknown>
  /** React Flow 默认节点展示 */
  label?: ReactNode
}

export function newComposerNodeId(): string {
  return `cn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** 无中文描述时的短英文名（仍比完整 transcriptome_* 易读） */
export function shortenRFunctionName(functionName: string): string {
  return functionName.replace(/^transcriptome_/, '').replace(/^run_/, '')
}

/**
 * 模块展示标题：优先用文档 description 的第一行（多为中文短句），否则用短函数名。
 */
export function moduleDisplayTitle(description: string | undefined, functionName: string): string {
  const fallback = shortenRFunctionName(functionName)
  if (!description?.trim()) return fallback
  const first = description.split(/\r?\n/)[0]?.trim() ?? ''
  if (!first) return fallback
  const max = 56
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

/** 按 transcriptome_pipeline_single 的步骤顺序得到合法连线（仅允许「上一步 → 下一步」） */
export function isValidTemplateEdge(
  sourceTemplateId: string,
  targetTemplateId: string,
  orderedStepIds: string[]
): boolean {
  const i = orderedStepIds.indexOf(sourceTemplateId)
  const j = orderedStepIds.indexOf(targetTemplateId)
  if (i < 0 || j < 0) return false
  return j === i + 1
}

export function topologicalOrderTemplates(
  nodes: Node<ComposerNodeData>[],
  edges: Edge[]
): string[] | { error: string } {
  const ids = new Set(nodes.map((n) => n.id))
  const adj = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const id of ids) {
    adj.set(id, [])
    indeg.set(id, 0)
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1)
  }
  const q: string[] = []
  for (const id of ids) {
    if ((indeg.get(id) || 0) === 0) q.push(id)
  }
  if (q.length === 0 && ids.size > 0) return { error: '图中存在环路，无法确定执行顺序' }
  const out: string[] = []
  while (q.length) {
    const u = q.shift()!
    out.push(u)
    for (const v of adj.get(u) || []) {
      const d = (indeg.get(v) || 0) - 1
      indeg.set(v, d)
      if (d === 0) q.push(v)
    }
  }
  if (out.length !== ids.size) return { error: '图中存在环路，无法确定执行顺序' }
  return out
}

function joinOutPath(outDir: string, suffixPath: string): string {
  const a = outDir.replace(/[/\\]+$/, '')
  const b = suffixPath.replace(/^[/\\]+/, '')
  const sep = outDir.includes('\\') && !outDir.startsWith('//') ? '\\' : '/'
  return `${a}${sep}${b}`
}

/** read_expr 默认：与常见 R 行为一致，主矩阵多为 prefix.txt（若不符可在「标准化」步骤手动选 expr_file） */
export function guessExprPathAfterRead(outDir: string, prefix: string): string {
  return joinOutPath(outDir, `${prefix}.txt`)
}

/** normalize 输出：与原表达矩阵同目录，basename + .normalize.txt */
export function guessNormalizeOutputPath(inputExprFile: string): string {
  const t = inputExprFile.trim().replace(/[/\\]+$/, '')
  const noExt = t.replace(/\.[^./\\]+$/, '')
  return `${noExt}.normalize.txt`
}

export function findStepDef(steps: PipelineStepDef[], templateStepId: string): PipelineStepDef | undefined {
  return steps.find((s) => s.step_id === templateStepId)
}

export function findModuleDef(modules: ComposerModuleDef[], moduleKey: string): ComposerModuleDef | undefined {
  return modules.find((m) => m.key === moduleKey)
}

export function firstFn(step: PipelineStepDef | undefined): string | null {
  if (!step?.fn) return null
  return Array.isArray(step.fn) ? step.fn[0] : step.fn
}

export type ModuleOutputs = {
  expr_file?: string
  normalize_file?: string
  deg_file?: string
  sig_deg_file?: string
  pca_file?: string
  volcano_file?: string
}

export function inferModuleOutputs(
  functionName: string,
  params: Record<string, unknown>,
  runOutputDir: string
): ModuleOutputs {
  const out: ModuleOutputs = {}
  if (functionName === 'transcriptome_read_expr_matrix') {
    const prefix = String(params.prefix ?? 'expr_matrix')
    out.expr_file = guessExprPathAfterRead(runOutputDir, prefix)
    return out
  }
  if (functionName === 'transcriptome_count_to_tpm') {
    const outDir = String(params.out_dir ?? runOutputDir).trim() || runOutputDir
    const prefix = String(params.out_prefix ?? 'TPM').trim() || 'TPM'
    // 与 read_expr 一致：out_dir 下 {out_prefix}.txt 为主表达矩阵（TPM）
    out.expr_file = guessExprPathAfterRead(outDir, prefix)
    return out
  }
  if (functionName === 'transcriptome_normalize_matrix') {
    const expr = String(params.expr_file ?? '').trim()
    if (expr) {
      out.normalize_file = guessNormalizeOutputPath(expr)
      out.expr_file = out.normalize_file
    }
    return out
  }
  if (functionName === 'transcriptome_merge_normalize_combat') {
    const outDir = String(params.out_dir ?? runOutputDir).trim() || runOutputDir
    const prefix = String(params.prefix ?? 'merge').trim() || 'merge'
    out.expr_file = `${outDir.replace(/[/\\]+$/, '')}/${prefix}.normalize.txt`
    out.normalize_file = out.expr_file
    return out
  }
  if (functionName === 'transcriptome_plot_heatmap_limma') {
    const outDir = String(params.out_dir ?? runOutputDir).trim() || runOutputDir
    const norm = outDir.replace(/[/\\]+$/, '')
    out.deg_file = `${norm}/all_diff.txt`
    out.sig_deg_file = `${norm}/sig_diff.txt`
    return out
  }
  if (functionName === 'transcriptome_plot_pca') {
    const outDir = String(params.out_dir ?? runOutputDir).trim() || runOutputDir
    const outFile = String(params.out_file ?? 'PCA.preNorm.pdf')
    out.pca_file = outFile.includes('/') || outFile.includes('\\')
      ? outFile
      : `${outDir.replace(/[/\\]+$/, '')}/${outFile}`
    return out
  }
  if (functionName === 'transcriptome_plot_volcano') {
    const outDir = String(params.out_dir ?? runOutputDir).trim() || runOutputDir
    const outFile = String(params.output_file ?? 'volcano.pdf')
    out.volcano_file = outFile.includes('/') || outFile.includes('\\')
      ? outFile
      : `${outDir.replace(/[/\\]+$/, '')}/${outFile}`
  }
  return out
}

export function applyUpstreamOutputsToParams(
  functionName: string,
  params: Record<string, unknown>,
  upstream?: ModuleOutputs
): Record<string, unknown> {
  if (!upstream) return params
  const next = { ...params }
  const needExpr = !next.expr_file && (upstream.expr_file || upstream.normalize_file)
  if (needExpr) {
    next.expr_file = upstream.normalize_file ?? upstream.expr_file
  }
  if (functionName === 'transcriptome_plot_pca' && !next.input_file) {
    next.input_file = upstream.normalize_file ?? upstream.expr_file ?? next.input_file
  }
  if (functionName === 'transcriptome_plot_volcano' && !next.expr_file) {
    next.expr_file = upstream.deg_file ?? upstream.sig_deg_file ?? next.expr_file
  }
  if (functionName === 'transcriptome_plot_heatmap_limma' && !next.expr_file && upstream.normalize_file) {
    next.expr_file = upstream.normalize_file
  }
  return next
}

export async function runRScriptAndWait(
  outputDir: string,
  script: string
): Promise<{ success: boolean; outputDir?: string; error?: string }> {
  return new Promise((resolve) => {
    const cleanup = window.electronAPI.onRunRScriptResult((res) => {
      cleanup()
      resolve(res)
    })
    void window.electronAPI.runRScript(outputDir, script).then((r) => {
      if (!r.started) {
        cleanup()
        resolve({ success: false, error: r.error || '启动失败' })
      }
    })
  })
}
