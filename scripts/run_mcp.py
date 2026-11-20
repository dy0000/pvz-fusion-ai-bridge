"""MCP stdio adapter for the separate local fusion bridge. No action retries."""
from __future__ import annotations

import json
import math
import sys

from client import FusionClient, release_confirmed


def schema(properties=None, required=()):
    return {"type": "object", "properties": properties or {}, "required": list(required), "additionalProperties": False}


def tool(name, description, op, properties=None, required=()):
    return {"name": "pvzf_" + name, "description": description, "inputSchema": schema(properties, required), "_op": op}


STRING = {"type": "string", "minLength": 1}
BATTLE = {"battle_id": STRING}
CELL = {**BATTLE, "row": {"type": "integer", "minimum": 1}, "column": {"type": "integer", "minimum": 1}}
TOOLS = [
    tool("capabilities", "Read Fusion 4.1 bridge support and limitations.", "capabilities"),
    tool("observe", "Read native phase, sun, cards, cooldowns, plants, zombies and suns. IDs expire with battle/session.", "observe"),
    tool("menu", "Read native visible menu actions and text; use current menu_id/action_id.", "menu"),
    tool("take_control", "Take exclusive realtime control. F8/F9 lock requires the player's F10.", "attach"),
    tool("release_control", "Release AI-owned selection, bounded input and automatic pickup; require selection_released and input_override_released. Borrowed player selection is preserved.", "detach"),
    tool("stop", "Stop AI actions and release its selection.", "stop"),
    tool("menu_action", "Activate an observed enabled native button. Observe the next phase after navigation_requested.", "menu_action", {"menu_id":STRING,"action_id":STRING}, ("menu_id","action_id")),
    tool("choose_card", "Select/deselect an observed candidate using the native card callback and its normal limits.", "choose_card", {**BATTLE,"card_id":STRING,"selected":{"type":"boolean"}}, ("battle_id","card_id")),
    tool("start_battle", "Start the selected native battle. Observe until running.", "start_battle", BATTLE, ("battle_id",)),
    tool("plant", "Plant or fuse an observed card into a 1-based cell via native placement, cost and cooldown. Only Committed confirms a changed plant; unknown outcomes must not be replayed.", "plant", {**BATTLE,"card_id":STRING,"row":{"type":"integer","minimum":1},"column":{"type":"integer","minimum":1}}, ("battle_id","card_id","row","column")),
    tool("fusion_recipe", "Query this build's native fusion recipe for two observed plant_type integers. Does not place anything.", "fusion_recipe", {"first_type":{"type":"integer"},"second_type":{"type":"integer"},"mode":{"type":"string","enum":["normal","random","disassemble"]}}, ("first_type",)),
    tool("inspect_cell", "Read native terrain, water, graves, craters, supports and layered plants for one cell.", "inspect_cell", {**BATTLE,"row":{"type":"integer","minimum":1},"column":{"type":"integer","minimum":1}}, ("battle_id","row","column")),
    tool("collect", "Collect observed suns using native pickup animation. Credit occurs later.", "collect", {**BATTLE,"sun_ids":{"type":"array","items":STRING,"minItems":1,"maxItems":128}}, ("battle_id","sun_ids")),
    tool("auto_collect", "Enable/disable native sun pickup for this battle; stops on release/disconnect/battle change.", "auto_collect", {**BATTLE,"enabled":{"type":"boolean"}}, ("battle_id","enabled")),
    tool("shovel", "Use the native shovel on an observed plant, preserving native restrictions.", "shovel", {**BATTLE,"entity_id":STRING}, ("battle_id","entity_id")),
    tool("mechanisms", "Read active tools, minigames, rogue preparation, tutorial and reward flow.", "mechanisms"),
    tool("placement_check", "Ask the native placement rules about one current card and terrain/layered cell. Does not plant.", "placement_check", {**CELL,"card_id":STRING}, ("battle_id","card_id","row","column")),
    tool("move_plant", "Move an observed plant with the native glove. Cooldown, ownership, terrain and native layer selection apply.", "move_plant", {**CELL,"entity_id":STRING}, ("battle_id","entity_id","row","column")),
    tool("disassemble", "Use native non-forced fusion disassembly on an observed plant. Native unlock, sun cost and tool restrictions apply.", "disassemble", {**BATTLE,"entity_id":STRING}, ("battle_id","entity_id")),
    tool("interact", "Activate an observed plant ability or click a cell/grid item/world point. With item_id from equipment_drops and a plant entity_id, pick up and apply that native equipment in one released action. Native restrictions apply; unknown outcomes are not replayed.", "interact", {**BATTLE,"entity_id":STRING,"item_id":STRING,"row":{"type":"integer","minimum":1},"column":{"type":"integer","minimum":1},"x":{"type":"number"},"y":{"type":"number"}}, ("battle_id",)),
    tool("fire", "Select an observed ready cannon and aim at a 1-based cell through native input logic. Observe after fire_requested.", "fire", {**CELL,"entity_id":STRING}, ("battle_id","entity_id","row","column")),
    tool("cycle_towards", "Cycle the game's native placement direction button once.", "cycle_towards", BATTLE, ("battle_id",)),
    tool("next_wave", "Request one next wave only when the native control is ready.", "next_wave", BATTLE, ("battle_id",)),
    tool("flow", "Read tutorial progress, active quests, reward IDs, failure/result dialogs and native menu actions. Never marks victory itself.", "flow"),
    tool("collect_reward", "Click one current native victory reward. Wait for the original scene/result animation; unknown outcomes must not be replayed.", "collect_reward", {**BATTLE,"reward_id":STRING}, ("battle_id","reward_id")),
    tool("choices", "Read native choice titles, descriptions, enabled options and commands, including rogue events and gifts.", "choices"),
    tool("choice_action", "Select an observed enabled native choice, command or page. Shop transactions use rogue_action with a receipt.", "choice_action", {"choice_id":STRING,"action":{"type":"string","enum":["option","command","next","previous","confirm","cancel"]},"index":{"type":"integer","minimum":1}}, ("choice_id","action")),
    tool("minigame_observe", "Read active minigames, visible pieces/balls/fruit/player weapons and offered inputs. Unrevealed mine contents stay hidden.", "minigame_observe"),
    tool("minigame_action", "Perform one offered native swap, chess move/turn, 2048 move, pot click or tower branch/shoot action.", "minigame_action", {**CELL,"game_id":STRING,"action":{"type":"string","enum":["swap","chess_move","advance_turn","move","break_pot","tower_upgrade","tower_shoot","switch_world"]},"entity_id":STRING,"other_entity_id":STRING,"first_snapshot":{"type":"object","properties":{"row":{"type":"integer","minimum":1,"maximum":6},"column":{"type":"integer","minimum":1,"maximum":10},"plant_type":{"type":"integer"}},"required":["row","column","plant_type"],"additionalProperties":False},"second_snapshot":{"type":"object","properties":{"row":{"type":"integer","minimum":1,"maximum":6},"column":{"type":"integer","minimum":1,"maximum":10},"plant_type":{"type":"integer"}},"required":["row","column","plant_type"],"additionalProperties":False},"direction":{"type":"string","enum":["up","down","left","right"]},"branch":{"type":"integer","minimum":1,"maximum":3}}, ("battle_id","game_id","action")),
    tool("minigame_input", "Send a bounded game-internal key/button/pointer gesture for an observed minigame. No OS input; release, disconnect and transitions clear it. Wait for input.override_released before the next action.", "minigame_input", {"game_id":STRING,"keys":{"type":"array","maxItems":12,"items":{"type":"string","enum":["up","down","left","right","w","a","s","d","space","q","e","r","z","x","c","shift","ctrl"]}},"buttons":{"type":"array","maxItems":3,"items":{"type":"string","enum":["left","right","middle"]}},"x":{"type":"number"},"y":{"type":"number"},"frames":{"type":"integer","minimum":1,"maximum":120},"path":{"type":"array","maxItems":32,"items":schema({"x":{"type":"number"},"y":{"type":"number"}}, ("x","y"))}}, ("game_id",)),
    tool("rogue_observe", "Read Travel Evolution points, health, phase, offers, qualities, deployed/reserve cards, gifts, equipment and native shop quotes.", "rogue_observe"),
    tool("rogue_action", "Perform one native Travel Evolution transaction or preparation action. open_item opens a choice consumable; choose_reward uses a current choice_id only for pending native rewards, never shop offers. choice_opened/choice_requested require observation. A unique transaction_id is persisted before invocation; query purchase_receipt after an unknown outcome. max_spend bounds points and max_health_cost separately bounds health.", "rogue_action", {"rogue_id":STRING,"transaction_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{8,128}$"},"action":{"type":"string","enum":["buy_offer","refresh","upgrade_shop","lock_shop","move_card","merge_cards","sell_card","equip","unequip","craft","use_item","open_item","choose_reward","choose_item","open_gift"]},"choice_id":STRING,"max_spend":{"type":"integer","minimum":0},"max_health_cost":{"type":"integer","minimum":0},"offer_id":STRING,"card_id":{"type":"integer"},"card_ids":{"type":"array","minItems":3,"maxItems":3,"items":{"type":"integer"}},"inventory_id":STRING,"other_inventory_id":STRING,"reserve":{"type":"boolean"},"slot":{"type":"integer","minimum":1},"locked":{"type":"boolean"},"index":{"type":"integer","minimum":1},"gift_id":{"type":"integer"}}, ("rogue_id","transaction_id","action","max_spend")),
    tool("purchase_receipt", "Read persisted native transaction receipts across bridge restarts. Unknown means do not replay the mutation.", "purchase_receipt", {"transaction_id":STRING}),
]


def validate(spec, value):
    kind = spec.get('type')
    valid = {'object': lambda: isinstance(value, dict), 'array': lambda: isinstance(value, list),
             'string': lambda: isinstance(value, str), 'boolean': lambda: isinstance(value, bool),
             'integer': lambda: isinstance(value, int) and not isinstance(value, bool),
             'number': lambda: isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)}
    if kind in valid and not valid[kind]():
        raise ValueError('Invalid tool argument type')
    if 'enum' in spec and value not in spec['enum']:
        raise ValueError('Unsupported tool argument value')
    if kind == 'object':
        properties = spec.get('properties', {})
        if set(value)-set(properties) or set(spec.get('required', ()))-set(value):
            raise ValueError('Invalid tool arguments')
        for name, item in value.items():
            validate(properties[name], item)
    elif kind == 'array':
        if len(value) < spec.get('minItems', 0) or len(value) > spec.get('maxItems', 100000):
            raise ValueError('Invalid tool argument count')
        for item in value:
            validate(spec['items'], item)
    elif kind == 'string':
        if len(value) < spec.get('minLength', 0):
            raise ValueError('Empty tool argument')
        if 'pattern' in spec:
            import re
            if not re.fullmatch(spec['pattern'], value):
                raise ValueError('Invalid tool argument format')
    elif kind in ('integer', 'number') and (value < spec.get('minimum', -math.inf) or value > spec.get('maximum', math.inf)):
        raise ValueError('Tool argument outside allowed range')



def main():
    client = None
    try:
        for line in sys.stdin:
            request_id = None
            error_code = -32700
            try:
                request = json.loads(line)
                error_code = -32600
                if not isinstance(request, dict):
                    raise ValueError("MCP request must be a JSON object")
                candidate_id = request.get("id")
                if "id" in request:
                    if (isinstance(candidate_id, bool) or not isinstance(candidate_id, (str, int, float))
                            or isinstance(candidate_id, float) and not math.isfinite(candidate_id)):
                        raise ValueError("Invalid MCP request ID")
                    request_id = candidate_id
                method = request.get("method")
                if (request.get("jsonrpc") != "2.0" or not isinstance(method, str)
                        or not isinstance(request.get("params", {}), dict)):
                    raise ValueError("Invalid MCP request envelope")
                if "id" not in request:
                    continue  # Valid notifications never receive replies or invoke request tools.
                error_code = -32603
                if method == "initialize":
                    result = {"protocolVersion": request.get("params", {}).get("protocolVersion", "2024-11-05"),
                              "capabilities": {"tools": {}}, "serverInfo": {"name": "pvz-fusion-native", "version": "0.4.0"}}
                elif method == "tools/list":
                    result = {"tools": [{k: v for k, v in t.items() if k != "_op"} for t in TOOLS]}
                elif method == "tools/call":
                    params = request.get("params", {})
                    tool = next(t for t in TOOLS if t["name"] == params["name"])
                    args = params.get("arguments", {})
                    validate(tool['inputSchema'], args)
                    if client is None:
                        client = FusionClient()
                    try:
                        response = client.request(tool["_op"], **args)
                    except Exception:
                        client.close()
                        client = None
                        raise
                    if tool["_op"] in ("detach", "stop") and release_confirmed(response):
                        client.close()
                        client = None
                    result = {"content": [{"type": "text", "text": json.dumps(response, ensure_ascii=False)}], "isError": not response.get("ok", False)}
                elif method == "ping":
                    result = {}
                else:
                    raise ValueError("Unsupported MCP method")
                reply = {"jsonrpc": "2.0", "id": request_id, "result": result}
                encoded = json.dumps(reply, ensure_ascii=True, allow_nan=False)
            except Exception as exc:
                reply = {"jsonrpc": "2.0", "id": request_id, "error": {"code": error_code, "message": str(exc) + "; no automatic action retry"}}
                encoded = json.dumps(reply, ensure_ascii=True, allow_nan=False)
            print(encoded, flush=True)
    finally:
        if client:
            try:
                client.request("detach")
            finally:
                client.close()


if __name__ == "__main__":
    main()
