#!/usr/bin/env python3
"""Real Redis build/package/deploy acceptance. No external Agent is simulated.
The source-backed injection plan below is authored by the assistant; ACP analysis
must be accepted separately. Requires git, make, C compiler and Python on Linux.
"""
import argparse, hashlib, json, os, pathlib, shutil, socket, subprocess, tarfile, time

BASE = 'ba181057223b04aba580a01b1b36662430aea4a0'
def run(args, cwd=None, **kw):
    return subprocess.run(args, cwd=cwd, check=True, text=True, **kw)
def sha(file):
    return hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()
def build(repo, log):
    with open(log, 'w') as out:
        run(['make', '-j2', 'MALLOC=libc', 'BUILD_TLS=no', 'REDIS_CFLAGS=', 'REDIS_LDFLAGS='], cwd=repo, stdout=out, stderr=subprocess.STDOUT)
def deploy_start(binary, directory, mode):
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
    log = open(directory / ('server-' + (mode or 'off') + '.log'), 'w')
    proc = subprocess.Popen([str(binary), '--bind', '127.0.0.1', '--port', str(port), '--dir', str(directory), '--save', '', '--appendonly', 'no', '--daemonize', 'no'], env={**os.environ, 'PANGEA_FI_RDB': mode}, stdout=log, stderr=subprocess.STDOUT)
    def command(*words):
        with socket.create_connection(('127.0.0.1', port), timeout=3) as s:
            parts = [str(w).encode() for w in words]
            s.sendall(b'*%d\r\n' % len(parts) + b''.join(b'$%d\r\n' % len(p) + p + b'\r\n' for p in parts))
            f = s.makefile('rb'); line = f.readline()
            if line.startswith(b'$'):
                n = int(line[1:]); return f.read(n).decode() if n >= 0 else None
            return line.decode().strip()
    for _ in range(100):
        try:
            if command('PING') == '+PONG': return proc, log, command
        except OSError: pass
        if proc.poll() is not None: break
        time.sleep(.05)
    proc.terminate(); proc.wait(timeout=10); log.close()
    raise RuntimeError('Redis failed to start; inspect server log')
def stop(proc, log):
    if proc.poll() is None: proc.terminate()
    try: proc.wait(timeout=10)
    except subprocess.TimeoutExpired: proc.kill(); proc.wait()
    log.close()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=pathlib.Path)
    generation = parser.add_mutually_exclusive_group()
    generation.add_argument('--edits-from', type=pathlib.Path, help='PANGEA generation/authored-result.json; uses actual generated edits instead of the reference patch')
    generation.add_argument('--analyze-with-codex', action='store_true', help='Run the authenticated Codex CLI against real source before building')
    parser.add_argument('--work', required=True, type=pathlib.Path, help='New isolated output directory; must not exist')
    args = parser.parse_args(); source = args.source.resolve(); work = args.work.resolve()
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip() == BASE
    assert subprocess.check_output(['git', 'diff', '--name-only'], cwd=source, text=True).strip() == ''
    work.mkdir(parents=True, exist_ok=False)
    report = {'project': 'redis/redis', 'base_commit': BASE, 'analysis_executor': 'assistant source analysis; not PANGEA ACP', 'cases': [], 'status': 'running'}
    try:
        if args.analyze_with_codex:
            args.edits_from = work / 'agent-result.json'
            prompt = pathlib.Path(__file__).with_name('redis-analysis-prompt.txt').read_text()
            with open(work / 'agent-events.jsonl', 'w') as events, open(work / 'agent-stderr.log', 'w') as errors:
                run(['codex', 'exec', '-s', 'read-only', '-C', str(source), '--json', '-o', str(args.edits_from), '-'], input=prompt, stdout=events, stderr=errors)
            report['agent_command'] = 'codex exec -s read-only'
        baseline_source = work / 'baseline-source'
        run(['git', 'clone', '--no-hardlinks', str(source), str(baseline_source)])
        build(baseline_source, work / 'baseline-build.log')
        seed = work / 'baseline'; seed.mkdir()
        proc, log, command = deploy_start(baseline_source / 'src/redis-server', seed, '')
        try:
            assert command('SET', 'acceptance', 'baseline') == '+OK'
            assert command('SAVE') == '+OK'
        finally: stop(proc, log)
        repo = work / 'source'
        run(['git', 'clone', '--no-hardlinks', str(source), str(repo)])
        run(['git', 'checkout', '-b', 'pangea-redis-rdb-acceptance', BASE], cwd=repo)
        file = repo / 'src/rdb.c'; content = file.read_text()
        edits = [
            ('    FILE *fp = fopen(filename,"w");', '''    /* Acceptance-only controls: independent, default off, once per process. */
    static int fi_open_hit = 0, fi_sync_hit = 0;
    const char *fi = getenv("PANGEA_FI_RDB");
    FILE *fp;
    if (fi && strchr(fi, 'A') && !fi_open_hit++) {
        serverLog(LL_WARNING,"PANGEA_FI hit=A stage=rdb-open");
        errno = EACCES;
        fp = NULL;
    } else {
        fp = fopen(filename,"w");
    }'''),
            ('    if (fsync(fileno(fp))) { err_op = "fsync"; goto werr; }', '''    if (fi && strchr(fi, 'B') && !fi_sync_hit++) {
        serverLog(LL_WARNING,"PANGEA_FI hit=B stage=rdb-fsync");
        errno = EIO;
        err_op = "fsync";
        goto werr;
    }
    if (fsync(fileno(fp))) { err_op = "fsync"; goto werr; }''')]
        if args.edits_from:
            generated = json.loads(args.edits_from.read_text())
            assert generated.get('edits'), 'No actual generated edits'
            assert all(e['path'] == 'src/rdb.c' for e in generated['edits']), 'This acceptance scenario owns src/rdb.c only'
            edits = [(e['before'], e['after']) for e in generated['edits']]
            report['analysis_executor'] = 'real Codex CLI' if args.analyze_with_codex else 'supplied generation result; see upstream Run for executor identity'
            report['generation_result_sha256'] = sha(args.edits_from)
        for before, after in edits:
            assert content.count(before) == 1, 'Injection location changed'
            content = content.replace(before, after)
        file.write_text(content)
        (work / 'edits.json').write_text(json.dumps([{'path': 'src/rdb.c', 'before': a, 'after': b} for a,b in edits], indent=2))
        (work / 'source.diff').write_bytes(subprocess.check_output(['git', 'diff'], cwd=repo))
        run(['git', 'add', 'src/rdb.c'], cwd=repo)
        run(['git', '-c', 'user.name=PANGEA acceptance', '-c', 'user.email=acceptance@localhost', 'commit', '--no-gpg-sign', '-m', 'test: independently inject RDB open and fsync failures'], cwd=repo)
        report['modified_commit'] = subprocess.check_output(['git','rev-parse','HEAD'], cwd=repo, text=True).strip()
        build(repo, work / 'injected-build.log')
        package = work / 'redis-rdb-injection-linux.tar.gz'
        with tarfile.open(package, 'w:gz') as archive:
            for name in ['redis-server', 'redis-cli']: archive.add(repo / 'src' / name, arcname=name)
        report['package_sha256'] = sha(package)
        deploy = work / 'deployed'; deploy.mkdir()
        with tarfile.open(package) as archive: archive.extractall(deploy, filter='data')
        for mode in ['', 'A', 'B', 'AB']:
            directory = work / ('case-' + (mode or 'off')); directory.mkdir()
            shutil.copy2(seed / 'dump.rdb', directory / 'dump.rdb')
            old_hash = sha(directory / 'dump.rdb')
            proc, log, command = deploy_start(deploy / 'redis-server', directory, mode)
            try:
                assert command('GET', 'acceptance') == 'baseline'
                assert command('SET', 'acceptance', 'updated') == '+OK'
                reply = command('SAVE')
                if mode:
                    assert reply.startswith('-ERR'), reply
                    first_logs = (directory / ('server-' + mode + '.log')).read_text()
                    assert first_logs.count('PANGEA_FI hit=A') == int('A' in mode)
                    assert first_logs.count('PANGEA_FI hit=B') == int(mode == 'B')
                    assert sha(directory / 'dump.rdb') == old_hash
                    assert not list(directory.glob('temp-*.rdb'))
                    assert command('GET', 'acceptance') == 'updated'
                    # Each fault is one-shot; AB needs two failed saves, then succeeds.
                    if mode == 'AB': assert command('SAVE').startswith('-ERR')
                    assert command('SAVE') == '+OK'
                else: assert reply == '+OK'
            finally: stop(proc, log)
            logs = (directory / ('server-' + (mode or 'off') + '.log')).read_text()
            hits = {k: logs.count('PANGEA_FI hit=' + k) for k in 'AB'}
            assert hits == {k: int(k in mode) for k in 'AB'}, hits
            proc, log, command = deploy_start(deploy / 'redis-server', directory, '')
            try:
                assert command('GET', 'acceptance') == 'updated'
                assert command('SAVE') == '+OK'
            finally: stop(proc, log)
            report['cases'].append({'mode': mode or 'off', 'first_save': reply, 'hits': hits, 'restart_recovery': 'passed', 'status': 'passed'})
        report['status'] = 'passed'
    except Exception as exc:
        report['status'] = 'failed'; report['error'] = str(exc)
        raise
    finally:
        (work / 'report.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
if __name__ == '__main__': main()
