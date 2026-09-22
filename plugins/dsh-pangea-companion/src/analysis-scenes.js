export const SCENE_PROFILE = 'behavior-test-v2'

export function analysisOptions(capabilities, profile) {
  if (profile === SCENE_PROFILE) {
    const options = capabilities?.source_first?.analysis_options_by_profile?.[profile]
    if (!options) throw new Error('当前分析引擎不支持所选场景版本，请更新配套组件')
    return options
  }
  return capabilities?.source_first?.analysis_options ?? { scenarios: ['module-analysis'], modes: ['depth'], coverage_input: false }
}

export function riskApplicable(run) {
  if (run?.analysis_profile === SCENE_PROFILE) return run.analysis_scene?.presentation?.risks === true
  return run?.scenario !== 'coverage-analysis'
}
