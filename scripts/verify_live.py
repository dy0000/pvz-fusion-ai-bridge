"""Bounded normal-game acceptance fixture for the isolated adventure level 1.

Creates a fresh evidence directory; never cheats or replays unknown actions.
Not a general strategy or a claim of natural completion.
"""
from pathlib import Path
import json
import time
import uuid

from client import FusionClient

ROOT = Path(__file__).resolve().parents[1]


def main():
    output = ROOT / 'evidence' / ('acceptance-' + uuid.uuid4().hex[:12])
    output.mkdir(parents=True)
    events = []
    with FusionClient() as game:
        def request(op, **kwargs):
            response = game.request(op, **kwargs)
            events.append({'op': op, 'arguments': kwargs, 'response': response})
            (output / 'calls.json').write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding='utf8')
            return response

        def ok(op, **kwargs):
            response = request(op, **kwargs)
            if not response.get('ok'):
                raise RuntimeError(response)
            return response['result']

        def wait_phase(phase, seconds=20):
            deadline = time.monotonic() + seconds
            while True:
                state = ok('observe')
                if state['phase'] == phase:
                    return state
                if time.monotonic() > deadline:
                    raise RuntimeError(f'Expected {phase}: {state}')
                time.sleep(.25)

        summary = {'evidence': str(output), 'assisted': False}
        try:
            ok('attach')
            state = ok('observe')
            if state['phase'] == 'menu':
                menu = ok('menu')
                notice = next((a for a in menu['actions'] if a['enabled'] and 'NoticePauseMenu' in a['path']), None)
                if notice:
                    ok('menu_action', menu_id=menu['menu_id'], action_id=notice['action_id'])
                    menu = ok('menu')
                action = next(a for a in menu['actions'] if a['name'] == 'AdvantureLevels' and a['enabled'])
                ok('menu_action', menu_id=menu['menu_id'], action_id=action['action_id'])
                state = wait_phase('selection')
            if state['phase'] == 'selection':
                ok('diagnostics')
                for name, cost in [('SunFlower', 50), ('Peashooter', 100)]:
                    card = next(c for c in state['cards'] if c['name'] == name and c['cost'] == cost)
                    ok('choose_card', battle_id=state['battle_id'], card_id=card['card_id'], selected=True)
                ok('start_battle', battle_id=state['battle_id'])
                state = wait_phase('running')
            if state['phase'] != 'running' or state['level'] != 1:
                raise RuntimeError('Fixture requires normal adventure level 1')
            battle = state['battle_id']
            deadline = time.monotonic() + 15
            while True:
                state = ok('observe')
                card = next(c for c in state['cards'] if c['name'] == 'Peashooter' and c['cost'] == 100)
                if card['cooldown'] <= 0:
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError('Initial card cooldown did not expire')
                time.sleep(.25)
            flower = next(c for c in state['cards'] if c['name'] == 'SunFlower' and c['cost'] == 50)
            summary['sunflower'] = ok('plant', battle_id=battle, card_id=flower['card_id'], row=3, column=1)
            result = ok('plant', battle_id=battle, card_id=card['card_id'], row=3, column=3)
            assert result['status'] == 'Committed' and result['sun_before'] - result['sun_after'] == 100, result
            summary['plant'] = result
            rejected = ok('plant', battle_id=battle, card_id=card['card_id'], row=3, column=4)
            assert rejected['status'] == 'rejected', rejected
            summary['cooldown_rejection'] = rejected
            assert request('plant', battle_id=battle, card_id=card['card_id'], row=0, column=1)['ok'] is False
            assert request('plant', battle_id='stale', card_id=card['card_id'], row=3, column=4)['ok'] is False
            summary['cell'] = ok('inspect_cell', battle_id=battle, row=3, column=3)
            summary['recipe'] = ok('fusion_recipe', first_type=0, second_type=0)
            deadline = time.monotonic() + 40
            collected = False
            while time.monotonic() < deadline:
                state = ok('observe')
                if state.get('suns') and not collected:
                    summary['collect_request'] = ok('collect', battle_id=battle, sun_ids=[state['suns'][0]['sun_id']])
                    summary['sun_at_collect'] = state['sun']
                    collected = True
                fresh = next(c for c in state['cards'] if c['card_id'] == card['card_id'])
                if fresh['cooldown'] <= 0 and collected:
                    break
                time.sleep(.25)
            if not collected:
                raise RuntimeError('No natural sun observed within fixture limit')
            summary['fusion'] = ok('plant', battle_id=battle, card_id=card['card_id'], row=3, column=3)
            assert summary['fusion']['status'] == 'Committed', summary['fusion']
            summary['after'] = ok('observe')
            summary['shovel'] = request('shovel', battle_id=battle, entity_id=summary['fusion']['plants'][0]['entity_id'])
            summary['passed'] = True
        except Exception as exc:
            summary['passed'] = False
            summary['error'] = str(exc)
            try:
                summary['diagnostics'] = ok('diagnostics')
                summary['menu'] = ok('menu')
            except Exception:
                pass
        finally:
            summary['release'] = request('detach')
            (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf8')
            print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    if not summary['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
