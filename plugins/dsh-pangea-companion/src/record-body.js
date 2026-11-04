const RECOVERY_LIMIT = 256 * 1024
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = value => typeof value === 'string' && value.trim().length > 0

function diagnostic(source, offset, found, expected, message, severity = 'error') {
  const before = source.slice(0, offset), lines = before.split(/\r\n|\r|\n/)
  return { offset, line: lines.length, column: lines.at(-1).length + 1, found, expected, message, severity }
}

function syntaxDiagnostic(source, error) {
  const message = error instanceof Error ? error.message : String(error)
  const position = /position (\d+)/i.exec(message)
  const offset = position ? Math.min(source.length, Number(position[1])) : /end of|unterminated/i.test(message) ? source.length : 0
  return diagnostic(source, offset, source[offset] ?? '', '有效的完整 JSON 对象', `原记录正文不是有效 JSON：${message}`)
}

function invalid(code, diagnostics) {
  return { body: {}, record_parse: { status: 'invalid', code, diagnostics } }
}

// Scan delimiters only. Quoted strings and escapes are never edited. A stack
// mismatch has one deterministic replacement; missing characters are rejected.
function closingDelimiters(source) {
  const stack = [], mismatches = []
  let quoted = false, escaped = false
  for (let offset = 0; offset < source.length; offset++) {
    const char = source[offset]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === '{' || char === '[') { stack.push(char === '{' ? '}' : ']'); continue }
    if (char !== '}' && char !== ']') continue
    const expected = stack.pop()
    if (!expected) return { code: 'unexpected_closing_delimiter', diagnostics: [diagnostic(source, offset, char, '', '闭合符没有对应起始符，未兼容解析。')] }
    if (char !== expected) {
      mismatches.push(diagnostic(source, offset, char, expected, '闭合符与当前对象或数组不匹配。'))
      if (mismatches.length > 1) return { code: 'multiple_closing_delimiters', diagnostics: mismatches }
    }
  }
  if (quoted || stack.length) return { code: 'incomplete_json', diagnostics: [diagnostic(source, source.length, '', quoted ? '"' : stack.at(-1), '原记录正文未完整闭合，未补写缺失字符。')] }
  return { mismatches }
}

// JSON.parse accepts repeated keys by discarding earlier values. Recovery must
// not make that ambiguous choice, including escaped spellings of the same key.
function duplicateKey(source) {
  const stack = []
  for (let offset = 0; offset < source.length; offset++) {
    const char = source[offset]
    if (char === '{' || char === '[') { stack.push(char === '{' ? new Set() : null); continue }
    if (char === '}' || char === ']') { stack.pop(); continue }
    if (char !== '"') continue
    const start = offset
    for (offset++; offset < source.length; offset++) {
      if (source[offset] === '\\') offset++
      else if (source[offset] === '"') break
    }
    let next = offset + 1
    while (/\s/.test(source[next] ?? '') && next < source.length) next++
    const keys = stack.at(-1)
    if (source[next] !== ':' || !keys) continue
    const key = JSON.parse(source.slice(start, offset + 1))
    if (keys.has(key)) return diagnostic(source, start, key, '唯一的对象字段名', `原记录包含重复字段 ${JSON.stringify(key)}，未兼容解析。`)
    keys.add(key)
  }
  return null
}

function completeCase(body) {
  return object(body) && body.format_version === 'behavior-test-case-v1'
    && nonempty(body.case_id) && nonempty(body.title)
    && Array.isArray(body.steps) && body.steps.length > 0
    && body.steps.every(step => object(step) && nonempty(step.action) && nonempty(step.expected))
}

// Projection only. The caller retains record.body verbatim. Normal objects and
// valid JSON objects retain legacy behavior; only broken test_case strings may
// use the single, bounded compatibility rule below.
export function parseRecordBody(record) {
  const raw = record?.body
  if (object(raw)) return { body: raw }
  const testCase = record?.kind === 'test_case'
  const source = typeof raw === 'string' ? raw : ''
  let parseError
  try {
    const parsed = JSON.parse(raw)
    if (object(parsed)) return { body: parsed }
    if (!testCase) return { body: {} }
    return invalid('invalid_root', [diagnostic(source, source.search(/\S/) < 0 ? 0 : source.search(/\S/), source.trimStart()[0] ?? '', 'JSON 对象', '用例正文不是 JSON 对象，未兼容解析。')])
  } catch (error) { parseError = error }
  if (!testCase) return { body: {} }
  // Older case contracts also allowed ordinary prose. Only JSON-shaped text
  // is diagnosed as a broken structured record; prose remains a legacy body.
  if (typeof raw === 'string' && !/^(?:\{|"|\[\s*(?:[\[{"\]\d-]|true\b|false\b|null\b|$)|```(?:json\b|\s*[\[{"])|%(?:7b|5b|22))/i.test(source.trimStart())) return { body: {} }
  const originalDiagnostic = syntaxDiagnostic(source, parseError)
  if (typeof raw !== 'string' || source.trimStart()[0] !== '{') return invalid('invalid_json', [originalDiagnostic])
  if (source.length > RECOVERY_LIMIT) return invalid('recovery_limit', [diagnostic(source, 0, source[0] ?? '', `不超过 ${RECOVERY_LIMIT} 个字符`, '原记录超出兼容解析大小限制；原文保留。')])
  const scan = closingDelimiters(source)
  if (scan.code) return invalid(scan.code, scan.diagnostics)
  if (scan.mismatches.length !== 1) return invalid('invalid_json', [originalDiagnostic])
  const mismatch = scan.mismatches[0]
  const candidate = source.slice(0, mismatch.offset) + mismatch.expected + source.slice(mismatch.offset + 1)
  let body
  try { body = JSON.parse(candidate) } catch { return invalid('invalid_json', [originalDiagnostic]) }
  const duplicate = duplicateKey(candidate)
  if (duplicate) return invalid('duplicate_keys', [duplicate])
  if (!completeCase(body)) return invalid('incomplete_case', [diagnostic(source, mismatch.offset, mismatch.found, mismatch.expected, '单个闭合符替换后仍缺少明确的用例格式、编号、标题或完整步骤，未兼容解析。')])
  return { body, record_parse: { status: 'recovered', code: 'single_closing_delimiter', diagnostics: [
    { ...mismatch, severity: 'warning', message: `展示时将单个错配闭合符 ${mismatch.found} 按 ${mismatch.expected} 兼容解析；原记录正文未修改，未据此改变执行或质量结论。` },
  ] } }
}
