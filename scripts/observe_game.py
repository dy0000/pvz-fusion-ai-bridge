"""Read the maintained Fusion host without taking control or issuing input."""
import json
from client import FusionClient
with FusionClient() as game:
    result = {}
    for op in ('capabilities', 'observe', 'menu'):
        reply = game.request(op)
        if not reply.get('ok'):
            raise RuntimeError(reply.get('error', 'Native observation failed'))
        result[op] = reply['result']
    print(json.dumps(result, ensure_ascii=False))
