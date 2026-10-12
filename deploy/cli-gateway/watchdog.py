"""Container entrypoint: exiting PID 1 terminates the entire job container."""
import os
import signal
import subprocess
import sys
import threading

child = subprocess.Popen(sys.argv[1:])
def deadline():
    os._exit(124)
timer = threading.Timer(300, deadline)
timer.daemon = True
timer.start()
def stop(signum, _frame):
    child.send_signal(signum)
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
sys.exit(child.wait())
