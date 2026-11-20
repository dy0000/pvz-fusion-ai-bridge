"""Focused MCP-to-game read/control verification at the released main menu."""
from pathlib import Path
import json
import subprocess
import sys
import uuid
from client import FusionClient

ROOT = Path(__file__).resolve().parents[1]


def main():
    output = ROOT / 'evidence' / ('mcp-' + uuid.uuid4().hex[:12])
    output.mkdir(parents=True)
    process = subprocess.Popen([sys.executable, '-u', '-X', 'utf8', str(ROOT / 'scripts/run_mcp.py')],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf8')
    wire = []
    sequence = 0

    def request(method, params=None):
        nonlocal sequence
        sequence += 1
        payload = {'jsonrpc': '2.0', 'id': sequence, 'method': method, 'params': params or {}}
        process.stdin.write(json.dumps(payload, ensure_ascii=True) + '\n')
        process.stdin.flush()
        response = json.loads(process.stdout.readline())
        wire.append({'request': payload, 'response': response})
        if 'error' in response:
            raise RuntimeError(response)
        return response['result']

    def call(name, **args):
        result = request('tools/call', {'name': 'pvzf_' + name, 'arguments': args})
        response = json.loads(result['content'][0]['text'])
        if not response.get('ok'):
            raise RuntimeError(response)
        return response['result']

    summary = {'passed': False}
    try:
        summary['server'] = request('initialize', {'protocolVersion': '2025-06-18'})['serverInfo']
        summary['tool_count'] = len(request('tools/list')['tools'])
        assert summary['tool_count'] == 33
        cap = call('capabilities')
        assert cap['bridge_version'] == '0.3.0'
        assert all(Path(cap[key]).resolve() == (ROOT / 'runtime/saves').resolve() for key in ('save_path', 'save_actual'))
        assert call('observe')['phase'] == 'menu', 'Run only at the released main menu'
        call('take_control')
        menu = call('menu')
        notice = next((a for a in menu['actions'] if a['enabled'] and 'NoticePauseMenu' in a['path']), None)
        if notice:
            call('menu_action', menu_id=menu['menu_id'], action_id=notice['action_id'])
            menu = call('menu')
        summary['menu'] = menu
        summary['mechanisms'] = call('mechanisms')
        summary['choices'] = call('choices')
        summary['receipts'] = call('purchase_receipt')
        summary['final_observe'] = call('observe')
        summary['checks_completed'] = True
    finally:
        try:
            summary['release'] = call('release_control')
            assert all(summary['release'][k] is v for k, v in
                       [('controlled', False), ('auto_collect', False), ('selection_released', True), ('input_override_released', True)])
            assert summary['release']['held_os_inputs'] == 0
            # The MCP process stays alive while another released client connects.
            # This detects an adapter that keeps occupying the host after release.
            with FusionClient() as successor:
                response = successor.request('observe')
                assert response.get('ok') and response['result']['phase'] == 'menu'
                assert response['result']['controlled'] is False
                summary['transport_handoff'] = True
            summary['passed'] = summary.get('checks_completed', False)
        finally:
            process.stdin.close()
            process.wait(timeout=20)
            (output / 'wire.json').write_text(json.dumps(wire, ensure_ascii=False, indent=2), encoding='utf8')
            (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({'evidence': str(output), 'passed': summary['passed'], 'tool_count': summary['tool_count'],
                      'locked_entries': [a['name'] for a in summary['menu']['actions'] if a.get('native_lock_state')],
                      'release': summary['release']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
