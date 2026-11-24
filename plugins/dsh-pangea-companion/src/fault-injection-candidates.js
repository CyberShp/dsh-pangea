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
  const verificationStatus = item?.verification_status || item?.source_record?.body?.verification_status
  if (verificationStatus === 'needs_runtime_verification') {
    return {
      key,
      selectable: true,
      tier: 'explicit',
      label: Array.isArray(points) && points.length ? `待动态实锤 · ${points.length} 桩点` : '待动态实锤风险',
      reason: item?.runtime_uncertainty || (Array.isArray(points) && points.length ? `风险分析已锁定 ${points.length} 个运行时验证桩点` : '风险分析标记需运行时故障注入/拉窗实锤'),
    }
  }
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

export function extractRiskInjectionCandidates(risks = []) {
  return (Array.isArray(risks) ? risks : [])
    .filter(risk => (risk?.verification_status || risk?.source_record?.body?.verification_status) === 'needs_runtime_verification')
    .map(risk => {
      const key = risk.projection_id || risk.risk_id || risk.display_id || ''
      return {
        ...risk,
        projection_id: key,
        execution_readiness: 'needs_instrumentation',
        classification: classifyInjectionCandidate({ ...risk, projection_id: key }),
      }
    })
}

export const DELIVERY_MODES = Object.freeze(['product_package', 'unit_test'])
export const BUILD_VARIANTS = Object.freeze(['debug', 'hitest'])

export const DELIVERY_MODE_LABELS = Object.freeze({
  product_package: '产品包 / 目标环境替换',
  unit_test: '仓内单元测试（GTest）',
})

export const BUILD_VARIANT_LABELS = Object.freeze({
  debug: '正常 debug',
  hitest: 'hitest 精准',
})

export const ARTIFACT_KIND_LABELS = Object.freeze({
  static_lib: '静态库',
  shared_lib: '动态库',
  kernel_module: '内核模块',
  executable: '可执行文件',
  script: '脚本 / 配置',
  other: '其他产物',
})

export function normalizeDeliveryMode(value) {
  return value === 'unit_test' ? 'unit_test' : 'product_package'
}

export function normalizeBuildVariant(value) {
  return value === 'hitest' ? 'hitest' : 'debug'
}

export function normalizeReplaceFiles(items = []) {
  if (!Array.isArray(items)) return []
  const result = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const artifact = typeof item.artifact === 'string' ? item.artifact.trim() : ''
    if (!artifact) continue
    const kind = typeof item.kind === 'string' && Object.hasOwn(ARTIFACT_KIND_LABELS, item.kind.trim())
      ? item.kind.trim()
      : 'other'
    const sourceFiles = Array.isArray(item.source_files)
      ? [...new Set(item.source_files.map(file => typeof file === 'string' ? file.trim().replaceAll('\\', '/') : '').filter(Boolean))]
      : []
    result.push({
      artifact,
      kind,
      source_files: sourceFiles,
      build_evidence: typeof item.build_evidence === 'string' ? item.build_evidence.trim() : '',
      post_replace_action: typeof item.post_replace_action === 'string' ? item.post_replace_action.trim() : '',
    })
  }
  return result
}

export function extractMarkerStrings(taskOrDelivery) {
  const delivery = taskOrDelivery?.result?.delivery ?? taskOrDelivery?.delivery ?? taskOrDelivery
  const explicit = Array.isArray(delivery?.marker_strings)
    ? delivery.marker_strings.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : []
  if (explicit.length) return [...new Set(explicit)]
  const points = Array.isArray(taskOrDelivery?.result?.points) ? taskOrDelivery.result.points : []
  return [...new Set(points.map(point => typeof point?.observe === 'string' ? point.observe.trim() : '').filter(item => item.length >= 4))]
}

export function mergeReplaceFilesFromTasks(tasks = []) {
  const byArtifact = new Map()
  const markers = new Set()
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const taskName = task?.name || task?.id || ''
    const replaceFiles = normalizeReplaceFiles(task?.replace_files ?? task?.result?.delivery?.replace_files)
    for (const item of replaceFiles) {
      const existing = byArtifact.get(item.artifact)
      if (!existing) {
        byArtifact.set(item.artifact, {
          ...item,
          task_names: taskName ? [taskName] : [],
        })
      } else {
        existing.source_files = [...new Set([...existing.source_files, ...item.source_files])]
        if (item.build_evidence && !existing.build_evidence.includes(item.build_evidence)) {
          existing.build_evidence = existing.build_evidence ? `${existing.build_evidence}；${item.build_evidence}` : item.build_evidence
        }
        if (item.post_replace_action && !existing.post_replace_action.includes(item.post_replace_action)) {
          existing.post_replace_action = existing.post_replace_action ? `${existing.post_replace_action}；${item.post_replace_action}` : item.post_replace_action
        }
        if (taskName && !existing.task_names.includes(taskName)) existing.task_names.push(taskName)
      }
    }
    for (const marker of Array.isArray(task?.marker_strings) ? task.marker_strings : extractMarkerStrings(task)) {
      if (typeof marker === 'string' && marker.trim()) markers.add(marker.trim())
    }
  }
  return { replace_files: [...byArtifact.values()], marker_strings: [...markers] }
}

const shellSingleQuote = text => `'${String(text ?? '').replace(/'/g, "'\\''")}'`

export function buildArtifactVerifyCommands(taskOrDelivery, variant = null) {
  const effectiveVariant = normalizeBuildVariant(variant ?? taskOrDelivery?.build_variant)
  const markers = extractMarkerStrings(taskOrDelivery)
  const replaceFiles = normalizeReplaceFiles(
    taskOrDelivery?.replace_files ?? taskOrDelivery?.result?.delivery?.replace_files,
  )
  const quotedMarkers = markers.map(shellSingleQuote).join(' ')
  const quotedArtifacts = (replaceFiles.length ? replaceFiles.map(item => item.artifact) : ['<目标静态库或模块路径>'])
    .map(shellSingleQuote)
    .join(' ')
  const preReplaceCmd = markers.length
    ? `set -- ${quotedArtifacts}; for f in "$@"; do [ -f "$f" ] || { echo "NOT_FOUND: $f" >&2; exit 2; }; done; for m in ${quotedMarkers}; do found=0; for f in "$@"; do grep -aFq -- "$m" "$f" && found=1 && break; done; [ "$found" -eq 1 ] && echo "OK: $m" || { echo "MISSING: $m" >&2; exit 2; }; done; for f in "$@"; do hit=0; for m in ${quotedMarkers}; do grep -aFq -- "$m" "$f" && hit=1 && break; done; [ "$hit" -eq 1 ] || { echo "NO_STUB_IN_ARTIFACT: $f" >&2; exit 2; }; done`
    : ''
  const postDeployCmd = markers.length
    ? `target="<最终部署并运行的宿主二进制或模块路径>"; [ -f "$target" ] || { echo "NOT_FOUND: $target" >&2; exit 2; }; for m in ${quotedMarkers}; do grep -aFq -- "$m" "$target" && echo "OK: $m" || { echo "MISSING: $m" >&2; exit 2; }; done`
    : ''
  const safeRelinkCmd = markers.length
    ? `PANGEA_RELINK_ONLY=1 PANGEA_VERIFY_ARTIFACTS=${shellSingleQuote(replaceFiles.length ? replaceFiles.map(item => item.artifact).join(' ') : '<目标静态库路径>')} PANGEA_RELINK_CMD='<环境重链脚本命令>' PANGEA_VERIFY_FINAL_BINARY='<运行目录/宿主进程二进制>' bash pangea-verify.sh`
    : ''
  const variantHint = effectiveVariant === 'hitest'
    ? '当前目标变体为「hitest 精准」：若大包已含完整精准变体宿主二进制，优先直接替换运行目录内的预置精准变体与宿主二进制；若仅替换 .a 后盒内重链，请直接使用下方「PANGEA 安全重链代理命令」（无需修改环境重链脚本即可自动注入传递库解析并隔离旧预置变体覆盖）。'
    : '当前目标变体为「正常 debug」：若需在盒内执行重链脚本，请直接使用下方「PANGEA 安全重链代理命令」（无需修改环境重链脚本即可捕获被吞掉的 ld 错误码、补齐传递钩子库解析并拦截预置精准变体尾部覆盖）。'
  return {
    variant: effectiveVariant,
    variant_label: BUILD_VARIANT_LABELS[effectiveVariant],
    variant_hint: variantHint,
    markers,
    replace_files: replaceFiles,
    pre_replace_cmd: preReplaceCmd,
    post_deploy_cmd: postDeployCmd,
    safe_relink_cmd: safeRelinkCmd,
  }
}

function shellQuoteComment(text) {
  return String(text ?? '').replace(/\r?\n/g, ' ').trim()
}

export function buildVerificationShellScript(task, { buildVariant = null } = {}) {
  const profiles = Array.isArray(task?.result?.profiles) ? task.result.profiles : []
  const points = Array.isArray(task?.result?.points) ? task.result.points : []
  const pointById = new Map(points.map(point => [point.id, point]))
  const commitItems = Array.isArray(task?.build?.commits) && task.build.commits.length
    ? task.build.commits
    : Array.isArray(task?.latest_build?.commits) && task.latest_build.commits.length
      ? task.latest_build.commits
      : (task?.repositories || []).filter(repo => repo.commit)
  const commits = commitItems.map(repo => `${repo.repo_id}@${String(repo.commit).slice(0, 12)}`).join(', ')
  const branchLabel = task?.latest_build?.branch || task?.branch || '未记录'
  const deliveryMode = normalizeDeliveryMode(task?.delivery_mode ?? task?.result?.delivery?.mode)
  const effectiveVariant = normalizeBuildVariant(buildVariant ?? task?.build_variant)
  const delivery = task?.result?.delivery
  const replaceFiles = normalizeReplaceFiles(delivery?.replace_files)
  const markerStrings = extractMarkerStrings(task)
  const lines = [
    '#!/usr/bin/env bash',
    '# PANGEA 故障注入可执行验证脚本',
    `# 任务名称: ${shellQuoteComment(task?.name || task?.id || '打桩任务')}`,
    `# 任务 ID : ${shellQuoteComment(task?.id || '')}`,
    `# 交付形态: ${DELIVERY_MODE_LABELS[deliveryMode]} | 目标变体: ${BUILD_VARIANT_LABELS[effectiveVariant]}`,
    `# 个人分支: ${shellQuoteComment(branchLabel)}${commits ? ` (${commits})` : ''}`,
    '# 用法示例: bash pangea-verify.sh 2>&1 | tee pangea-verify.log',
    ...(markerStrings.length ? [
      '# 前置组件库核验: PANGEA_VERIFY_ARTIFACTS="/path/to/libA.a /path/to/libB.a" bash pangea-verify.sh',
      '# 前置宿主二进制核验: PANGEA_VERIFY_FINAL_BINARY="/path/to/host_bin" bash pangea-verify.sh',
      '# 零侵入安全重链(防F3/F4): PANGEA_RELINK_ONLY=1 PANGEA_RELINK_CMD="/path/to/relink.sh" PANGEA_VERIFY_FINAL_BINARY="/path/to/host_bin" bash pangea-verify.sh',
    ] : []),
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
  if (replaceFiles.length || delivery?.build_requirement) {
    lines.push('# --- 交付前提与应单独替换文件 ---')
    if (delivery?.build_requirement) lines.push(`# 构建前提: ${shellQuoteComment(delivery.build_requirement)}`)
    for (const item of replaceFiles) {
      lines.push(`# 替换产物: ${shellQuoteComment(item.artifact)} (${ARTIFACT_KIND_LABELS[item.kind] || item.kind}) <- ${shellQuoteComment(item.source_files.join(', '))}${item.post_replace_action ? ` | ${shellQuoteComment(item.post_replace_action)}` : ''}`)
    }
    lines.push('')
  }
  if (markerStrings.length) {
    const quotedMarkers = markerStrings.map(shellSingleQuote).join(' ')
    lines.push(
      '__pangea_check_artifact_set() {',
      '  local __f __m __hit __found',
      '  for __f in "$@"; do',
      '    if [ ! -f "$__f" ]; then',
      '      printf \'[PANGEA_ARTIFACT_CHECK] FAILED: artifact not found: %s\\n\' "$__f" >&2',
      '      exit 2',
      '    fi',
      '  done',
      `  for __m in ${quotedMarkers}; do`,
      '    __found=0',
      '    for __f in "$@"; do',
      '      if grep -aFq -- "$__m" "$__f"; then __found=1; break; fi',
      '    done',
      '    if [ "$__found" -ne 1 ]; then',
      '      printf \'[PANGEA_ARTIFACT_CHECK] FAILED: missing stub marker "%s" across [%s] (check build config / hitest overwrite)\\n\' "$__m" "$*" >&2',
      '      exit 2',
      '    fi',
      '  done',
      '  for __f in "$@"; do',
      '    __hit=0',
      `    for __m in ${quotedMarkers}; do`,
      '      if grep -aFq -- "$__m" "$__f"; then __hit=1; break; fi',
      '    done',
      '    if [ "$__hit" -ne 1 ]; then',
      '      printf \'[PANGEA_ARTIFACT_CHECK] FAILED: no stub marker found in %s (check build config / hitest overwrite)\\n\' "$__f" >&2',
      '      exit 2',
      '    fi',
      '  done',
      '  printf \'[PANGEA_ARTIFACT_CHECK] OK: %s\\n\' "$*"',
      '}',
      '__pangea_safe_relink() {',
      '  local __relink_cmd="$1" __final="$2" __rundir __qdir __shim __rcfile __pat __cand __qf __tool __real __relink_rc=0 __ld_err=""',
      '  if [ -z "$__final" ]; then',
      '    printf \'[PANGEA_SAFE_RELINK] FAILED: PANGEA_VERIFY_FINAL_BINARY is required when PANGEA_RELINK_CMD is set\\n\' >&2',
      '    exit 2',
      '  fi',
      '  __rundir="$(dirname "$__final")"',
      '  __qdir="$__rundir/.pangea_quarantine_$$"',
      '  __shim="$(mktemp -d "${TMPDIR:-/tmp}/pangea-ld-shim.XXXXXX")"',
      '  __rcfile="$__shim/ld.rc"',
      '  __pangea_restore_relink_env() {',
      '    if [ -d "$__qdir" ]; then',
      '      for __qf in "$__qdir"/*; do',
      '        [ -e "$__qf" ] || continue',
      '        if [ "$__rundir/$(basename "$__qf")" != "$__final" ]; then',
      '          mv -f -- "$__qf" "$__rundir/$(basename "$__qf")"',
      '        fi',
      '      done',
      '      rm -rf -- "$__qdir"',
      '    fi',
      '    [ -n "${__shim:-}" ] && rm -rf -- "$__shim"',
      '  }',
      '  trap \'__pangea_restore_relink_env\' EXIT INT TERM',
      '  mkdir -p -- "$__qdir"',
      '  # F4 guard: temporarily quarantine pre-baked hitest/variant binaries in run_dir so unmodified relink script reaches else: mv new_bin -> final',
      '  set -f',
      '  # shellcheck disable=SC2086',
      '  set -- ${PANGEA_PREBAKED_GLOB:-*hitest* *精准*}',
      '  set +f',
      '  for __pat in "$@"; do',
      '    for __cand in "$__rundir"/$__pat; do',
      '      [ -f "$__cand" ] || continue',
      '      [ "$__cand" = "$__final" ] && continue',
      '      mv -f -- "$__cand" "$__qdir/$(basename "$__cand")"',
      '      printf \'[PANGEA_SAFE_RELINK] quarantined prebaked binary during relink: %s\\n\' "$__cand"',
      '    done',
      '  done',
      '  # F3 + swallowed-rc guard: transparent compiler/linker shim adding --copy-dt-needed-entries and recording non-zero linker exit codes',
      '  for __tool in gcc g++ cc c++ ld; do',
      '    __real="$(PATH="$PATH" command -v "$__tool" 2>/dev/null || true)"',
      '    [ -n "$__real" ] || continue',
      '    if [ "$__tool" = "ld" ]; then',
      '      cat > "$__shim/$__tool" <<EOF',
      '#!/usr/bin/env bash',
      '"$__real" --copy-dt-needed-entries --no-as-needed "\\$@"',
      '__rc=\\$?',
      '[ "\\$__rc" -ne 0 ] && printf "%s:%s\\\\n" "$__tool" "\\$__rc" >> "$__rcfile"',
      'exit "\\$__rc"',
      'EOF',
      '    else',
      '      cat > "$__shim/$__tool" <<EOF',
      '#!/usr/bin/env bash',
      '__link=1',
      'for __a in "\\$@"; do',
      '  case "\\$__a" in -c|-E|-S|-v|--version|-M|-MM) __link=0; break ;; esac',
      'done',
      'if [ "\\$__link" -eq 1 ]; then',
      '  "$__real" -Wl,--copy-dt-needed-entries,--no-as-needed "\\$@"',
      'else',
      '  "$__real" "\\$@"',
      'fi',
      '__rc=\\$?',
      '[ "\\$__rc" -ne 0 ] && printf "%s:%s\\\\n" "$__tool" "\\$__rc" >> "$__rcfile"',
      'exit "\\$__rc"',
      'EOF',
      '    fi',
      '    chmod +x "$__shim/$__tool"',
      '  done',
      '  set +e',
      '  PATH="$__shim:$PATH" LDFLAGS="${LDFLAGS:-} -Wl,--copy-dt-needed-entries,--no-as-needed" bash -c "$__relink_cmd"',
      '  __relink_rc=$?',
      '  set -e',
      '  [ -s "$__rcfile" ] && __ld_err="$(tr \'\\n\' \' \' < "$__rcfile")"',
      '  __pangea_restore_relink_env',
      '  trap - EXIT INT TERM',
      '  if [ "$__relink_rc" -ne 0 ] || [ -n "$__ld_err" ]; then',
      '    printf \'[PANGEA_SAFE_RELINK] FAILED: relink_rc=%d linker_errors=[%s]\\n\' "$__relink_rc" "$__ld_err" >&2',
      '    exit 2',
      '  fi',
      '  __pangea_check_artifact_set "$__final"',
      '  printf \'[PANGEA_SAFE_RELINK] OK: relinked and verified %s\\n\' "$__final"',
      '}',
      'if [ -n "${PANGEA_VERIFY_ARTIFACTS:-}" ]; then',
      '  # shellcheck disable=SC2086',
      '  __pangea_check_artifact_set $PANGEA_VERIFY_ARTIFACTS',
      'fi',
      'if [ -n "${PANGEA_RELINK_CMD:-}" ]; then',
      '  __pangea_safe_relink "$PANGEA_RELINK_CMD" "${PANGEA_VERIFY_FINAL_BINARY:-}"',
      '  if [ "${PANGEA_RELINK_ONLY:-0}" = "1" ]; then exit 0; fi',
      'elif [ -n "${PANGEA_VERIFY_FINAL_BINARY:-}" ]; then',
      '  __pangea_check_artifact_set "$PANGEA_VERIFY_FINAL_BINARY"',
      'fi',
      '',
    )
  }
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
    // Old saved tasks retain their original export; v2 generation requires safety.
    const safety = profile.safety
    if (task?.generation_contract_version >= 2 && !safety) throw new Error('缺少安全验证合同，请重新生成')
    if (safety) {
      const quote = text => "'" + String(text).replace(/'/g, "'\\''") + "'"
      lines.push(
        `trap 'kill -TERM "$__pangea_case_pid" 2>/dev/null || true; wait "$__pangea_case_pid" || true; exit 130' INT`,
        `trap 'kill -TERM "$__pangea_case_pid" 2>/dev/null || true; wait "$__pangea_case_pid" || true; exit 143' TERM`,
        '(',
        '__pangea_finish() {',
        '  local primary=$1 cleanup_status=0 verify_status=0 final_status',
        '  trap - EXIT INT TERM',
        '  set +e',
        '  ( set -euo pipefail',
        ...safety.cleanup,
        '  )',
        '  cleanup_status=$?',
        '  ( set -euo pipefail',
        ...safety.cleanup_verify,
        '  )',
        '  verify_status=$?',
        '  final_status=$primary',
        '  if [ "$final_status" -eq 0 ] && { [ "$cleanup_status" -ne 0 ] || [ "$verify_status" -ne 0 ]; }; then final_status=125; fi',
        `  printf '[PANGEA_CLEANUP] case=%s cleanup=%s verify=%s\\n' ${quote(profile.case_key)} "$cleanup_status" "$verify_status"`,
        `  printf '[PANGEA_CASE_END] case=%s status=%s\\n' ${quote(profile.case_key)} "$final_status"`,
        '  exit "$final_status"',
        '}',
        `trap '__pangea_finish "$?"' EXIT`,
        `trap 'exit 130' INT`,
        `trap 'exit 143' TERM`,
        ...safety.setup,
        ...safety.negative_steps)
    }
    const steps = Array.isArray(profile.steps) ? profile.steps : [profile.steps].filter(Boolean)
    for (const step of steps) {
      const text = String(step)
      if (text.trim()) lines.push(text)
    }
    if (safety) lines.push(') &', '__pangea_case_pid=$!', 'wait "$__pangea_case_pid"', 'trap - INT TERM')
    else lines.push(`echo "[PANGEA_CASE_END] case=${profile.case_key} status=0"`)
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
  const failedCases = new Set(), cleanupCases = new Set()
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
      const status = line.match(/\bstatus=(-?\d+)\b/)
      if ((status && Number(status[1]) !== 0) || (!status && task.generation_contract_version >= 2)) failedCases.add(endMatch[1])
      if (activeCase === endMatch[1]) activeCase = null
      continue
    }
    const cleanupMatch = line.match(/\[PANGEA_CLEANUP\]\s+case=(\S+)\s+cleanup=(-?\d+)\s+verify=(-?\d+)/)
    if (cleanupMatch) {
      cleanupCases.add(cleanupMatch[1])
      if (Number(cleanupMatch[2]) !== 0 || Number(cleanupMatch[3]) !== 0) failedCases.add(cleanupMatch[1])
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
    const incompleteSafety = task.generation_contract_version >= 2
      && (begunCases.has(caseKey) || structured || observedPairs.length > 0) && (!endedCases.has(caseKey) || !cleanupCases.has(caseKey))
    if (failedCases.has(caseKey) || incompleteSafety) result = 'failed'
    if (!result && !hits) continue
    const excerptLines = [zeroTestLine, structured?.line, ...matchedLines].filter(Boolean)
    entries.push({
      case_key: caseKey,
      result: result || 'passed',
      hits: hits || (expectedPointIds.length ? expectedPointIds.map(pid => `${pid}=0`).join(', ') : ''),
      notes: failedCases.has(caseKey) || incompleteSafety
        ? '执行退出码非零、清理失败或缺少完整退出清理记录；不能判为通过'
        : hasZeroTests
        ? `检测到 0 条测试实际执行（未触发桩点）：\n${zeroTestLine}`
        : excerptLines.length ? `日志自动识别：\n${[...new Set(excerptLines)].slice(0, 3).join('\n')}` : '由执行日志自动解析填入',
    })
  }
  return { entries, matchedCount: entries.length }
}

export const MULTILINE_GATE_COMMIT_TEMPLATE = '【问题单号/AR/STORY/CR】：{issue}\n【修改人】：{author}\n【审核人】：{reviewer}\n【修改说明】：{summary}'
export const SINGLELINE_GATE_COMMIT_TEMPLATE = '【问题单号/AR/STORY/CR】：{issue} 【修改人】：{author} 【审核人】：{reviewer} 【修改说明】：{summary}'
export const DEFAULT_INTRANET_COMMIT_REGEX = '^(\\s*【问题单号\\/AR\\/STORY\\/CR】[:：]\\s*((SR\\d{14}|AR\\d{14}|DTS\\d{13}|DTS\\d{8}\\w{11})[;；]*)+([^\\diISAD;；].*)*\\s+【修改人】[:：]\\s*.+\\s+【审核人】[:：]\\s*.+\\s+【修改说明】[:：]\\s*.+\\s*)+$'

const LEGACY_MULTILINE_GATE_TEMPLATE = '【问题单号/AR/STORY/CR】{issue}\n【修改人】{author}\n【审核人】{reviewer}\n【修改说明】{summary}'
const LEGACY_SINGLELINE_GATE_TEMPLATE = '【问题单号/AR/STORY/CR】{issue} 【修改人】{author} 【审核人】{reviewer} 【修改说明】{summary}'

const EMPTY_GATE_FIELD = /(?:^\s*【([^】\r\n]+)】\s*[:：]?\s*$|【(问题单号[^】\r\n]*|(?:AR|STORY|CR|DTS)[^】\r\n]*|修改人|审核人|修改说明|提交人|检视人)】\s*[:：]?\s*(?=\r?\n|$|【))/mu

const LINEAR_WS = new Set([' ', '\t', '\n', '\r', '\v', '\f', '\u00a0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff'])
const LINEAR_LINE_TERM = new Set(['\n', '\r', '\u2028', '\u2029'])
const isAsciiDigit = c => c >= '0' && c <= '9'
const isAsciiWord = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_'
const linearRegexCache = new Map()

export function normalizeRegexPattern(value) {
  if (typeof value !== 'string') return ''
  let trimmed = value.replace(/\0/g, '').replace(/\r?\n/g, '').trim().slice(0, 1000)
  if (trimmed.length >= 4 && ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"')))) {
    const inner = trimmed.slice(1, -1).trim()
    if (inner.startsWith('^') || inner.endsWith('$')) trimmed = inner
  }
  return trimmed
}

export function extractRemoteHookRegex(errorText) {
  if (typeof errorText !== 'string' || !errorText) return ''
  const singleQuoted = errorText.match(/'(\^[^'\r\n]{4,950}\$)'/)
  if (singleQuoted) return normalizeRegexPattern(singleQuoted[1])
  const doubleQuoted = errorText.match(/"(\^[^"\r\n]{4,950}\$)"/)
  if (doubleQuoted) return normalizeRegexPattern(doubleQuoted[1])
  const bare = errorText.match(/(\^\(\\s\*【问题单号[^\r\n]{4,950}\$)/)
  if (bare) return normalizeRegexPattern(bare[1])
  return ''
}

function compilePatternMatcher(rawPattern) {
  if (linearRegexCache.has(rawPattern)) return linearRegexCache.get(rawPattern)
  let pattern = rawPattern, ignoreCase = false, multiline = false, dotAll = false
  const flagMatch = pattern.match(/^\(\?([ims]+)\)/)
  if (flagMatch) {
    if (flagMatch[1].includes('i')) ignoreCase = true
    if (flagMatch[1].includes('m')) multiline = true
    if (flagMatch[1].includes('s')) dotAll = true
    pattern = pattern.slice(flagMatch[0].length)
  }
  const v8Flags = `u${ignoreCase ? 'i' : ''}${multiline ? 'm' : ''}${dotAll ? 's' : ''}`
  const v8Regex = new RegExp(pattern, v8Flags)

  const chars = Array.from(pattern)
  let pos = 0, aborted = false
  const states = []
  const newState = (op, extra = {}) => {
    if (states.length > 4096) { aborted = true; return 0 }
    const id = states.length
    states.push({ id, op, out: [], ...extra })
    return id
  }
  const matchChar = target => {
    if (!ignoreCase) return ch => ch === target
    const folded = target.toLowerCase()
    return ch => ch === target || ch.toLowerCase() === folded
  }

  function readEscape() {
    const c = chars[pos++]
    if (c === undefined) return null
    if (c === 'd') return { kind: 'pred', fn: isAsciiDigit }
    if (c === 'D') return { kind: 'pred', fn: x => !isAsciiDigit(x) }
    if (c === 'w') return { kind: 'pred', fn: isAsciiWord }
    if (c === 'W') return { kind: 'pred', fn: x => !isAsciiWord(x) }
    if (c === 's') return { kind: 'pred', fn: x => LINEAR_WS.has(x) }
    if (c === 'S') return { kind: 'pred', fn: x => !LINEAR_WS.has(x) }
    if (c === 'b') return { kind: 'assert', mode: 'wb' }
    if (c === 'B') return { kind: 'assert', mode: 'nwb' }
    if (c >= '1' && c <= '9') return null
    if (c === 'n') return { kind: 'char', ch: '\n' }
    if (c === 'r') return { kind: 'char', ch: '\r' }
    if (c === 't') return { kind: 'char', ch: '\t' }
    if (c === 'v') return { kind: 'char', ch: '\v' }
    if (c === 'f') return { kind: 'char', ch: '\f' }
    if (c === '0') return { kind: 'char', ch: '\0' }
    if (c === 'x') {
      const hex = chars.slice(pos, pos + 2).join(''); pos += 2
      return { kind: 'char', ch: String.fromCodePoint(parseInt(hex, 16)) }
    }
    if (c === 'u') {
      if (chars[pos] === '{') {
        const end = chars.indexOf('}', pos + 1)
        const hex = chars.slice(pos + 1, end).join(''); pos = end + 1
        return { kind: 'char', ch: String.fromCodePoint(parseInt(hex, 16)) }
      }
      const hex = chars.slice(pos, pos + 4).join(''); pos += 4
      return { kind: 'char', ch: String.fromCodePoint(parseInt(hex, 16)) }
    }
    if (c === 'p' || c === 'P') return null
    return { kind: 'char', ch: c }
  }

  function parseClass() {
    let negate = false
    if (chars[pos] === '^') { negate = true; pos++ }
    const items = []
    while (pos < chars.length && chars[pos] !== ']') {
      let first
      if (chars[pos] === '\\') { pos++; first = readEscape(); if (!first || first.kind === 'assert') return null }
      else first = { kind: 'char', ch: chars[pos++] }
      if (first.kind === 'char' && chars[pos] === '-' && pos + 1 < chars.length && chars[pos + 1] !== ']') {
        const save = pos; pos++
        let second
        if (chars[pos] === '\\') { pos++; second = readEscape(); if (!second) return null }
        else second = { kind: 'char', ch: chars[pos++] }
        if (second.kind === 'char') {
          const lo = first.ch.codePointAt(0), hi = second.ch.codePointAt(0)
          const inRange = c => { const cp = c.codePointAt(0); return cp >= lo && cp <= hi }
          items.push(ignoreCase ? ch => inRange(ch) || inRange(ch.toLowerCase()) || inRange(ch.toUpperCase()) : inRange)
          continue
        }
        pos = save
      }
      items.push(first.kind === 'char' ? matchChar(first.ch) : first.fn)
    }
    pos++
    const matchFn = ch => {
      const hit = items.some(fn => fn(ch))
      return negate ? !hit : hit
    }
    return () => { const s = newState('pred', { fn: matchFn }), e = newState('eps'); states[s].out.push(e); return { start: s, end: e } }
  }

  function repeatFrag(factory, min, max) {
    if (aborted || (max !== Infinity && max > 256) || min > 256) return null
    const start = newState('eps')
    let cur = start
    for (let i = 0; i < min; i++) {
      const f = factory()
      if (!f || aborted) return null
      states[cur].out.push(f.start)
      cur = f.end
    }
    if (max === Infinity) {
      const loop = newState('eps'), after = newState('eps')
      const f = factory()
      if (!f || aborted) return null
      states[cur].out.push(loop)
      states[loop].out.push(f.start, after)
      states[f.end].out.push(loop)
      return { start, end: after }
    }
    const after = newState('eps')
    for (let i = min; i < max; i++) {
      const f = factory()
      if (!f || aborted) return null
      states[cur].out.push(f.start, after)
      cur = f.end
    }
    states[cur].out.push(after)
    return { start, end: after }
  }

  function parseAtom() {
    const c = chars[pos]
    if (c === '(') {
      pos++
      if (chars[pos] === '?') {
        if (chars[pos + 1] === ':') pos += 2
        else return null
      }
      const inner = parseAlt()
      if (!inner || chars[pos] !== ')') return null
      pos++
      return inner
    }
    if (c === '[') { pos++; return parseClass() }
    if (c === '.') {
      pos++
      const fn = dotAll ? () => true : ch => !LINEAR_LINE_TERM.has(ch)
      return () => { const s = newState('pred', { fn }), e = newState('eps'); states[s].out.push(e); return { start: s, end: e } }
    }
    if (c === '^') { pos++; return () => { const s = newState('assert', { mode: 'bol' }), e = newState('eps'); states[s].out.push(e); return { start: s, end: e } } }
    if (c === '$') { pos++; return () => { const s = newState('assert', { mode: 'eol' }), e = newState('eps'); states[s].out.push(e); return { start: s, end: e } } }
    if (c === '\\') {
      pos++
      const esc = readEscape()
      if (!esc) return null
      if (esc.kind === 'assert') return () => { const s = newState('assert', { mode: esc.mode }), e = newState('eps'); states[s].out.push(e); return { start: s, end: e } }
      const fn = esc.kind === 'pred' ? esc.fn : matchChar(esc.ch)
      return () => { const s = newState('pred', { fn }), e = newState('eps'); states[s].out.push(e); return { start: s, end: e } }
    }
    pos++
    const fn = matchChar(c)
    return () => { const s = newState('pred', { fn }), e = newState('eps'); states[s].out.push(e); return { start: s, end: e } }
  }

  function parseQuantified() {
    const atom = parseAtom()
    if (!atom) return null
    let min = 1, max = 1, hasQuant = false
    const q = chars[pos]
    if (q === '*') { min = 0; max = Infinity; pos++; hasQuant = true }
    else if (q === '+') { min = 1; max = Infinity; pos++; hasQuant = true }
    else if (q === '?') { min = 0; max = 1; pos++; hasQuant = true }
    else if (q === '{') {
      const rest = chars.slice(pos).join('')
      const m = rest.match(/^\{(\d+)(?:,(\d*))?\}/)
      if (m) {
        min = Number(m[1])
        max = m[2] === undefined ? min : m[2] === '' ? Infinity : Number(m[2])
        pos += m[0].length
        hasQuant = true
      }
    }
    if (hasQuant && chars[pos] === '?') pos++
    if (!hasQuant) return atom
    return () => repeatFrag(atom, min, max)
  }

  function parseSeq() {
    const parts = []
    while (pos < chars.length && chars[pos] !== '|' && chars[pos] !== ')') {
      const item = parseQuantified()
      if (!item) return null
      parts.push(item)
    }
    if (!parts.length) return () => { const s = newState('eps'); return { start: s, end: s } }
    return () => {
      const built = parts.map(fn => fn())
      if (aborted || built.some(x => !x)) return null
      for (let i = 0; i < built.length - 1; i++) states[built[i].end].out.push(built[i + 1].start)
      return { start: built[0].start, end: built[built.length - 1].end }
    }
  }

  function parseAlt() {
    let left = parseSeq()
    if (!left) return null
    while (chars[pos] === '|') {
      pos++
      const right = parseSeq()
      if (!right) return null
      const prev = left
      left = () => {
        const a = prev(), b = right()
        if (aborted || !a || !b) return null
        const s = newState('eps'), e = newState('eps')
        states[s].out.push(a.start, b.start)
        states[a.end].out.push(e)
        states[b.end].out.push(e)
        return { start: s, end: e }
      }
    }
    return left
  }

  const rootFactory = parseAlt()
  let matcher = null
  if (rootFactory && pos === chars.length && !aborted) {
    const root = rootFactory()
    if (root && !aborted) {
      const searchStart = newState('eps')
      const anyChar = newState('pred', { fn: () => true })
      const accept = newState('accept')
      if (!aborted) {
        states[searchStart].out.push(root.start, anyChar)
        states[anyChar].out.push(searchStart)
        states[root.end].out.push(accept)
        const assertHolds = (mode, input, idx) => {
          if (mode === 'bol') return idx === 0 || (multiline && LINEAR_LINE_TERM.has(input[idx - 1]))
          if (mode === 'eol') return idx === input.length || (multiline && LINEAR_LINE_TERM.has(input[idx]))
          const leftW = idx > 0 && isAsciiWord(input[idx - 1])
          const rightW = idx < input.length && isAsciiWord(input[idx])
          return mode === 'wb' ? leftW !== rightW : leftW === rightW
        }
        matcher = text => {
          const input = Array.from(text)
          const seen = new Int32Array(states.length).fill(-1)
          let stepToken = 0, current = []
          const addState = (id, list, idx) => {
            if (seen[id] === stepToken) return
            seen[id] = stepToken
            const st = states[id]
            if (st.op === 'eps') {
              for (const next of st.out) addState(next, list, idx)
            } else if (st.op === 'assert') {
              if (assertHolds(st.mode, input, idx)) {
                for (const next of st.out) addState(next, list, idx)
              }
            } else {
              list.push(id)
            }
          }
          stepToken++
          addState(searchStart, current, 0)
          if (seen[accept] === stepToken) return true
          for (let i = 0; i < input.length; i++) {
            const ch = input[i], nextList = []
            stepToken++
            for (const id of current) {
              const st = states[id]
              if (st.op === 'pred' && st.fn(ch)) {
                for (const next of st.out) addState(next, nextList, i + 1)
              }
            }
            if (seen[accept] === stepToken) return true
            current = nextList
            if (!current.length) return false
          }
          return false
        }
      }
    }
  }
  if (!matcher) {
    const nestedQuant = hasNestedQuantifier(pattern)
    if (!backtrackingMatcherRunner && nestedQuant) {
      throw new Error('包含不支持的回溯嵌套结构，请改用 RE2 兼容门禁正则')
    }
    matcher = (text, timeoutMs = DEFAULT_REGEX_TIMEOUT_MS) => {
      const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_REGEX_TIMEOUT_MS
      if (backtrackingMatcherRunner) return backtrackingMatcherRunner(v8Regex, text, budget)
      if (nestedQuant) throw new Error('包含不支持的回溯嵌套结构，请改用 RE2 兼容门禁正则')
      const startMs = Date.now()
      const matched = v8Regex.test(text)
      if (Date.now() - startMs > budget) {
        throw new Error(`本地预检正则执行超过 ${budget}ms 超时护栏，已中止`)
      }
      return matched
    }
  }
  if (linearRegexCache.size >= 32) linearRegexCache.delete(linearRegexCache.keys().next().value)
  linearRegexCache.set(rawPattern, matcher)
  return matcher
}

export const DEFAULT_REGEX_TIMEOUT_MS = 500
let backtrackingMatcherRunner = null
export function setBacktrackingMatcherRunner(runner) {
  backtrackingMatcherRunner = typeof runner === 'function' ? runner : null
}

function hasNestedQuantifier(pattern) {
  const stack = []
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') { i++; continue }
    if (inClass) { if (ch === ']') inClass = false; continue }
    if (ch === '[') { inClass = true; continue }
    if (ch === '(') { stack.push({ hasQuant: false }); continue }
    if (ch === ')') {
      const closed = stack.pop() || { hasQuant: false }
      const next = pattern[i + 1]
      let repeats = next === '*' || next === '+'
      if (!repeats && next === '{') {
        const m = pattern.slice(i + 1).match(/^\{(\d+)(?:,(\d*))?\}/)
        if (m) {
          const max = m[2] === undefined ? Number(m[1]) : m[2] === '' ? Infinity : Number(m[2])
          repeats = max > 1
        }
      }
      if (repeats && closed.hasQuant) return true
      if ((repeats || closed.hasQuant) && stack.length) stack[stack.length - 1].hasQuant = true
      continue
    }
    if (ch === '*' || ch === '+') {
      if (stack.length) stack[stack.length - 1].hasQuant = true
    } else if (ch === '{') {
      const m = pattern.slice(i).match(/^\{(\d+)(?:,(\d*))?\}/)
      if (m) {
        const max = m[2] === undefined ? Number(m[1]) : m[2] === '' ? Infinity : Number(m[2])
        if (max > 1 && stack.length) stack[stack.length - 1].hasQuant = true
        i += m[0].length - 1
      }
    }
  }
  return false
}

const GATE_ISSUE_LINE_REGEX = '^((SR\\d{14}|AR\\d{14}|DTS\\d{13}|DTS\\d{8}\\w{11})[;；]*)+([^\\diISAD;；\\r\\n][^\\r\\n]*)*$'

function diagnoseGatePatternMismatch(message, trimmedPattern) {
  if (trimmedPattern.includes('SR\\d{14}') && trimmedPattern.includes('AR\\d{14}')) {
    const requiredHeaders = ['问题单号/AR/STORY/CR', '修改人', '审核人', '修改说明']
    const missingColonHeader = requiredHeaders.find(label => !new RegExp(`【${label.replace(/\//g, '\\/')}】[:：]`, 'u').test(message))
    if (missingColonHeader) {
      return `提交信息中「【${missingColonHeader}】」缺少标题或紧邻冒号（示例：【${missingColonHeader}】：内容）`
    }
    const issueMatch = message.match(/【问题单号\/AR\/STORY\/CR】[:：]\s*([\s\S]*?)(?=\r?\n|\s+【修改人】[:：]|$)/u)
    const issueVal = (issueMatch?.[1] || '').trim()
    const issueMatcher = compilePatternMatcher(GATE_ISSUE_LINE_REGEX)
    if (!issueMatcher(issueVal)) {
      const shown = issueVal.length > 32 ? `${issueVal.slice(0, 32)}…` : (issueVal || '空')
      return `问题单号「${shown}」不符合门禁规则：需为 SR+14位数字、AR+14位数字、DTS+13位数字 或 DTS+8位数字+11位字符（多个单号用分号紧邻分隔，不支持 NA）`
    }
    return '提交信息未通过门禁正则校验：请确保按「问题单号 → 修改人 → 审核人 → 修改说明」顺序排列，且单字段内不含换行'
  }
  return `提交信息未通过本地预检正则（${trimmedPattern}）`
}

export function defaultCommitSummary(subject) {
  if (subject?.restore_baseline) return '恢复干净基线（清空打桩）'
  const itemNames = Array.isArray(subject?.items) && subject.items.length
    ? subject.items.map(item => item?.name || item?.task_id).filter(Boolean).join('、')
    : ''
  const raw = typeof subject?.result?.summary === 'string' && subject.result.summary.trim()
    ? subject.result.summary
    : itemNames
      ? `合成打桩：${itemNames}`
      : typeof subject?.name === 'string' && subject.name.trim()
        ? subject.name
        : subject?.id ? `fault injection ${subject.id}` : ''
  const flattened = raw.replace(/\s*\r?\n\s*/g, '；').replace(/\s{2,}/g, ' ').trim()
  return Array.from(flattened).slice(0, 16).join('')
}

export function normalizeCommitConfig(input = {}, fallback = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const base = fallback && typeof fallback === 'object' ? fallback : {}
  const rawMode = src.mode ?? base.mode
  const mode = rawMode === 'default' ? 'default' : 'template'
  const explicitDefaultMode = src.mode === 'default'
    ? true
    : src.mode === 'template'
      ? false
      : Boolean(base.explicit_default_mode)
  const cleanLine = (val, max = 300, joiner = ' ') => typeof val === 'string' ? val.replace(/\0/g, '').replace(/\s*\r?\n\s*/g, joiner).trim().slice(0, max) : ''
  const templateRaw = typeof src.template === 'string' ? src.template : typeof base.template === 'string' ? base.template : ''
  let normalizedTemplate = templateRaw.replace(/\0/g, '').replace(/\r\n/g, '\n').trim().slice(0, 2000) || MULTILINE_GATE_COMMIT_TEMPLATE
  if (normalizedTemplate === LEGACY_MULTILINE_GATE_TEMPLATE) normalizedTemplate = MULTILINE_GATE_COMMIT_TEMPLATE
  else if (normalizedTemplate === LEGACY_SINGLELINE_GATE_TEMPLATE) normalizedTemplate = SINGLELINE_GATE_COMMIT_TEMPLATE
  let pattern
  if (src.pattern !== undefined) {
    pattern = normalizeRegexPattern(src.pattern)
  } else if (base.pattern !== undefined && (base.mode ?? 'template') === mode) {
    pattern = normalizeRegexPattern(base.pattern)
  } else {
    pattern = mode === 'template' ? DEFAULT_INTRANET_COMMIT_REGEX : ''
  }
  return {
    mode,
    ...(explicitDefaultMode ? { explicit_default_mode: true } : {}),
    template: normalizedTemplate,
    issue: cleanLine(src.issue ?? base.issue, 300, ' '),
    author: cleanLine(src.author ?? base.author, 200, ' '),
    reviewer: cleanLine(src.reviewer ?? base.reviewer, 200, ' '),
    summary: cleanLine(src.summary, 500, '；'),
    pattern,
    custom_message: typeof src.custom_message === 'string' ? src.custom_message.replace(/\0/g, '').replace(/\r\n/g, '\n').trim().slice(0, 8000) : '',
  }
}

export function validateRawCommitMessage(rawMessage, pattern = '', { timeoutMs = DEFAULT_REGEX_TIMEOUT_MS } = {}) {
  if (typeof rawMessage !== 'string') return { ok: false, message: '', error: '提交信息不能为空' }
  if (rawMessage.includes('\0')) return { ok: false, message: '', error: '提交信息包含无效空字符' }
  const message = rawMessage.replace(/\r\n/g, '\n').trim()
  if (!message) return { ok: false, message: '', error: '提交信息不能为空' }
  if (message.length > 8000) return { ok: false, message: '', error: '提交信息过长（最多 8000 字符）' }
  const emptyField = EMPTY_GATE_FIELD.exec(message)
  if (emptyField) {
    const label = emptyField[1] || emptyField[2] || '必填项'
    return { ok: false, message, error: `提交信息中「【${label}】」未填写内容，请补全后再提交` }
  }
  const trimmedPattern = normalizeRegexPattern(pattern)
  if (trimmedPattern) {
    let matcher
    try { matcher = compilePatternMatcher(trimmedPattern) }
    catch (error) { return { ok: false, message, error: `本地预检正则无效：${error.message}` } }
    let matched
    try { matched = matcher(message, timeoutMs) }
    catch (error) { return { ok: false, message, error: error.message || '本地预检正则执行超时' } }
    if (!matched) return { ok: false, message, error: diagnoseGatePatternMismatch(message, trimmedPattern) }
  }
  return { ok: true, message, error: null }
}

export function resolveCommitMessage(config, task, { allowPendingSummary = false, allowDefaultSummary = true, timeoutMs = DEFAULT_REGEX_TIMEOUT_MS } = {}) {
  const normalized = normalizeCommitConfig(config)
  if (normalized.mode !== 'template') {
    const fallback = task?.restore_baseline
      ? (task?.id ? `revert: restore clean baseline ${task.id}` : 'revert: restore clean baseline')
      : (task?.id ? `test: fault injection ${task.id}` : 'test: fault injection')
    return validateRawCommitMessage(normalized.custom_message || fallback, normalized.pattern, { timeoutMs })
  }
  const template = normalized.template
  const summary = normalized.summary || (allowDefaultSummary ? defaultCommitSummary(task) : '') || (allowPendingSummary ? '待生成打桩修改说明' : '')
  const values = {
    issue: normalized.issue,
    author: normalized.author,
    reviewer: normalized.reviewer,
    summary,
    task_id: String(task?.id || ''),
  }
  const labels = {
    issue: '问题单号（如 AR/SR+14位数字 或 DTS单号）',
    author: '修改人',
    reviewer: '审核人',
    summary: '修改说明',
  }
  let preview = template
  for (const [key, value] of Object.entries(values)) {
    preview = preview.replace(new RegExp(`\\{${key}\\}`, 'g'), () => value)
  }
  for (const [key, label] of Object.entries(labels)) {
    if (template.includes(`{${key}}`) && !values[key]) {
      return { ok: false, message: preview.trim(), error: `请填写${label}` }
    }
  }
  return validateRawCommitMessage(preview, normalized.pattern, { timeoutMs })
}


