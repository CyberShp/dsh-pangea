// Release packages are built only from branches whose names start with
// `master` or `develop`. Fault-injection commits are test-only and must stay on
// personal branches, so these names are refused wherever a branch is configured
// or written.
export function protectedBranchReason(name) {
  const value = String(name ?? '').trim().replace(/^refs\/heads\//, '')
  if (!/^(master|develop)/i.test(value)) return ''
  return `${value} 是正式出包分支（master/develop 开头），打桩修改只能提交到个人分支`
}
