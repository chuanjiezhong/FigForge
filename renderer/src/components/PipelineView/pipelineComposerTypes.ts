export type PipelineStepDef = {
  step_id: string
  name: string
  config_key?: string
  fn?: string | string[]
  overridable_params?: string[]
  outputs_keys?: string[]
}

export type PipelineDefs = Record<string, { pipeline_name: string; steps: PipelineStepDef[] }>

export type ComposerModuleDef = {
  key: string
  functionName: string
  title: string
  description?: string
  category?: string
  packageName?: string
  parameters?: string[]
  io?: {
    consumes?: string[]
    produces?: string[]
    bindings?: Record<string, string>
  }
}
