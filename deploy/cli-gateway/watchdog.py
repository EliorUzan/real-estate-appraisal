"""Container entrypoint: exiting PID 1 terminates the entire job container."""
import os
import signal
import subprocess
import sys
import threading

def runtime_limit(args):
    # Only the fixed research invocation receives a longer ceiling.
    return 600 if (args and args[0] == 'agy' and '--agent' in args
        and args[args.index('--agent')+1:] == ['cli-gateway-research']) else 300


def main():
    child = subprocess.Popen(sys.argv[1:])
    timer = threading.Timer(runtime_limit(sys.argv[1:]), lambda: os._exit(124))
    timer.daemon = True
    timer.start()
    def stop(signum, _frame):
        child.send_signal(signum)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    sys.exit(child.wait())


if __name__ == '__main__':
    main()
