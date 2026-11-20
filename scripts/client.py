"""One request or a persistent client for the separate fusion bridge."""
from pathlib import Path
import json
import socket
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "runtime" / "connection.json"


def release_confirmed(response: dict) -> bool:
    if not isinstance(response, dict):
        return False
    state = response.get("result", {})
    if not isinstance(state, dict):
        return False
    return (response.get("ok") is True and state.get("selection_released") is True
            and state.get("controlled") is False and state.get("auto_collect") is False
            and state.get("input_override_released") is True
            and state.get("held_os_inputs") == 0)


class FusionClient:
    def __init__(self):
        config = json.loads(CONFIG.read_text(encoding="utf8"))
        if (config["host"] != "127.0.0.1" or config["game"] != "PVZ-Fusion"
                or config.get("state") != "ready"
                or Path(config.get("executable", "")).resolve() != (ROOT / "game/PlantsVsZombiesRH.exe").resolve()):
            raise RuntimeError("Wrong bridge target")
        self.token = config["token"]
        self.socket = socket.create_connection((config["host"], config["port"]), timeout=15)
        self.reader = self.socket.makefile("rb")

    def request(self, op, **args):
        request_id = uuid.uuid4().hex
        data = {"id": request_id, "token": self.token, "op": op, **args}
        try:
            self.socket.sendall((json.dumps(data, ensure_ascii=False, allow_nan=False) + "\n").encode("utf8"))
            line = self.reader.readline(8 * 1024 * 1024 + 1)
        except OSError as exc:
            self.close()
            raise RuntimeError("Connection interrupted; action outcome unknown. Reconnect and observe, never replay automatically.") from exc
        if not line or len(line) > 8 * 1024 * 1024 or not line.endswith(b"\n"):
            self.close()
            raise RuntimeError("Outcome unknown; do not replay the action")
        response = json.loads(line)
        if response.get("id") != request_id:
            self.close()
            raise RuntimeError("Response mismatch; do not replay the action")
        return response

    def close(self):
        self.reader.close()
        self.socket.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


if __name__ == "__main__":
    import sys
    with FusionClient() as game:
        args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        print(json.dumps(game.request(sys.argv[1] if len(sys.argv) > 1 else "observe", **args), ensure_ascii=False, indent=2))
