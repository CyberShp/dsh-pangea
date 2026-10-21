// sequence-v1 stores authored interaction facts only. Coordinates belong to this
// renderer; malformed optional views never change or reject the analysis record.
export const SEQUENCE_FORMAT = 'sequence-v1'
const MESSAGE_KINDS = new Set(['call', 'return', 'async', 'self'])
const FRAGMENT_KINDS = new Set(['alt', 'opt', 'loop', 'par'])
const AUTHOR_STATUSES = new Set(['ready', 'partial', 'unknown', 'not_applicable'])
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' ? value.trim() : ''
const array = value => Array.isArray(value) ? value : []
const emptyGraph = () => ({ format_version: SEQUENCE_FORMAT, title: '', participants: [], messages: [], fragments: [], notes: [] })
const repeatedIds = rows => {
  const counts = new Map()
  for (const row of rows) if (object(row) && text(row.id)) counts.set(row.id, (counts.get(row.id) ?? 0) + 1)
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id))
}

/** Tolerant display parsing. Return raw content alongside a safe drawable view. */
export function normalizeSequence(input) {
  const raw = input
  if (input == null) return { status: 'unknown', errors: [], graph: { ...emptyGraph(), view_status: 'unknown' }, raw }
  if (typeof input === 'string') {
    try { input = JSON.parse(input) } catch {
      const errors = ['时序记录不是可读取的 JSON 对象']
      return { status: 'invalid', errors, graph: { ...emptyGraph(), view_status: 'invalid', view_errors: errors }, raw }
    }
  }
  if (!object(input)) {
    const errors = ['时序记录必须是对象']
    return { status: 'invalid', errors, graph: { ...emptyGraph(), view_status: 'invalid', view_errors: errors }, raw }
  }
  const errors = []
  if (input.format_version !== SEQUENCE_FORMAT) errors.push(`时序格式应为 ${SEQUENCE_FORMAT}，原记录保留`)
  if (input.status != null && !AUTHOR_STATUSES.has(input.status)) errors.push('时序记录的完成状态无法识别')
  for (const name of ['participants', 'messages', 'fragments', 'notes']) {
    if (input[name] != null && !Array.isArray(input[name])) errors.push(`${name} 必须是数组`)
  }
  const evidence = (value, where) => {
    if (value == null) return []
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) errors.push(`${where} 应为源码依据字符串数组`)
    return array(value).filter(item => typeof item === 'string')
  }
  const duplicateParticipants = repeatedIds(array(input.participants))
  const participants = array(input.participants).flatMap((row, index) => {
    if (!object(row) || !text(row.id)) { errors.push(`participants[${index}] 缺少参与者 id，未绘制`); return [] }
    if (duplicateParticipants.has(row.id)) { errors.push(`参与者 id '${row.id}' 重复，无法确定消息归属`); return [] }
    if (!text(row.label)) errors.push(`参与者 '${row.id}' 缺少名称，暂显示 id`)
    return [{ ...row, id: row.id, label: text(row.label) || row.id, description: text(row.description) }]
  })
  const participantIds = new Set(participants.map(row => row.id))
  const duplicateMessages = repeatedIds(array(input.messages))
  const messages = array(input.messages).flatMap((row, index) => {
    const where = `messages[${index}]`
    if (!object(row) || !text(row.id)) { errors.push(`${where} 缺少消息 id，未绘制`); return [] }
    if (duplicateMessages.has(row.id)) { errors.push(`消息 id '${row.id}' 重复，未绘制`); return [] }
    if (!participantIds.has(row.from) || !participantIds.has(row.to)) { errors.push(`消息 '${row.id}' 的发送方或接收方未明确，未绘制`); return [] }
    if (row.kind === 'self' && row.from !== row.to) { errors.push(`消息 '${row.id}' 声明 self，但两端不同，未绘制`); return [] }
    if (!MESSAGE_KINDS.has(row.kind)) errors.push(`消息 '${row.id}' 的交互类型待确认`)
    if (!text(row.label)) errors.push(`消息 '${row.id}' 缺少说明，暂显示 id`)
    return [{ ...row, id: row.id, label: text(row.label) || row.id, kind: MESSAGE_KINDS.has(row.kind) ? row.kind : 'unknown',
      source_evidence: evidence(row.source_evidence, `${where}.source_evidence`) }]
  })
  const originalPositions = new Map(array(input.messages).map((row, index) => [row?.id, index]))
  const messageIndex = new Map(messages.map(row => [row.id, originalPositions.get(row.id)]))
  const duplicateFragments = repeatedIds(array(input.fragments))
  const candidates = array(input.fragments).map((row, index) => {
    const problems = []
    const name = text(row?.id) || `fragments[${index}]`
    if (!object(row) || !text(row.id)) problems.push('缺少片段 id')
    if (duplicateFragments.has(row?.id)) problems.push('片段 id 重复')
    if (!FRAGMENT_KINDS.has(row?.kind)) problems.push('片段类型不是 alt/opt/loop/par')
    const rawOperands = array(row?.operands)
    if (['alt', 'par'].includes(row?.kind) && rawOperands.length < 2 || ['opt', 'loop'].includes(row?.kind) && rawOperands.length !== 1) problems.push('分支数量与片段类型不符')
    if (!rawOperands.length) problems.push('没有可读取的分支')
    const seen = new Set()
    const operands = rawOperands.map((operand, operandIndex) => {
      const ids = array(operand?.message_ids)
      if (!ids.length || ids.some(id => typeof id !== 'string')) problems.push(`分支 ${operandIndex + 1} 缺少消息 id 数组`)
      for (const id of ids) {
        if (!messageIndex.has(id)) problems.push(`分支引用了未知或无法绘制的消息 '${String(id)}'`)
        if (seen.has(id)) problems.push(`消息 '${String(id)}' 同时属于多个分支`)
        seen.add(id)
      }
      const condition = text(operand?.condition)
      if (!condition) errors.push(`片段 '${name}' 的分支 ${operandIndex + 1} 条件未提供`)
      return { condition, message_ids: ids.filter(id => typeof id === 'string') }
    })
    const ids = operands.flatMap(operand => operand.message_ids)
    const indexes = ids.map(id => messageIndex.get(id))
    if (indexes.some((position, at) => at && position !== indexes[at - 1] + 1)) problems.push('消息顺序不连续或与原消息顺序冲突')
    return { row: object(row) ? row : {}, name, operands, ids, indexes, problems }
  })
  // Overlapping top-level fragments cannot be flattened or silently re-ordered.
  const memberships = new Map()
  for (const candidate of candidates) for (const id of new Set(candidate.ids)) {
    const owners = memberships.get(id) ?? []
    owners.push(candidate)
    memberships.set(id, owners)
  }
  for (const [id, owners] of memberships) if (owners.length > 1) for (const owner of owners) owner.problems.push(`消息 '${id}' 被多个片段引用`)
  const omitted = new Set()
  for (const candidate of candidates) if (candidate.problems.length) {
    for (const id of candidate.ids) if (messageIndex.has(id)) omitted.add(id)
    errors.push(`片段 '${candidate.name}'：${[...new Set(candidate.problems)].join('；')}；相关消息未绘制，原始记录保留`)
  }
  const fragments = candidates.filter(candidate => !candidate.problems.length).map(candidate => ({
    ...candidate.row, id: candidate.row.id, kind: candidate.row.kind, label: text(candidate.row.label), operands: candidate.operands,
  }))
  const notes = array(input.notes).filter(note => typeof note === 'string')
  if (array(input.notes).length !== notes.length) errors.push('notes 中有非文字项目，原始记录保留')
  const uniqueErrors = [...new Set(errors)]
  const visibleMessages = messages.filter(row => !omitted.has(row.id))
  const status = input.status === 'not_applicable' || input.status === 'unknown' ? input.status
    : !participants.length || !visibleMessages.length ? (uniqueErrors.length ? 'invalid' : 'unknown')
      : uniqueErrors.length || input.status === 'partial' ? 'partial' : 'ok'
  // A declaration of ready does not manufacture messages for an empty record.
  const graph = { ...input, format_version: SEQUENCE_FORMAT, title: text(input.title), participants, messages: visibleMessages, fragments,
    notes, omitted_message_ids: [...omitted], view_status: status, view_errors: uniqueErrors }
  return { status, errors: uniqueErrors, graph, raw }
}

const fontWidth = char => /[\u0000-\u00ff]/u.test(char) ? (/[ilI.,'!:;|]/.test(char) ? 4 : 7.5) : 14
const measure = value => [...value].reduce((sum, char) => sum + fontWidth(char), 0)
function wrap(value, width) {
  const lines = []
  for (const paragraph of String(value).replace(/\r\n?/g, '\n').split('\n')) {
    let line = '', used = 0
    for (const char of paragraph) {
      const size = fontWidth(char)
      if (used + size > width && line) { lines.push(line); line = ''; used = 0 }
      line += char
      used += size
    }
    lines.push(line)
  }
  return lines.length ? lines : ['']
}

/** Stable geometry based only on the semantic sequence, never model coordinates. */
export function layoutSequence(input) {
  const normalized = input?.view_status ? { graph: input, errors: input.view_errors ?? [], status: input.view_status } : normalizeSequence(input)
  const graph = normalized.graph
  const width = Math.max(560, 320 + Math.max(0, graph.participants.length - 1) * 240)
  const titleLines = wrap(graph.title || '时序图', width - 80)
  const titleHeight = titleLines.length * 22
  const headerY = titleHeight + 30
  const participantLines = graph.participants.map(row => wrap(row.label, 156))
  const headerHeight = Math.max(52, ...participantLines.map(lines => lines.length * 18 + 20))
  const participants = graph.participants.map((row, index) => ({ ...row, x: 110 + index * 240,
    box: { x: 20 + index * 240, y: headerY, w: 180, h: headerHeight }, lines: participantLines[index] }))
  const byId = new Map(participants.map(row => [row.id, row]))
  const sourceMessages = graph.messages
  const byMessage = new Map(sourceMessages.map((row, index) => [row.id, { ...row, index }]))
  const fragmentAt = new Map(graph.fragments.map(fragment => [fragment.operands[0]?.message_ids[0], fragment]))
  const messages = [], fragments = []
  let cursor = headerY + headerHeight + 32
  const addMessage = row => {
    const x1 = byId.get(row.from).x, x2 = byId.get(row.to).x
    const self = x1 === x2
    const labelLines = wrap(row.label, self ? 166 : Math.min(340, Math.max(80, Math.abs(x2 - x1) - 32)))
    const w = Math.max(28, ...labelLines.map(measure)) + 14
    const h = labelLines.length * 18 + 8
    const x = self ? x1 + 12 : (x1 + x2 - w) / 2
    const labelBox = { x, y: cursor, w, h }
    const y = cursor + h + 8
    const path = self ? `M${x1} ${y} H${x1 + 105} V${y + 28} H${x1}` : `M${x1} ${y} H${x2}`
    messages.push({ ...row, x1, x2, y, self, path, labelLines, labelBox })
    cursor = y + (self ? 28 : 0) + 24
  }
  let index = 0
  while (index < sourceMessages.length) {
    const row = sourceMessages[index]
    const fragment = fragmentAt.get(row.id)
    if (!fragment) { addMessage(byMessage.get(row.id)); index++; continue }
    const top = cursor
    const labelLines = wrap(fragment.label || '', width - 180)
    const labelHeight = Math.max(30, labelLines.length * 18 + 14)
    cursor += labelHeight
    const operands = []
    for (const operand of fragment.operands) {
      const operandY = cursor
      const conditionLines = wrap(operand.condition || '条件未提供', width - 110)
      cursor += conditionLines.length * 17 + 18
      for (const id of operand.message_ids) addMessage(byMessage.get(id))
      operands.push({ ...operand, y: operandY, height: cursor - operandY, conditionLines })
    }
    fragments.push({ ...fragment, x: 25, y: top, w: width - 50, h: cursor - top + 4, labelLines, labelHeight, operands })
    cursor += 24
    index += fragment.operands.reduce((sum, operand) => sum + operand.message_ids.length, 0)
  }
  const notes = [...graph.notes]
  if (!messages.length) notes.unshift(graph.status === 'not_applicable' ? '当前分析标注此流程不适合时序图。' : '当前记录未提供可展示的交互消息。')
  const errors = [...normalized.errors]
  const footer = [
    ...(normalized.status === 'unknown' ? ['交互关系待确认；当前内容不代表已完成的时序结论。'] : []),
    ...(normalized.status === 'not_applicable' && messages.length ? ['当前分析标注此流程不适合时序图；以下内容仅保留已有记录。'] : []),
    ...(normalized.status === 'partial' || errors.length ? ['当前时序资料不完整，请结合下列提示与原始记录查看。'] : []),
    ...errors.map(error => `待确认：${error}`), ...notes,
  ].flatMap(note => wrap(note, width - 80))
  const footerY = cursor + 16
  const height = Math.max(240, footerY + footer.length * 18 + 28)
  return { width, height, title: graph.title || '时序图', titleLines, participants, messages, fragments, notes, errors,
    status: normalized.status, footer, footerY, lifelineTop: headerY + headerHeight, lifelineBottom: cursor - 10 }
}

const el = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat().filter(child => child != null && child !== false) })
const FONT = "'Microsoft YaHei UI','PingFang SC','Noto Sans CJK SC',sans-serif"
function linesTree(lines, x, y, attrs = {}, lineHeight = 18) {
  return el('text', { x, fill: '#334155', 'font-size': 13, ...attrs }, lines.map((line, index) => el('tspan', { x, y: y + index * lineHeight }, line)))
}

/** Framework-neutral SVG; client attaches handlers only to data-message-id groups. */
export function renderSequenceTree(layout, options = {}) {
  const frames = layout.fragments.map(fragment => el('g', { 'data-fragment-id': fragment.id, 'data-fragment-kind': fragment.kind },
    el('rect', { x: fragment.x, y: fragment.y, width: fragment.w, height: fragment.h, rx: 4, fill: 'none', stroke: '#94a3b8', 'stroke-width': 1.4 }),
    el('rect', { x: fragment.x, y: fragment.y, width: fragment.w, height: fragment.labelHeight, fill: '#eef2f7' }),
    el('text', { x: fragment.x + 12, y: fragment.y + 21, 'font-size': 13, 'font-weight': 700, fill: '#334155' }, fragment.kind),
    linesTree(fragment.labelLines, fragment.x + 70, fragment.y + 21),
    fragment.operands.map((operand, index) => el('g', { 'data-operand': `${fragment.id}:${index}` },
      index ? el('line', { x1: fragment.x, x2: fragment.x + fragment.w, y1: operand.y, y2: operand.y, stroke: '#94a3b8', 'stroke-dasharray': '5 4' }) : null,
      el('rect', { x: fragment.x + 8, y: operand.y + 3, width: fragment.w - 16, height: operand.conditionLines.length * 17 + 7, fill: '#fbfcfe' }),
      linesTree(operand.conditionLines, fragment.x + 16, operand.y + 19, { 'font-size': 12, 'font-weight': 600 }, 17)))))
  const messages = layout.messages.map(message => {
    const selected = options.selectedMessage === message.id
    const color = selected ? '#3157d5' : message.kind === 'unknown' ? '#a16207' : '#64748b'
    const endX = message.self ? message.x1 : message.x2
    const endY = message.y + (message.self ? 28 : 0)
    const direction = message.self || message.x2 < message.x1 ? -1 : 1
    const baseX = endX - direction * 9
    const arrow = `M${baseX} ${endY - 5} L${endX} ${endY} L${baseX} ${endY + 5}${message.kind === 'async' ? '' : ' Z'}`
    const detail = [message.label, `${message.from} → ${message.to}`, message.kind === 'unknown' ? '交互类型待确认' : message.kind,
      ...message.source_evidence].join('\n')
    return el('g', { 'data-message-id': message.id, 'data-selected': selected ? 'true' : 'false', role: 'button', tabindex: 0,
      'aria-label': detail, 'aria-pressed': selected ? 'true' : 'false', cursor: 'pointer' },
      el('title', {}, detail),
      el('path', { d: message.path, fill: 'none', stroke: '#000000', 'stroke-opacity': 0, 'stroke-width': 12, 'pointer-events': 'stroke' }),
      el('path', { d: message.path, fill: 'none', stroke: color, 'stroke-width': selected ? 2.8 : 1.6,
        'stroke-dasharray': message.kind === 'return' ? '6 4' : message.kind === 'unknown' ? '2 3' : null, 'pointer-events': 'none' }),
      message.kind !== 'unknown' ? el('path', { d: arrow, fill: message.kind === 'async' ? 'none' : color, stroke: color, 'stroke-width': 1.5,
        'data-arrow-kind': message.kind, 'pointer-events': 'none' }) : null,
      el('rect', { x: message.labelBox.x, y: message.labelBox.y, width: message.labelBox.w, height: message.labelBox.h, rx: 4,
        fill: selected ? '#eff6ff' : '#fbfcfe', stroke: selected ? '#93b4f4' : 'none' }),
      linesTree(message.labelLines, message.labelBox.x + 7, message.labelBox.y + 17, { fill: selected ? '#1e40af' : '#334155' }))
  })
  return el('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${layout.width} ${layout.height}`, width: layout.width, height: layout.height,
    'font-family': FONT, role: 'img', 'aria-label': layout.title },
    el('rect', { x: 0, y: 0, width: layout.width, height: layout.height, fill: '#fbfcfe' }),
    linesTree(layout.titleLines, 30, 28, { 'font-size': 17, 'font-weight': 700, fill: '#1e293b' }, 22),
    layout.participants.map(participant => el('line', { x1: participant.x, x2: participant.x, y1: layout.lifelineTop, y2: layout.lifelineBottom,
      stroke: '#b7c2d0', 'stroke-dasharray': '6 5', 'pointer-events': 'none' })),
    frames, messages,
    layout.participants.map(participant => el('g', { 'data-participant-id': participant.id },
      el('title', {}, [participant.label, participant.description].filter(Boolean).join('\n')),
      el('rect', { x: participant.box.x, y: participant.box.y, width: participant.box.w, height: participant.box.h, rx: 8,
        fill: '#ffffff', stroke: '#6f829b', 'stroke-width': 1.5 }),
      linesTree(participant.lines, participant.x, participant.box.y + (participant.box.h - participant.lines.length * 18) / 2 + 14, { 'text-anchor': 'middle', 'font-weight': 600 }))),
    linesTree(layout.footer, 30, layout.footerY, { 'font-size': 12, fill: layout.errors.length ? '#92400e' : '#64748b' }))
}
