"""Prepare a local, isolated Fusion bridge installation; Python standard library only."""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import importlib.metadata
import json
import shutil
import subprocess
import sys
import tempfile
import venv
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def verify(directory):
    profile = json.loads((ROOT / 'profile.json').read_text(encoding='utf8'))
    for name, expected in profile['sha256'].items():
        path = directory / name
        if not path.is_file():
            raise RuntimeError('Unsupported Fusion 4.1 build: ' + name)
        with path.open('rb') as file:
            if hashlib.file_digest(file, 'sha256').hexdigest() != expected:
                raise RuntimeError('Unsupported Fusion 4.1 build: ' + name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument('--game-archive', type=Path)
    source.add_argument('--game-path', type=Path)
    parser.add_argument('--register-codex', action='store_true')
    args = parser.parse_args()
    game = ROOT / 'game'
    if not game.exists():
        with tempfile.TemporaryDirectory(prefix='fusion-install-', dir=ROOT) as staging:
            stage = Path(staging)
            if args.game_archive:
                with zipfile.ZipFile(args.game_archive) as archive:
                    for member in archive.infolist():
                        relative = PurePosixPath(member.filename)
                        target = stage.joinpath(*relative.parts).resolve()
                        if not target.is_relative_to(stage.resolve()):
                            raise ValueError('Archive contains an unsafe path')
                    archive.extractall(stage)
                candidates = list(stage.rglob('PlantsVsZombiesRH.exe'))
                if len(candidates) != 1:
                    raise RuntimeError('Archive must contain one Fusion executable')
                prepared = candidates[0].parent
            elif args.game_path:
                original = args.game_path.resolve()
                if original.is_file():
                    original = original.parent
                verify(original)
                prepared = stage / 'game'
                shutil.copytree(original, prepared)
            else:
                raise RuntimeError('Pass --game-archive ZIP or --game-path game directory')
            verify(prepared)
            shutil.move(str(prepared), game)
    else:
        verify(game)

    python = ROOT / '.venv/Scripts/python.exe'
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(ROOT / '.venv')
    probe = subprocess.run([str(python), '-c', 'import importlib.metadata; print(importlib.metadata.version("frida"))'], capture_output=True, text=True)
    if probe.returncode or probe.stdout.strip() != '17.22.1':
        if (ROOT / 'runtime/connection.json').exists():
            raise RuntimeError('Release and stop the host before updating its runtime')
        subprocess.run([str(python), '-m', 'pip', 'install', '--only-binary=:all:', '-r', str(ROOT / 'requirements.txt')], check=True)
    generated = ROOT / 'generated'
    generated.mkdir(exist_ok=True)
    entry = {'command': str(python), 'args': ['-X', 'utf8', str(ROOT / 'scripts/run_mcp.py')]}
    (generated / 'mcp.json').write_text(json.dumps({'mcpServers': {'pvz_fusion': entry}}, indent=2), encoding='utf8')
    (generated / 'codex.toml').write_text('[mcp_servers.pvz_fusion]\ncommand = '+json.dumps(str(python))+'\nargs = '+json.dumps(entry['args'])+'\n', encoding='utf8')
    (generated / 'START_HERE.txt').write_text('融合版 AI Bridge 已安装。先运行 start.cmd，再让 AI 阅读 '+str(ROOT / 'AI_PLAYER_PROMPT.txt')+'。服务 pvz_fusion，工具 pvzf_*。\n', encoding='utf8')
    if args.register_codex:
        cli = shutil.which('codex')
        if not cli:
            raise RuntimeError('Codex CLI not found; import generated/mcp.json manually')
        subprocess.run([cli, 'mcp', 'add', 'pvz_fusion', '--', str(python), *entry['args']], check=True)
    print('Installed: ' + str(ROOT))
    print('MCP configuration: ' + str(generated / 'mcp.json'))


if __name__ == '__main__':
    main()
