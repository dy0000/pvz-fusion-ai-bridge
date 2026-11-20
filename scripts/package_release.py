"""Package only the bridge's public files, never the game or local runtime."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = [
    'README.md', 'AI_PLAYER_PROMPT.txt', 'AGENTS.md',
    'LICENSE', '.gitignore', 'profile.json', 'requirements.txt', 'mcp.example.json',
    'install.ps1', 'install.cmd', 'start.cmd', 'stop.cmd',
    'src/engine.js', 'src/isolation.js', 'src/input.js', 'src/bridge.js',
    'src/mechanisms.js', 'src/minigames.js', 'src/rogue.js',
    'scripts/client.py', 'scripts/run_bridge.py', 'scripts/run_mcp.py',
    'scripts/install.py', 'scripts/launch.ps1', 'scripts/receipts.py',
    'scripts/observe_game.py', 'scripts/verify_live.py', 'scripts/verify_mcp.py',
    'scripts/verify_mechanisms.py', 'scripts/package_release.py',
    'tests/test_protocol.py', 'tests/test_receipts.py',
    'tests/test_native.cjs', 'tests/test_input.cjs',
    'tests/test_interactions.cjs', 'tests/test_rogue.cjs',
]


def main():
    output = ROOT / 'dist'; output.mkdir(exist_ok=True)
    package = output / 'pvz-fusion-ai-bridge-0.4.0.zip'
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in PUBLIC}
    with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in PUBLIC:
            archive.write(ROOT / name, 'pvz-fusion-ai-bridge/' + name)
        archive.writestr('pvz-fusion-ai-bridge/SHA256SUMS.json', json.dumps(hashes, indent=2) + '\n')
    checksum = hashlib.sha256(package.read_bytes()).hexdigest()
    package.with_suffix('.zip.sha256').write_text(checksum + '  ' + package.name + '\n', encoding='utf8')
    print(package)


if __name__ == '__main__':
    main()
