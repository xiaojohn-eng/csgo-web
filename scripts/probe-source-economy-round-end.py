#!/usr/bin/env python3
"""Pin and report original Source round-end loss-streak instructions."""
import argparse, hashlib, json, runpy
from pathlib import Path

EXPECTED_SHA = '5dc259006b3251e48c39cf30a86aae149da36c975fda054d0314907b7391845c'

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--binary', type=Path, default=Path('.reference-assets/csgo-legacy/csgo/bin/linux64/server_client.so'))
    p.add_argument('--output', type=Path, default=Path('output/goal-objective-timers-20260913/economy-round-end-receipt.json'))
    a = p.parse_args()
    b = runpy.run_path('scripts/source-binary-index.py')['open_binary'](a.binary)
    digest = hashlib.sha256(b.data).hexdigest(); assert digest == EXPECTED_SHA, digest
    def string_xref(va, value):
        assert b.string_at(va) == value, (hex(va), b.string_at(va), value)
        return {'va': hex(va), 'value': value}
    def check(va, hexbytes):
        got = b.bytes_at(va, len(bytes.fromhex(hexbytes))).hex(); assert got == hexbytes, (hex(va), got, hexbytes)
    registration = {
        'startingLosses': {'name': string_xref(0x1435d80, 'mp_starting_losses'), 'default': string_xref(0x13c20be, '0'), 'leaName': '0x5bf75b'},
        'lossAversion': {'name': string_xref(0x1435d93, 'mp_consecutive_loss_aversion'), 'default': string_xref(0x148196d, '1'), 'leaName': '0x5bf7b0'},
        'lossMax': {'name': string_xref(0x1435db0, 'mp_consecutive_loss_max'), 'leaName': '0x5bf805'},
        'lossAversionHelp': string_xref(0x143e8d0, 'How loss streak is affected with round win: 0 = win fully resets loss bonus, 1 = first win steps down loss bonus, 2 = first win holds loss bonus and step down starting with second win'),
    }
    blocks = {
      'roundEnd': (0xd97b10, 0xd98acb), 'aversionDispatch': (0xd98564, 0xd9857f),
      'defaultReset': (0xd98589, 0xd985a0), 'aversionOneStepDown': (0xd9882e, 0xd9884f),
      'aversionTwoStepDown': (0xd98851, 0xd98891), 'otherTeamOneStepDown': (0xd988a9, 0xd988cb),
      'otherTeamTwoStepDown': (0xd988cc, 0xd9890c)}
    for va, code in [(0xd98570, '83f801'), (0xd98579, '83f802'), (0xd98599, '488d3da0dcff00'),
                     (0xd9882e, '8b80b40e0000'), (0xd9883b, '83eb01'), (0xd9883e, '0f48da'),
                     (0xd9884a, '41899fb40e0000'), (0xd98a30, 'c780b40e000000000000'),
                     (0xd988a9, '8b80b00e0000'), (0xd988b6, '83eb01'), (0xd988c5, '41899fb00e0000')]: check(va, code)
    evidence = {name: [{'va': hex(i.address), 'bytes': i.bytes.hex(), 'asm': i.mnemonic + ' ' + i.op_str}
                       for i in b.instructions(start, end-start)] for name, (start, end) in blocks.items()}
    receipt = {'schema': 1, 'build': 'CSGO legacy 12426148', 'binary': str(a.binary), 'sha256': digest,
      'roundEndFunction': {'va': '0xd97b10', 'length': '0xfbb', 'role': 'round-end economy/score handler'},
      'registration': registration,
      'findings': {'competitiveConfig': {'mp_starting_losses': 1}, 'shortConfig': {'mp_starting_losses': 2},
        'defaultMpConsecutiveLossAversion': 1, 'aversion0': 'winner loss bonus fully resets',
        'aversion1': 'winner loss counter steps down one rung, clamped at zero',
        'aversion2': 'first win holds loss bonus; subsequent win steps down'},
      'nativeEvidence': evidence,
      'limitations': ['No original server/session is executed; this pins and disassembles the round-end branch.',
        'The original function reads live game-rule fields and ConVars; this receipt does not infer UI cash timing.',
        'The original planted-bomb loser award is separately registered as 800 at 0x5c0d07/0x5c0d0e; this probe does not emulate award accumulation.']}
    a.output.parent.mkdir(parents=True, exist_ok=True); a.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'status':'passed', 'sha256': digest, 'output': str(a.output), 'roundEnd':'0xd97b10'}))
if __name__ == '__main__': main()
