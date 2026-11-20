import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from receipts import TransactionJournal


class ReceiptTests(unittest.TestCase):
    def test_committed_and_unknown_transactions_are_not_replayed_across_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'purchases.json'
            journal = TransactionJournal(path)
            request = {'id': 'wire-1', 'op': 'rogue_action', 'transaction_id': 'purchase-123', 'offer_id': 'offer', 'max_spend': 5}
            calls = []

            def commit(payload):
                pending = json.loads(path.read_text())[payload['transaction_id']]
                self.assertEqual(pending['status'], 'unknown')
                calls.append(payload)
                return {'ok': True, 'result': {'status': 'Committed'}}

            journal.execute(request, commit)
            replay = TransactionJournal(path).execute({**request, 'id': 'wire-2'}, commit)
            self.assertEqual(replay['result']['status'], 'Committed')
            self.assertEqual(len(calls), 1)
            with self.assertRaisesRegex(ValueError, 'different payload'):
                journal.execute({**request, 'offer_id': 'another'}, commit)

            unknown = {**request, 'transaction_id': 'purchase-unknown'}

            def lost_reply(payload):
                calls.append(payload)
                raise ConnectionError('native commit may already have happened')

            with self.assertRaises(ConnectionError):
                journal.execute(unknown, lost_reply)
            restarted = TransactionJournal(path)
            refused = restarted.execute({**unknown, 'id': 'wire-3'}, commit)
            self.assertTrue(refused['result']['replay_refused'])
            self.assertEqual(len(calls), 2)
            self.assertEqual(restarted.receipt('purchase-unknown')['status'], 'unknown')
            native_error = {**request, 'transaction_id': 'purchase-native-error'}
            def partial_failure(payload):
                calls.append(payload)
                return {'ok': False, 'error': 'managed exception after a possible mutation'}
            restarted.execute(native_error, partial_failure)
            restarted = TransactionJournal(path)
            self.assertEqual(restarted.receipt('purchase-native-error')['status'], 'unknown')
            restarted.execute(native_error, commit)
            self.assertEqual(len(calls), 3)


if __name__ == '__main__':
    unittest.main()
