"""Bounded native glove/ability probes on an unlocked normal adventure board."""
from pathlib import Path
import json
import argparse
import time
import uuid
from client import FusionClient

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    scenario = parser.add_mutually_exclusive_group()
    scenario.add_argument('--disassembly-gate', action='store_true')
    scenario.add_argument('--present', action='store_true')
    args = parser.parse_args()
    output = ROOT / 'evidence' / ('mechanisms-' + uuid.uuid4().hex[:12])
    output.mkdir(parents=True)
    print(output, flush=True)
    summary = {'completed': False}
    with FusionClient() as game, (output / 'calls.jsonl').open('a', encoding='utf8', buffering=1) as log:
        def request(op, **args):
            log.write(json.dumps({'op': op, 'arguments': args}, ensure_ascii=False) + '\n')
            response = game.request(op, **args)
            log.write(json.dumps({'response': response}, ensure_ascii=False) + '\n')
            if not response.get('ok'):
                raise RuntimeError(response)
            return response['result']

        def wait_state(predicate):
            end = time.monotonic() + 25
            while time.monotonic() < end:
                state = request('observe')
                if predicate(state):
                    return state
                time.sleep(.2)
            raise RuntimeError('Native scene transition did not complete')

        def press(predicate):
            end = time.monotonic() + 20
            while time.monotonic() < end:
                menu = request('menu')
                actions = [a for a in menu['actions'] if a['enabled'] and predicate(a)]
                if len(actions) == 1:
                    return request('menu_action', menu_id=menu['menu_id'], action_id=actions[0]['action_id'])
                time.sleep(.2)
            raise RuntimeError('Expected native menu action did not become available')

        try:
            initial = request('observe')
            defeated = initial['phase'] == 'paused' and initial.get('level_type') == 'Advanture' and 4 <= initial.get('level', 0) <= 9
            if initial['phase'] != 'menu' and not defeated:
                raise RuntimeError('Probe starts only from the released main menu or an early adventure defeat')
            request('attach')
            if defeated:
                press(lambda a: a['name'] == 'backtomenu' and '/LoseMenu(' in a['path'])
                wait_state(lambda s: s['phase'] == 'menu')
            menu = request('menu')
            if any(a['enabled'] and 'NoticePauseMenu' in a['path'] for a in menu['actions']):
                press(lambda a: 'NoticePauseMenu' in a['path'])
            press(lambda a: a['name'] == 'AdvantureLevels')
            state = wait_state(lambda s: s['phase'] == 'selection')
            if state.get('level_type') != 'Advanture' or not 4 <= state.get('level', 0) <= 9:
                raise RuntimeError('Expected the naturally unlocked early adventure domain')
            summary['level'] = state['level']
            selections = [('Present', 100)] if args.present else [('SunFlower', 50), ('Peashooter', 100), ('WallNut', 50), ('CherryBomb', 150)]
            for name, cost in selections:
                card = next(c for c in state['cards'] if c['name'] == name and c['cost'] == cost and c['zombie_type'] == 0)
                request('choose_card', battle_id=state['battle_id'], card_id=card['card_id'], selected=True)
            request('start_battle', battle_id=state['battle_id'])
            state = wait_state(lambda s: s['phase'] == 'running')
            battle = state['battle_id']
            if args.present:
                card = next(c for c in state['cards'] if c['name'] == 'Present' and c['on_bank'])
                summary['special_card'] = card
                summary['plant'] = request('plant', battle_id=battle, card_id=card['card_id'], row=3, column=5)
                assert summary['plant']['status'] == 'Committed'
                assert summary['plant']['sun_before'] - summary['plant']['sun_after'] == card['cost']
                time.sleep(1)
                state = request('observe')
                summary['after_special_card'] = state
                gift = next((p for p in state['plants'] if p['name'] == 'Present' and p['row'] == 3 and p['column'] == 5), None)
                assert gift is not None, 'No observed gift target for the native interaction probe'
                summary['special_interaction'] = request('interact', battle_id=battle, entity_id=gift['entity_id'])
                time.sleep(1)
                summary['after_special_interaction'] = request('observe')
                transformed = summary['after_special_interaction']['plants']
                summary['special_effect'] = [p for p in transformed if p['row'] == gift['row'] and p['column'] == gift['column'] and p['entity_id'] != gift['entity_id']]
                assert all(p['entity_id'] != gift['entity_id'] for p in transformed)
                assert summary['special_effect'], 'Native gift interaction produced no observed replacement'
            elif args.disassembly_gate:
                request('auto_collect', battle_id=battle, enabled=True)
                steps = [('SunFlower', 3, 1), ('Peashooter', 3, 1)]
                deadline = time.monotonic() + 240
                target = None
                while time.monotonic() < deadline:
                    state = request('observe')
                    if state['phase'] != 'running' or state['battle_id'] != battle:
                        raise RuntimeError('Disassembly gate probe left its intended running board')
                    ready = {c['name']: c for c in state['cards'] if c['on_bank'] and c['cooldown'] <= 0 and c['cost'] <= state['sun'] and not c['disabled']}
                    action = steps[0] if steps else None
                    if not steps:
                        target = next((p for p in state['plants'] if p['name'] == 'PeaSunFlower' and p['row'] == 3 and p['column'] == 1), None)
                        if not target:
                            raise RuntimeError('Required observed fused plants are no longer available')
                        if state['sun'] >= 500:
                            assert state['disassembly']['available'] is False
                            assert state['disassembly']['reason'] == 'native_mode_or_travel_buff_required'
                            summary['reverse_recipe'] = request('fusion_recipe', first_type=target['plant_type'], mode='disassemble')
                            summary['disassembly'] = request('disassemble', battle_id=battle, entity_id=target['entity_id'])
                            assert summary['disassembly']['status'] == 'rejected_by_game'
                            assert summary['disassembly']['reason'] == 'native_mode_or_travel_buff_required'
                            assert summary['disassembly']['sun_before'] == summary['disassembly']['sun_after']
                            break
                        for row in range(1, state['rows']+1):
                            if row != 3 and not any(p['row'] == row and p['column'] == 3 for p in state['plants']):
                                action = ('Peashooter', row, 3)
                                break
                        if not action and len([p for p in state['plants'] if p['name'] in ('SunFlower', 'PeaSunFlower')]) < 5:
                            for row in range(1, state['rows']+1):
                                if not any(p['row'] == row and p['column'] == 1 for p in state['plants']):
                                    action = ('SunFlower', row, 1)
                                    break
                    if action and action[0] in ready:
                        card = ready[action[0]]
                        result = request('plant', battle_id=battle, card_id=card['card_id'], row=action[1], column=action[2])
                        if result['status'] != 'Committed':
                            raise RuntimeError('Native disassembly gate setup action was rejected')
                        if steps:
                            steps.pop(0)
                    time.sleep(.25)
                else:
                    raise RuntimeError('Natural sun budget did not reach the disassembly threshold')
            else:
                for name in ('WallNut', 'CherryBomb'):
                    card = next(c for c in state['cards'] if c['name'] == name and c['on_bank'])
                    result = request('plant', battle_id=battle, card_id=card['card_id'], row=3, column=5)
                    if result['status'] != 'Committed':
                        raise RuntimeError('Native probe plant/fusion was rejected')
                state = request('observe')
                plant = next(p for p in state['plants'] if p['row'] == 3 and p['column'] == 5)
                summary['fusion'] = plant
                summary['move'] = request('move_plant', battle_id=battle, entity_id=plant['entity_id'], row=3, column=6)
                assert summary['move']['status'] == 'Committed'
                summary['cooldown_rejection'] = request('move_plant', battle_id=battle, entity_id=plant['entity_id'], row=3, column=5)
                assert summary['cooldown_rejection']['status'] == 'rejected_by_game'
                summary['disassembly'] = request('disassemble', battle_id=battle, entity_id=plant['entity_id'])
                assert summary['disassembly']['status'] == 'rejected_by_game'
                summary['ability'] = request('interact', battle_id=battle, entity_id=plant['entity_id'])
                time.sleep(1)
                summary['after_ability'] = request('observe')
                summary['ability_entity_removed'] = all(p['entity_id'] != plant['entity_id'] for p in summary['after_ability']['plants'])
                if not summary['ability_entity_removed']:
                    summary['shovel'] = request('shovel', battle_id=battle, entity_id=plant['entity_id'])
                    assert summary['shovel']['status'] == 'Committed'
            summary['flow'] = request('flow')
            press(lambda a: a['name'] == 'BackToMainMenu')
            press(lambda a: a['name'] == 'mainmenu' and '/PauseMenu(' in a['path'])
            press(lambda a: a['name'] == 'Confirm' and 'PauseMenu_checkQuit' in a['path'])
            summary['final'] = wait_state(lambda s: s['phase'] == 'menu')
            summary['checks_completed'] = True
        except Exception as exc:
            summary['error'] = f'{type(exc).__name__}: {exc}'
        finally:
            summary['release'] = request('detach')
            summary['completed'] = bool(summary.get('checks_completed') and summary['release']['selection_released'] and summary['release']['input_override_released'] and not summary['release']['controlled'] and not summary['release']['auto_collect'] and summary['release']['held_os_inputs'] == 0)
            (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf8')
            print(json.dumps({k: v for k, v in summary.items() if k not in ('after_ability', 'ability', 'flow', 'final', 'after_disassembly', 'after_special_card', 'after_special_interaction', 'special_interaction')}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
