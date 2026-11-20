import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from collections import OrderedDict
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import client
import run_bridge
import run_mcp


class ProtocolTests(unittest.TestCase):
    def test_read_polling_does_not_exhaust_mutation_budget_and_release_still_runs(self):
        cache, seen, executed = OrderedDict(), set(), []
        def execute(request, _):
            executed.append(request['op'])
            return {'ok': True, 'result': {}}
        def call(key, op):
            request = {'id': key, 'op': op}
            return run_bridge.cached_request(request, json.dumps(request), cache, seen, execute, request_limit=1)
        for i in range(300):
            self.assertTrue(call(str(i), 'observe')['ok'])
        self.assertTrue(call('plant-1', 'plant')['ok'])
        denied = call('plant-2', 'plant')
        self.assertEqual(denied.get('outcome'), 'not_started')
        self.assertFalse(denied['ok'])
        self.assertTrue(call('release', 'detach')['ok'])
        self.assertTrue(call('final-read', 'observe')['ok'])
        self.assertEqual(executed.count('plant'), 1)
        self.assertEqual(seen, {'plant-1'})
        self.assertLessEqual(len(cache), 256)

    def test_evicted_mutation_and_failed_dispatch_are_never_replayed_after_read_polling(self):
        cache, seen, executions = OrderedDict(), set(), []
        def execute(request, _):
            executions.append(request['id'])
            if request['id'] == 'uncertain':
                raise RuntimeError('reply lost after dispatch')
            return {'ok': True, 'result': {}}
        def call(key, op):
            request = {'id': key, 'op': op}
            return run_bridge.cached_request(request, json.dumps(request), cache, seen, execute)
        call('committed', 'plant')
        with self.assertRaises(RuntimeError):
            call('uncertain', 'plant')
        for i in range(257):
            call(str(i), 'observe')
        for key in ('committed', 'uncertain'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                call(key, 'plant')
            self.assertEqual(executions.count(key), 1)

    def test_mcp_negotiates_lists_tools_and_rejects_unknown_arguments_without_game(self):
        requests = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-06-18'}},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'pvzf_plant', 'arguments': {'token': 'forbidden'}}},
        ]
        process = subprocess.run([sys.executable, str(ROOT / 'scripts/run_mcp.py')], input=''.join(json.dumps(r)+'\n' for r in requests), text=True, capture_output=True, check=True)
        replies = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual([r['id'] for r in replies], [1, 2, 3])
        self.assertEqual(replies[0]['result']['serverInfo']['name'], 'pvz-fusion-native')
        names = {t['name'] for t in replies[1]['result']['tools']}
        self.assertEqual(len(names), 33)
        self.assertIn('pvzf_fusion_recipe', names)
        self.assertIn('pvzf_minigame_input', names)
        self.assertIn('pvzf_rogue_action', names)
        self.assertIn('error', replies[2])

    def test_lost_action_reply_is_never_replayed(self):
        requests = []
        with socket.socket() as server, tempfile.TemporaryDirectory() as temp:
            server.bind(('127.0.0.1', 0)); server.listen()
            config = Path(temp) / 'connection.json'
            config.write_text(json.dumps({'host': '127.0.0.1', 'port': server.getsockname()[1], 'game': 'PVZ-Fusion', 'state': 'ready', 'executable': str(ROOT / 'game/PlantsVsZombiesRH.exe'), 'token': 'test-only'}))

            def peer():
                connection, _ = server.accept()
                with connection, connection.makefile('rb') as reader:
                    requests.append(json.loads(reader.readline()))
                    # Drop the connection after accepting the mutation.

            thread = threading.Thread(target=peer)
            thread.start()
            with patch.object(client, 'CONFIG', config), client.FusionClient() as game:
                with self.assertRaisesRegex(RuntimeError, 'unknown'):
                    game.request('plant', battle_id='session:1', card_id='card', row=1, column=1)
            thread.join(2)
        self.assertEqual(len(requests), 1)

    def test_exact_target(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / 'connection.json'
            config.write_text(json.dumps({'host': '127.0.0.1', 'game': 'PVZ-Fusion', 'state': 'ready', 'executable': str(ROOT / 'different-game.exe')}))
            with patch.object(client, 'CONFIG', config), self.assertRaisesRegex(RuntimeError, 'Wrong bridge target'):
                client.FusionClient()

    def test_release_proof(self):
        state = {'controlled': False, 'auto_collect': False, 'selection_released': True, 'held_os_inputs': 0, 'input_override_released': True}
        self.assertTrue(run_bridge.release_confirmed({'ok': True, 'result': state}))
        for name, value in [('controlled', True), ('auto_collect', True), ('selection_released', False), ('held_os_inputs', 1), ('input_override_released', False)]:
            with self.subTest(name=name):
                self.assertFalse(run_bridge.release_confirmed({'ok': True, 'result': {**state, name: value}}))

    def test_mcp_yields_transport_only_after_verified_release(self):
        calls, closed, clients = [], [], []
        released = {'controlled': False, 'auto_collect': False, 'selection_released': True,
                    'held_os_inputs': 0, 'input_override_released': True}

        class Peer:
            def __init__(self):
                self.index = len(clients)
                clients.append(self)

            def request(self, op, **_):
                calls.append((self.index, op))
                if op == 'detach' and calls.count((self.index, 'detach')) == 1:
                    return {'ok': True, 'result': {**released, 'selection_released': False}}
                return {'ok': True, 'result': released if op in ('detach', 'stop') else {}}

            def close(self):
                closed.append(self.index)

        names = ['observe', 'release_control', 'observe', 'release_control', 'observe', 'stop']
        requests = [{'jsonrpc': '2.0', 'id': i, 'method': 'tools/call',
                     'params': {'name': 'pvzf_' + name, 'arguments': {}}} for i, name in enumerate(names)]
        output = io.StringIO()
        with patch.object(run_mcp, 'FusionClient', Peer), patch.object(sys, 'stdin', io.StringIO(''.join(json.dumps(q)+'\n' for q in requests))), patch.object(sys, 'stdout', output):
            run_mcp.main()
        self.assertTrue(all('result' in json.loads(line) for line in output.getvalue().splitlines()))
        self.assertEqual(calls, [(0, 'observe'), (0, 'detach'), (0, 'observe'),
                                 (0, 'detach'), (1, 'observe'), (1, 'stop')])
        self.assertEqual(closed, [0, 1])


if __name__ == '__main__':
    unittest.main()
