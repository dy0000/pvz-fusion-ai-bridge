"""Exclusive local bridge host for the pinned PVZ-Fusion game, no desktop input."""
from __future__ import annotations

import argparse
from collections import OrderedDict
import ctypes
from ctypes import wintypes
import hashlib
import json
import msvcrt
import os
from pathlib import Path
import secrets
import signal
import select
import socket
import subprocess
import sys
import threading
import time

import frida
from receipts import TransactionJournal
from client import release_confirmed

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "game" / "PlantsVsZombiesRH.exe"
RUNTIME = ROOT / "runtime"

READ_OPS = frozenset({'capabilities', 'observe', 'menu', 'flow', 'choices', 'mechanisms',
                      'fusion_recipe', 'placement_check', 'inspect_cell', 'minigame_observe',
                      'rogue_observe', 'purchase_receipt'})
RELEASE_OPS = frozenset({'detach', 'stop'})


def cached_request(request, canonical, cache, seen_ids, execute, request_limit=100000):
    """Bound read receipts while retaining every potentially mutating request ID."""
    request_id = request['id']
    if request_id in cache:
        previous, response = cache[request_id]
        if previous != canonical:
            raise ValueError('Request ID reused with a different payload')
        return response
    if request_id in seen_ids:
        raise ValueError('Old receipt evicted; outcome unknown, refusing replay')
    tracked = request.get('op') not in READ_OPS | RELEASE_OPS
    if tracked and len(seen_ids) >= request_limit:
        response = {'id': request_id, 'ok': False, 'outcome': 'not_started',
                    'error': 'Mutation request limit reached; release before restarting the host'}
    else:
        if tracked:
            seen_ids.add(request_id)
        response = {'id': request_id, **execute(request, canonical)}
    cache[request_id] = (canonical, response)
    if len(cache) > 256:
        cache.popitem(last=False)
    return response


def process_path(pid: int) -> Path:
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        raise OSError(ctypes.get_last_error(), "Cannot inspect exact game process")
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(buffer))
        if not kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            raise OSError(ctypes.get_last_error(), "Cannot resolve game executable")
        return Path(buffer.value).resolve()
    finally:
        kernel.CloseHandle(handle)


def verify_game() -> dict:
    profile = json.loads((ROOT / "profile.json").read_text(encoding="utf8"))
    for name, expected in profile["sha256"].items():
        with (GAME.parent / name).open("rb") as file:
            actual = hashlib.file_digest(file, "sha256").hexdigest()
        if actual != expected:
            raise RuntimeError(f"Unsupported game file: {name}; bridge was not loaded")
    return profile


def target_exited(pid: int) -> bool:
    """A detached Frida session alone does not prove that the game has exited."""
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x100000, False, pid)
    if not handle:
        return ctypes.get_last_error() == 87  # PID no longer exists; other errors are inconclusive.
    try:
        return kernel.WaitForSingleObject(handle, 0) == 0
    finally:
        kernel.CloseHandle(handle)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, help="Attach only to this exact local game executable")
    parser.add_argument("--launch", action="store_true")
    parser.add_argument("--port", type=int, default=47634)
    parser.add_argument("--launch-id", help="Correlate Windows venv redirector startup without assuming its PID")
    args = parser.parse_args()
    RUNTIME.mkdir(exist_ok=True)
    lock = (RUNTIME / "controller.lock").open("a+b")
    lock.seek(0)
    if os.fstat(lock.fileno()).st_size == 0:
        lock.write(b"0")
        lock.flush()
    lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        raise SystemExit("A maintained fusion bridge already owns this target")
    profile = verify_game()
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    server.bind(("127.0.0.1", args.port))
    server.listen(1)
    server.settimeout(0.5)
    if not args.launch or args.pid:
        raise SystemExit("Use --launch: save isolation must be installed before this game starts")
    if any(p.name.lower() == GAME.name.lower() for p in frida.get_local_device().enumerate_processes()):
        raise SystemExit("A Fusion game already runs; close it normally before launching the isolated bridge")
    device = frida.get_local_device()
    isolated_low = RUNTIME / "saves"
    isolated_low.mkdir(exist_ok=True)
    args.pid = device.spawn([str(GAME), "-screen-fullscreen", "0", "-screen-width", "1920", "-screen-height", "1080", "-logFile", str(RUNTIME / "player.log")], cwd=str(GAME.parent), stdio="pipe")
    try:
        if process_path(args.pid) != GAME.resolve():
            raise RuntimeError("Spawned executable does not match the verified target")
        session = device.attach(args.pid)
        isolation_state = {}
        isolation = session.create_script("const ISOLATED_LOW=" + json.dumps(str(isolated_low)) + ";\n" + (ROOT / "src/isolation.js").read_text(encoding="utf8"))
        def isolation_message(message, data=None):
            if message.get("type") == "send":
                isolation_state.update(message.get("payload", {}))
            else:
                isolation_state["isolation_error"] = str(message)
        isolation.on("message", isolation_message)
        isolation.load()
        device.resume(args.pid)
        deadline = time.monotonic() + 40
        while not isolation_state.get("isolation_ready"):
            if isolation_state.get("isolation_error") or time.monotonic() > deadline:
                raise RuntimeError("Save isolation initialization failed: " + str(isolation_state))
            time.sleep(0.1)
        session_id, token = secrets.token_hex(12), secrets.token_hex(32)
        source = "const SESSION=" + json.dumps(session_id) + ";\n"
        source += "\n".join((ROOT / "src" / name).read_text(encoding="utf8") for name in ["engine.js", "input.js", "bridge.js", "mechanisms.js", "minigames.js", "rogue.js"])
        script = isolation
        run_directory = RUNTIME / ("run-" + session_id)
        run_directory.mkdir()
        log = (run_directory / "bridge.jsonl").open("a", encoding="utf8", buffering=1)
    
        def record(message, data=None):
            try:
                log.write(json.dumps({"time": time.time(), "message": message}, ensure_ascii=False) + "\n")
            except OSError as exc:
                print(f"Bridge log unavailable: {exc}", file=sys.stderr, flush=True)
    
        script.on("message", record)
        stop = threading.Event()
        ended = threading.Event()
    
        def on_detached(reason, *args):
            if reason == "process-terminated":
                ended.set()
            stop.set()
    
        session.on("detached", on_detached)
        signal.signal(signal.SIGINT, lambda *args: stop.set())
        signal.signal(signal.SIGTERM, lambda *args: stop.set())
        time.sleep(5)
        script.exports_sync.load_bridge(source)
        ready = script.exports_sync.request({"op": "capabilities"})
        if not ready.get("ok") or any(Path(ready.get("result", {}).get(key, "")).resolve() != isolated_low.resolve() for key in ("save_path", "save_actual")):
            print(isolation_state, file=sys.stderr)
            raise RuntimeError(ready)
    except BaseException:
        if not target_exited(args.pid):
            device.kill(args.pid)  # Only our unready child; no bridge client was accepted.
        raise
    config = {"host": "127.0.0.1", "port": args.port, "token": token, "pid": args.pid,
              "game": "PVZ-Fusion", "session_id": session_id, "executable": str(GAME),
              "host_pid": os.getpid(), "state": "ready", "launch_id": args.launch_id}
    config_file = RUNTIME / "connection.json"

    def publish_state(state):
        config["state"] = state
        pending = config_file.with_suffix(".tmp")
        pending.write_text(json.dumps(config, indent=2), encoding="utf8")
        pending.replace(config_file)

    publish_state("ready")

    def note_state(state):
        try:
            publish_state(state)
        except OSError as exc:
            record({"connection_state_write_failed": str(exc), "state": state})
    (run_directory / "session.json").write_text(json.dumps({"pid": args.pid, "session_id": session_id, "profile_sha256": hashlib.sha256((ROOT / "profile.json").read_bytes()).hexdigest()}), encoding="utf8")
    print(json.dumps({"ready": True, "pid": args.pid, "port": args.port, "config": str(config_file)}), flush=True)
    cache: OrderedDict[str, tuple[str, dict]] = OrderedDict()
    seen_ids: set[str] = set()
    transactions = TransactionJournal(RUNTIME / 'purchases.json')
    def execute(request, canonical):
        op = request.get('op')
        if op == 'purchase_receipt':
            return {'ok': True, 'result': transactions.receipt(request.get('transaction_id'))}
        if op == 'rogue_action':
            return transactions.execute(request, script.exports_sync.request)
        try:
            return script.exports_sync.request(request)
        except frida.InvalidOperationError:
            if op not in RELEASE_OPS:
                raise
            # Recover the release receipt if the script disappears as the game
            # exits. Mutating gameplay requests never enter this path.
            return release_until_confirmed(op=op)

    def release_until_confirmed(dispose=False, op='detach'):
        blocked = False
        while True:
            try:
                response = (script.exports_sync.dispose() if dispose else
                            script.exports_sync.request({"op": op}))
            except Exception as exc:
                # Transport failures also leave release unknown; they must not retire ownership.
                response = {"ok": False, "error": str(exc)}
            if release_confirmed(response):
                if blocked and not dispose and not stop.is_set():
                    note_state("ready")
                return response
            if ended.is_set() or target_exited(args.pid):
                stop.set()
                return {"ok": True, "result": {"target_exited": True, "selection_released": True,
                                               "controlled": False, "auto_collect": False, "held_os_inputs": 0, "input_override_released": True}}
            if not blocked:
                note_state("release_blocked")
                record({"release_blocked": response})
                print("Native release unconfirmed; retaining controller lock and hooks. "
                      "Waiting for release or game exit.", file=sys.stderr, flush=True)
                blocked = True
            # Never accept a new client or unload the script while release is unproved.
            time.sleep(0.5)
    try:
        while not stop.is_set():
            if (RUNTIME / "stop.request").exists():
                stop.set()
                break
            try:
                peer, address = server.accept()
            except socket.timeout:
                continue
            peer.settimeout(15)
            try:
                with peer, peer.makefile("rb") as reader:
                    while not stop.is_set():
                        if (RUNTIME / "stop.request").exists():
                            stop.set()
                            break
                        if not select.select([peer], [], [], 0.5)[0]:
                            continue
                        line = reader.readline(1024 * 1024 + 1)
                        if not line:
                            break
                        request_id = None
                        try:
                            if len(line) > 1024 * 1024 or not line.endswith(b"\n"):
                                raise ValueError("Request too large or incomplete")
                            request = json.loads(line)
                            if not isinstance(request, dict):
                                raise ValueError("Request must be a JSON object")
                            candidate_id = request.get("id")
                            if not isinstance(candidate_id, str) or not candidate_id or len(candidate_id) > 128:
                                raise ValueError("A bounded request ID is required")
                            request_id = candidate_id
                            if not secrets.compare_digest(str(request.pop("token", "")), token):
                                raise ValueError("Authentication failed")
                            canonical = json.dumps(request, sort_keys=True, ensure_ascii=False, allow_nan=False)
                            was_cached = request_id in cache
                            response = cached_request(request, canonical, cache, seen_ids, execute)
                            if not was_cached:
                                record({"request_id": request_id, "op": request.get("op"), "ok": response.get("ok"), "error": response.get("error")})
                        except (ValueError, TypeError, RecursionError, frida.InvalidOperationError, frida.RPCException) as exc:
                            response = {"id": request_id, "ok": False, "error": str(exc)}
                        peer.sendall((json.dumps(response, ensure_ascii=False, allow_nan=False) + "\n").encode("utf8"))
            except (OSError, UnicodeError) as exc:
                record({"disconnect": str(exc)})
            finally:
                # Disconnect must release native selection before accepting another controller.
                released = release_until_confirmed()
                record({"released": released})
    finally:
        try:
            note_state("stopping")
            release = release_until_confirmed(dispose=True)
            record({"shutdown": release})
            if not ended.is_set() and not target_exited(args.pid):
                try:
                    script.exports_sync.close_game()
                except frida.InvalidOperationError as exc:
                    # The script can disappear as Unity exits. Keep the host
                    # lock and save isolation until exact process exit is proven.
                    record({"close_rpc_unavailable": str(exc)})
                while not ended.is_set() and not target_exited(args.pid):
                    time.sleep(0.2)
            print(json.dumps({"stopped": True, "release": release}, ensure_ascii=False), flush=True)
        finally:
            server.close()
            if config_file.exists() and json.loads(config_file.read_text())["session_id"] == session_id:
                config_file.unlink()
            log.close()
            lock.close()
            # Frida detach can stall after a callback unhooks itself. All native
            # selections have been released before retiring the process.
            cleanup = threading.Thread(target=session.detach, daemon=True)
            cleanup.start()
            cleanup.join(3)
            if cleanup.is_alive():
                os._exit(0)


if __name__ == "__main__":
    main()
