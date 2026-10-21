// Shared function and variable graph fixture for local renderer tests.
const CALL_GRAPH_FORMAT = 'call-graph-v1'
export const CALL_GRAPH_EXAMPLE = {
  format_version: CALL_GRAPH_FORMAT,
  title: '登录请求处理',
  root: 'login_handler',
  functions: [
    { id: 'login_handler', kind: 'function', label: 'login_handler', signature: 'int login_handler(req_t *req)', file: 'src/login.c', line: 20 },
    { id: 'check_password', kind: 'function', label: 'check_password', signature: 'bool check_password(const char *user, const char *pw)', file: 'src/auth.c', line: 41 },
    { id: 'MAX_RETRY', kind: 'macro', label: 'MAX_RETRY', signature: '#define MAX_RETRY 5', file: 'src/auth.h', line: 8 },
    { id: 'strcmp', kind: 'external', label: 'strcmp', signature: '', file: '', line: null },
  ],
  calls: [
    { from: 'login_handler', to: 'check_password', file: 'src/login.c', line: 33, args: ['user', 'pw'], returns: 'ok' },
    { from: 'check_password', to: 'strcmp', file: 'src/auth.c', line: 47, args: ['hash', 'stored'], returns: '' },
  ],
  variables: [
    { function: 'login_handler', name: 'ok', reads: ['user', 'pw'], compute: 'check_password(user, pw)', writes: 'ok', line: 33 },
  ],
  notes: [],
}

