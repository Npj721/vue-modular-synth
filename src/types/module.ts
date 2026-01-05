export type PortKind = 'audio' | 'cv'

export interface ModulePortDef {
  id: string
  label?: string
  kind: PortKind
}

export interface ModuleParamDef {
  type: 'number' | 'enum'
  min?: number
  max?: number
  step?: number
  values?: string[]
  default?: number | string
}

export interface ModuleDef {
  type: string
  label: string
  inputs: ModulePortDef[]
  outputs: ModulePortDef[]
  params: Record<string, ModuleParamDef>
}
