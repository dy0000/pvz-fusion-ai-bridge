"""Durable non-replay boundary for native game-currency/inventory transactions."""
from pathlib import Path
import json
import os
import re
import time


class TransactionJournal:
    def __init__(self, path: Path):
        self.path = path
        self.records = json.loads(path.read_text(encoding='utf8')) if path.exists() else {}

    def persist(self):
        pending = self.path.with_suffix('.tmp')
        with pending.open('w', encoding='utf8') as file:
            json.dump(self.records, file, ensure_ascii=True, allow_nan=False, indent=2)
            file.flush()
            os.fsync(file.fileno())
        pending.replace(self.path)

    def execute(self, request, invoke):
        key = request.get('transaction_id')
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', key):
            raise ValueError('A bounded unique transaction_id is required')
        canonical = json.dumps({k: v for k, v in request.items() if k not in ('id', 'token')}, sort_keys=True, allow_nan=False)
        previous = self.records.get(key)
        if previous:
            if previous['canonical'] != canonical:
                raise ValueError('Transaction ID reused with a different payload')
            return previous.get('response', {'ok': True, 'result': {'transaction_id': key, 'status': 'unknown', 'replay_refused': True}})
        self.records[key] = {'transaction_id': key, 'status': 'unknown', 'canonical': canonical, 'created_at': time.time()}
        self.persist()  # Must reach durable storage before the native mutation.
        response = invoke(request)
        # A managed error can follow a partial native mutation. Only an explicit
        # native rejection or queue cancellation proves that nothing committed.
        status = response.get('result', {}).get('status', 'not_started' if response.get('outcome') == 'not_started' else 'unknown')
        self.records[key].update(status=status, response=response)
        self.persist()
        return response

    def receipt(self, key=None):
        values = [self.records.get(key, {'transaction_id': key, 'status': 'not_found'})] if key else list(self.records.values())[-20:]
        public = [{k: v for k, v in value.items() if k != 'canonical'} for value in values]
        return public[0] if key else public
