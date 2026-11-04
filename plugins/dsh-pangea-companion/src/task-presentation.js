const MAX_NAME_LENGTH = 40
const text = value => typeof value === 'string' && value.trim() ? value : ''
const length = value => Array.from(value).length
const analysisLabels = {
  'interface-contract': '接口契约分析', 'product-behavior': '行为分析',
  'module-analysis': '模块分析', 'coverage-analysis': '覆盖率分析',
  'risk-analysis': '风险分析', 'branch-analysis': '分支分析',
  module: '模块分析', coverage: '覆盖率分析', risk: '风险分析', branch: '分支分析',
}
const knownLabel = value => typeof value === 'string' && Object.hasOwn(analysisLabels, value) ? analysisLabels[value] : ''

function shortTitle(value) {
  const title = text(value).trim()
  if (!title || length(title) > MAX_NAME_LENGTH || /[\r\n\u2028\u2029]/.test(value)) return ''
  if (/^[\[\{"`]|^%(?:7b|5b|22)|^(?:&quot;|&#)/i.test(title)) return ''
  if (/[。！？；!?;]|\.\s|\.{2,}|…/.test(title)) return ''
  if (/^(?:请(?!求)|麻烦|帮我|为|以(?=.+(?:视角|身份|方式|验证))|根据|基于|按照|针对|围绕|要求|分析对象|测试对象|任务要求|分析要求)/.test(title)) return ''
  if (/^(?:生成|输出|交付)(?:\s|测试|用例|报告|流程|结果|完整|全部|可导航)/.test(title)) return ''
  if (/^(?:please|analy[sz]e|generate|create|verify|validate|write|ensure|use|based on)\b/i.test(title)) return ''
  if (/(?:[:：,，、/\\\-–—]|以及|包括|包含|为了|关于|与|和|及|的)$/.test(title)) return ''
  if (/^(?:分析|任务|新建分析|分析对象|要求|验证|生成|未命名|未命名任务)$/.test(title)) return ''
  return title
}

function analysisKind(task, current) {
  for (const value of [task?.objective, current?.objective, task?.analysis_scene?.objective, current?.analysis_scene?.objective,
    task?.analysis_settings?.objective, current?.analysis_settings?.objective]) {
    const label = knownLabel(value)
    if (label) return label
  }
  if ([task?.analysis_profile, current?.analysis_profile].some(value => typeof value === 'string' && /^behavior-test(?:-|$)/.test(value))) return '行为分析'
  for (const value of [task?.scenario, current?.scenario, task?.analysis_settings?.scenario, current?.analysis_settings?.scenario, current?.analysis_scene?.id]) {
    const label = knownLabel(value)
    if (label) return label
  }
  return ''
}

function scopePaths(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return [...new Set(values.filter(item => typeof item === 'string' && item.trim() && !/[\r\n\u2028\u2029]/.test(item))
    .map(item => item.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '') || '.'))]
}

const segments = value => value.split('/').filter(part => part && part !== '.')
const fileStem = value => value.replace(/^(.+)\.[^.]+$/, '$1')
const isFile = value => /[^.]\.[^./]+$/.test(value)

function repositoryName(value) {
  const raw = text(value).trim()
  if (!raw || /[\r\n\u2028\u2029]/.test(raw)) return ''
  const name = segments(raw.replace(/\\/g, '/')).at(-1)?.replace(/\.git$/, '') ?? ''
  return shortTitle(name)
}

function scopeNames(paths) {
  if (!paths.length || paths.some(value => /^(?:\.|\*|\*\*|\*\*\/\*)$/.test(value))) return []
  if (paths.some(value => segments(value).includes('..'))) return []
  const parts = paths.map(segments)
  if (parts.some(value => !value.length)) return []
  if (paths.length === 1) {
    const path = parts[0], last = path.at(-1)
    // A wildcard identifies its containing directory, never a literal module.
    const wildcard = path.findIndex(part => /[*?\[\]{}]/.test(part))
    const parent = wildcard < 0 ? path.slice(0, -1) : path.slice(0, wildcard)
    return [wildcard < 0 ? fileStem(last) : '', ...parent.reverse()]
  }
  if (parts.some(value => !isFile(value.at(-1)) || /[*?\[\]{}]/.test(value.join('/')))) return []
  const stems = parts.map(value => fileStem(value.at(-1)))
  if (stems.every(value => value === stems[0])) return [stems[0]]
  const parents = parts.map(value => value.slice(0, -1).join('/'))
  if (!parents.every(value => value === parents[0])) return []
  return parts[0].slice(0, -1).reverse()
}

// Read-only display projection. Never shorten a request into a new title or
// interpret its prose as an analysis type; frozen metadata supplies that type.
export function taskDisplayName(task, current) {
  for (const value of [task?.title, current?.title]) {
    const title = shortTitle(value)
    if (title) return title
  }
  const taskPaths = scopePaths(task?.source_scope)
  const frozenPaths = scopePaths(current?.source_snapshot?.requested_scope)
  const paths = taskPaths.length ? taskPaths : frozenPaths.length ? frozenPaths : scopePaths(current?.source_scope)
  const kind = analysisKind(task, current)
  const repositories = [repositoryName(task?.repository), repositoryName(current?.repository)].filter(Boolean)
  if (!paths.length) {
    for (const value of [task?.target, current?.target]) {
      const title = shortTitle(value)
      if (title) return title
    }
  }
  for (const value of [...scopeNames(paths), ...repositories]) {
    const object = shortTitle(value)
    if (!object) continue
    const name = kind ? `${object} ${kind}` : object
    if (length(name) <= MAX_NAME_LENGTH) return name
  }
  return '分析任务'
}

// Keep the exact saved request, including whitespace and line breaks, for the
// detail surface. JSON strings remain raw here rather than becoming labels.
export function taskRequestText(task, current) {
  for (const value of [task?.target, current?.target]) if (text(value)) return value
  for (const value of [task?.title, current?.title]) if (text(value) && !shortTitle(value)) return value
  return text(task?.title) || text(current?.title)
}
