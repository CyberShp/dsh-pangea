const FAULT_TEXT_PATTERN = /(?:故障注入|代码打桩|打桩|注入(?:故障|错误|异常|超时|延迟|测试条件)|模拟[^\n。；]{0,24}(?:失败|超时|断连|掉电|坏块|满|耗尽|异常|错误码|崩溃|重入|竞态)|构造[^\n。；]{0,20}(?:分配失败|内部错误|I\/O\s*错误|网络中断|超时)|fault[-_\s]?inject|\b(?:ENOMEM|EIO|ETIMEDOUT|ENOSPC|ECONNRESET)\b)/i

function flattenText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join('\n')
  if (typeof value === 'object') return Object.values(value).map(flattenText).filter(Boolean).join('\n')
  return String(value)
}

export function caseKeyOf(item) {
  return item?.projection_id || item?.test_case_id || ''
}

export function duplicateCaseKeySet(cases = []) {
  const seen = new Set(), duplicates = new Set()
  for (const item of cases) {
    const key = caseKeyOf(item)
    if (!key) continue
    if (seen.has(key)) duplicates.add(key)
    else seen.add(key)
  }
  return duplicates
}

export function classifyInjectionCandidate(item, duplicateKeys = new Set()) {
  const key = caseKeyOf(item)
  if (!key || duplicateKeys.has(key)) {
    return { key, selectable: false, tier: 'ineligible', label: '身份不唯一', reason: '缺少唯一用例编号或编号重复，暂不可选' }
  }
  const instrumentation = item?.instrumentation || item?.source_record?.body?.instrumentation
  const points = instrumentation?.points
  if (instrumentation || item?.execution_readiness === 'needs_instrumentation') {
    return {
      key,
      selectable: true,
      tier: 'explicit',
      label: '预设桩点',
      reason: Array.isArray(points) && points.length ? `${points.length} 个预设桩点` : '分析阶段已标记需代码打桩',
    }
  }
  const corpus = flattenText([
    item?.title,
    item?.verification_goal,
    item?.readiness_reason,
    item?.missing_execution_conditions,
    item?.preconditions,
    item?.steps,
    item?.step_pairs,
  ])
  const match = corpus.match(FAULT_TEXT_PATTERN)
  if (match) {
    const snippet = match[0].trim().slice(0, 18)
    return { key, selectable: true, tier: 'recommended', label: '建议打桩', reason: `规则识别：含「${snippet}」` }
  }
  if (item?.test_level === 'developer_assisted' || item?.case_type === 'graybox' || item?.case_type === 'developer_assisted') {
    return { key, selectable: true, tier: 'recommended', label: '建议打桩', reason: '灰盒/开发辅助用例，可按需生成桩点' }
  }
  return { key, selectable: true, tier: 'on_demand', label: '可按需打桩', reason: '按需结合源码定位桩点' }
}

function shellQuoteComment(text) {
  return String(text ?? '').replace(/\r?\n/g, ' ').trim()
}

export function buildVerificationShellScript(task) {
  const profiles = Array.isArray(task?.result?.profiles) ? task.result.profiles : []
  const points = Array.isArray(task?.result?.points) ? task.result.points : []
  const pointById = new Map(points.map(point => [point.id, point]))
  const commits = (task?.repositories || []).filter(repo => repo.commit).map(repo => `${repo.repo_id}@${String(repo.commit).slice(0, 12)}`).join(', ')
  const lines = [
    '#!/usr/bin/env bash',
    '# PANGEA 故障注入可执行验证脚本',
    `# 任务名称: ${shellQuoteComment(task?.name || task?.id || '打桩任务')}`,
    `# 任务 ID : ${shellQuoteComment(task?.id || '')}`,
    `# 个人分支: ${shellQuoteComment(task?.branch || '未记录')}${commits ? ` (${commits})` : ''}`,
    '# 用法示例: bash pangea-verify.sh 2>&1 | tee pangea-verify.log',
    '# macOS 默认 bash 3.2 在 C.UTF-8 下会把紧邻中文标点的未加花括号 $VAR 误判进变量名；仅将当前 shell 内部 LC_CTYPE 设为 C，子进程仍保留 UTF-8 LANG',
    'if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then',
    '  if [ -n "${LC_ALL:-}" ]; then export LANG="${LC_ALL}"',
    '  elif [ -z "${LANG:-}" ] && [ -n "${LC_CTYPE:-}" ]; then',
    '    if [ "${LC_CTYPE}" = "UTF-8" ]; then export LANG="en_US.UTF-8"; else export LANG="${LC_CTYPE}"; fi',
    '  fi',
    '  export -n LC_ALL LC_CTYPE 2>/dev/null || true',
    '  LC_ALL=',
    '  LC_CTYPE=C',
    'fi',
    'set -euo pipefail',
    '',
  ]
  if (points.length) {
    lines.push('# --- 桩点清单 ---')
    for (const point of points) {
      lines.push(`# [${shellQuoteComment(point.id)}] ${shellQuoteComment(point.repo_id)}:${shellQuoteComment(point.path)} | 命中特征: ${shellQuoteComment(point.observe || `hit:${point.id}`)}`)
    }
    lines.push('')
  }
  for (const profile of profiles) {
    const caseInfo = (task?.cases || []).find(item => item.case_key === profile.case_key)
    const title = shellQuoteComment(caseInfo?.title || profile.case_key)
    const pointIds = Array.isArray(profile.point_ids) ? profile.point_ids : []
    lines.push(`echo "[PANGEA_CASE_BEGIN] case=${profile.case_key} points=${pointIds.join(',')}"`)
    lines.push(`# 用例: ${title}`)
    for (const pid of pointIds) {
      const pt = pointById.get(pid)
      if (pt?.enable) lines.push(`# 启用 ${pid}: ${shellQuoteComment(pt.enable)}`)
      if (pt?.disable) lines.push(`# 关闭 ${pid}: ${shellQuoteComment(pt.disable)}`)
    }
    const steps = Array.isArray(profile.steps) ? profile.steps : [profile.steps].filter(Boolean)
    for (const step of steps) lines.push(String(step))
    lines.push(`echo "[PANGEA_CASE_END] case=${profile.case_key} status=0"`)
    lines.push('')
  }
  return lines.join('\n')
}

function countOccurrences(haystack, needle) {
  if (!needle || !haystack) return 0
  let count = 0, offset = 0
  while (true) {
    const idx = haystack.indexOf(needle, offset)
    if (idx < 0) break
    count += 1
    offset = idx + needle.length
  }
  return count
}

const FAILURE_SIGNAL = /(?:FAIL(?:ED)?\b|AssertionError|Traceback|Segmentation fault|PANIC\b|ERROR:\s*assertion)/i
const ZERO_TESTS_SIGNAL = /(?:\[\s*PASSED\s*\]\s*0 tests\b|0 tests from 0 test suites ran|No tests were found)/i

function countPointHitsInLines(lines, points) {
  const bodyLines = lines.filter(line => !/^\[PANGEA_(?:CASE_BEGIN|CASE_END|VERIFY)\]/.test(line.trim()))
  const body = bodyLines.join('\n')
  const counts = new Map(), samples = []
  for (const point of points) {
    if (!point?.id) continue
    let count = 0
    const observe = typeof point.observe === 'string' ? point.observe.trim() : ''
    if (observe) count = countOccurrences(body, observe)
    if (!count) count = countOccurrences(body, `hit:${point.id}`)
    if (!count) {
      const kvRegex = new RegExp(`(?:^|[\\s,;\\[\\(])${point.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(\\d+)`, 'g')
      let match
      while ((match = kvRegex.exec(body)) !== null) count = Math.max(count, Number(match[1]))
    }
    if (count > 0) {
      counts.set(point.id, count)
      const sample = bodyLines.find(line => (observe && line.includes(observe)) || line.includes(`hit:${point.id}`) || line.includes(`${point.id}=`))
      if (sample && samples.length < 4) samples.push(sample.trim())
    }
  }
  return { counts, samples }
}

export function parseVerificationLog(logText, task) {
  const raw = String(logText ?? '')
  if (!raw.trim() || !task) return { entries: [], matchedCount: 0 }
  const points = Array.isArray(task?.result?.points) ? task.result.points : []
  const profiles = Array.isArray(task?.result?.profiles) ? task.result.profiles : []
  const caseKeys = Array.isArray(task?.case_keys) && task.case_keys.length ? task.case_keys : profiles.map(item => item.case_key).filter(Boolean)
  const structuredByCase = new Map()
  const sectionsByCase = new Map()
  const begunCases = new Set()
  const endedCases = new Set()
  const rawLines = raw.split(/\r?\n/)
  let activeCase = null
  for (const line of rawLines) {
    const beginMatch = line.match(/\[PANGEA_CASE_BEGIN\]\s+case=(\S+)/)
    if (beginMatch) {
      activeCase = beginMatch[1]
      begunCases.add(activeCase)
      if (!sectionsByCase.has(activeCase)) sectionsByCase.set(activeCase, [])
      continue
    }
    const endMatch = line.match(/\[PANGEA_CASE_END\]\s+case=(\S+)/)
    if (endMatch) {
      endedCases.add(endMatch[1])
      if (activeCase === endMatch[1]) activeCase = null
      continue
    }
    const verifyMatch = line.match(/\[PANGEA_VERIFY\]\s+case=(\S+)(?:\s+result=(passed|failed|not_triggered|not_run))?(?:\s+hits=(.+))?/)
    if (verifyMatch) {
      structuredByCase.set(verifyMatch[1], {
        result: verifyMatch[2] || 'passed',
        hits: (verifyMatch[3] || '').trim(),
        line: line.trim(),
      })
      continue
    }
    if (activeCase) sectionsByCase.get(activeCase).push(line)
  }
  const globalHits = begunCases.size === 0 ? countPointHitsInLines(rawLines, points) : null
  const entries = []
  for (const caseKey of caseKeys) {
    const structured = structuredByCase.get(caseKey)
    const sectionLines = sectionsByCase.get(caseKey)
    const scopedLines = sectionLines ?? (begunCases.size === 0 ? rawLines : [])
    const scopedText = scopedLines.join('\n')
    const { counts: pointHitCounts, samples: matchedLines } = sectionLines
      ? countPointHitsInLines(sectionLines, points)
      : (globalHits ?? { counts: new Map(), samples: [] })
    const hasFailureSignal = FAILURE_SIGNAL.test(scopedText)
    const hasZeroTests = ZERO_TESTS_SIGNAL.test(scopedText)
    const profile = profiles.find(item => item.case_key === caseKey)
    const expectedPointIds = Array.isArray(profile?.point_ids) && profile.point_ids.length
      ? profile.point_ids
      : points.filter(pt => !Array.isArray(pt.case_keys) || pt.case_keys.includes(caseKey)).map(pt => pt.id)
    const observedPairs = expectedPointIds
      .filter(pid => pointHitCounts.has(pid))
      .map(pid => `${pid}=${pointHitCounts.get(pid)}`)
    const zeroTestLine = hasZeroTests ? scopedLines.find(line => ZERO_TESTS_SIGNAL.test(line))?.trim() : null
    const hits = hasZeroTests ? '' : (structured?.hits || observedPairs.join(', '))
    let result = hasZeroTests ? 'not_triggered' : (structured?.result || '')
    if (!result) {
      if (observedPairs.length > 0) result = hasFailureSignal ? 'failed' : 'passed'
      else if (begunCases.has(caseKey) || endedCases.has(caseKey)) result = hasFailureSignal ? 'failed' : 'not_triggered'
    }
    if (!result && !hits) continue
    const excerptLines = [zeroTestLine, structured?.line, ...matchedLines].filter(Boolean)
    entries.push({
      case_key: caseKey,
      result: result || 'passed',
      hits: hits || (expectedPointIds.length ? expectedPointIds.map(pid => `${pid}=0`).join(', ') : ''),
      notes: hasZeroTests
        ? `检测到 0 条测试实际执行（未触发桩点）：\n${zeroTestLine}`
        : excerptLines.length ? `日志自动识别：\n${[...new Set(excerptLines)].slice(0, 3).join('\n')}` : '由执行日志自动解析填入',
    })
  }
  return { entries, matchedCount: entries.length }
}
