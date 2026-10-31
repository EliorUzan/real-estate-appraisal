"""Isolated parser entry point. Input is a file path, never Python source."""
from __future__ import annotations
import json
import os
from pathlib import Path
import sys

def memory_limit() -> None:
    limit = 512 * 1024 * 1024
    if os.name != "nt":
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
        resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
        return
    import ctypes
    from ctypes import wintypes as w
    class Basic(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64), ("flags", w.DWORD), ("min_ws", ctypes.c_size_t), ("max_ws", ctypes.c_size_t), ("active", w.DWORD), ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]
    class Extended(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", ctypes.c_uint64 * 6), ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
    kernel.CreateJobObjectW.restype = w.HANDLE
    kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    kernel.GetCurrentProcess.restype = w.HANDLE
    job = kernel.CreateJobObjectW(None, None)
    limits = Extended()
    limits.basic.flags = 0x100  # JOB_OBJECT_LIMIT_PROCESS_MEMORY
    limits.process_memory = limit
    if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        raise RuntimeError("Could not enforce parser memory limit")
    # Keep the handle open until process exit; no customer contents are logged.

def main() -> None:
    memory_limit()
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from appraisal_assistant.services.file_text_extractor import FileTextExtractor, ExtractionLimitError
    try:
        text = FileTextExtractor()._read_text_in_worker(Path(sys.argv[1]))
        print(json.dumps({"text": text}))
    except ExtractionLimitError as error:
        print(json.dumps({"error": str(error)}))
    except Exception:
        print(json.dumps({"error": "לא ניתן לקרוא את הקובץ או שהוא חורג ממגבלות הבטיחות. יש לפצל או להמיר אותו."}))

if __name__ == "__main__":
    main()
