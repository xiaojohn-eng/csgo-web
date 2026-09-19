import fcntl, os, pathlib, subprocess, sys
base = pathlib.Path(__file__).resolve().parents[1] / '.web-service'
base.mkdir(exist_ok=True)
with (base / 'operation.lock').open('a+') as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('另一个启动/停止操作正在进行，请稍后重试。')
        sys.exit(1)
    env = dict(os.environ, BREACHLINE_WEB_LOCKED='1')
    # Keep the same locked open-file description alive in the Node operation,
    # even if this wrapper is interrupted. Its detached server does not inherit it.
    sys.exit(subprocess.call(sys.argv[1:], env=env, pass_fds=(lock.fileno(),)))
