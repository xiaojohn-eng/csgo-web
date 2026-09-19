"""Measure what build 12426148's `Movement Basic` does, by running it.

Reading the operator's assembly left the position update ambiguous, and a wrong reading
would move every smoke particle silently. The repository already executes original
operators for semantics it could not read, so this does the same: it builds a collection
whose position buffers hold known values, sets the operator's own gravity and drag from
its own unpack schema, calls the original post-unpack and apply methods, and reads the
buffers back. The update rule is derived from those numbers instead of assumed.

Run: PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages \
     python3 scripts/probe-source-movement-basic-apply.py
"""
import contextlib
import io
import json
import math
import runpy
import struct
from pathlib import Path
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ_UNMAPPED, UC_HOOK_MEM_WRITE_UNMAPPED
from unicorn.x86_const import UC_X86_REG_EIP, UC_X86_REG_ESP

ROOT = Path(__file__).resolve().parents[1]
with contextlib.redirect_stdout(io.StringIO()):
    defaults = runpy.run_path(str(ROOT / 'scripts/probe-source-pistol-particle-defaults.py'))
u = defaults['u']
segments = defaults['segments']
BASE = 0x21000000
u.mem_map(BASE, 0x40000)
OP, COL, CTX = BASE, BASE + 0x1000, BASE + 0x2000
# The collection points at its particle definition, and an all-zero definition is what makes
# the operator skip its control-point bookkeeping and run the position update this measures.
CONFIG = BASE + 0x8000
# This apply method reserves about 60 KB of stack, so the executing harness's own 8 KB
# region is not enough and the call is given a megabyte of its own with its own return
# sentinel, rather than reaching below the region the harness mapped.
STACK_TOP = 0x20000000
u.mem_map(STACK_TOP - 0x100000, 0x100000)
MY_STACK = STACK_TOP - 0x8000
MY_RET = MY_STACK + 0x1000
# The apply method's drag term is `exp(30 * dt * log(1 - max(drag, 0))) * (dt / interval)`.
# Both libm calls are PC-relative stubs the executing harness refuses to run, so each call
# site is rerouted to a stub of this probe's own that loads the value Python computes for
# the very same expression into the x87 stack. Everything else -- the position algebra this
# measurement is about -- is the original code, unmodified.
CALL_SITES = {'log': 0xd0d887, 'exp': 0xd0d8b7}
POST_UNPACK, APPLY = 0xd2c0c0, 0xd0d800
# The harness walks every instruction with its own hook, which reads the file image to spot
# calls onto import slots. Those two calls are handled by the stubs instead, so they are
# taken out of its table; the stubs themselves live in a zero run inside the text segment,
# where that hook's own address lookup still works and its byte test sees a non-call.
defaults['imports'].pop(0xd0d888, None)
defaults['imports'].pop(0xd0d8b8, None)
_segment = next(segment for segment in segments if segment['p_vaddr'] <= APPLY < segment['p_vaddr'] + segment['p_filesz'])
_file = defaults['raw'][_segment['p_offset']:_segment['p_offset'] + _segment['p_filesz']]
_zero = _file.find(b'\0' * 64)
if _zero < 0:
    raise SystemExit('The text segment has no zero run to host a stub')
STUB_BASE = _segment['p_vaddr'] + _zero + 16
MEMORY = u


def reroute(call_site, value, slot):
    constant = STUB_BASE + 0x100 * slot
    stub = STUB_BASE + 0x10 * slot
    MEMORY.mem_write(constant, struct.pack('<f', value))
    MEMORY.mem_write(stub, b'\xd9\x05' + struct.pack('<I', constant) + b'\xc3')
    displacement = stub - (call_site + 5)
    MEMORY.mem_write(call_site, b'\xe8' + struct.pack('<i', displacement))


schema = next(row for row in defaults['result'] if row['functionName'] == 'Movement Basic')
field = {row['name']: row for row in schema['fields']}
print('schema fields:', {name: (row['offset'], row['nativeType']) for name, row in field.items()})


def wi(at, value):
    u.mem_write(at, struct.pack('<I', value))


def wf(at, value):
    u.mem_write(at, struct.pack('<f', value))


def lanes(at, values):
    u.mem_write(at, struct.pack('<4f', *values))


def read(at):
    return list(struct.unpack('<4f', u.mem_read(at, 16)))


def watch(uc, access, address, size, value, data):
    print('  UNMAPPED WRITE', hex(address), 'size', size, 'eip', hex(uc.reg_read(UC_X86_REG_EIP)))
    return False


u.hook_add(UC_HOOK_MEM_WRITE_UNMAPPED, watch)


def watch_read(uc, access, address, size, value, data):
    print('  UNMAPPED READ', hex(address), 'size', size, 'eip', hex(uc.reg_read(UC_X86_REG_EIP)))
    return False


u.hook_add(UC_HOOK_MEM_READ_UNMAPPED, watch_read)


def stop_at_sentinel(uc, address, size, data):
    if address == MY_RET:
        uc.emu_stop()


u.hook_add(UC_HOOK_CODE, stop_at_sentinel)


def call(entry, operator, collection, scale, context):
    stack = MY_STACK
    u.mem_write(stack, struct.pack('<IIIfI', MY_RET, operator, collection, scale, context))
    u.reg_write(UC_X86_REG_ESP, stack)
    u.emu_start(entry, MY_RET, count=400000)


def buffer(number, initial=False):
    at = BASE + 0x3000 + number * 0x100 + (0x8000 if initial else 0)
    wi(COL + (0x1a0 if initial else 0xe0) + 4 * number, at)
    wi(COL + (0x200 if initial else 0x140) + 4 * number, 4)
    return at


# The position the operator integrates and the position one step before it. The
# collection's own two sides are the two particle fields, so both are set up here.
POSITION, PREVIOUS = 0, 2
CASES = [
    dict(position=[100.0, 200.0, 300.0, 400.0], previous=[100.0, 200.0, 300.0, 400.0], gravity=(0, 0, 0), drag=0.0, dt=1 / 30),
    dict(position=[100.0, 200.0, 300.0, 400.0], previous=[100.0, 200.0, 300.0, 400.0], gravity=(0, 0, 40), drag=0.0, dt=1 / 30),
    dict(position=[100.0, 200.0, 300.0, 400.0], previous=[100.0, 200.0, 300.0, 400.0], gravity=(0, 0, 40), drag=0.05, dt=1 / 30),
    dict(position=[101.0, 199.0, 305.0, 390.0], previous=[100.0, 200.0, 300.0, 400.0], gravity=(0, 0, 0), drag=0.05, dt=1 / 30),
    dict(position=[101.0, 199.0, 305.0, 390.0], previous=[100.0, 200.0, 300.0, 400.0], gravity=(0, 0, 40), drag=0.05, dt=1 / 30),
    dict(position=[101.0, 199.0, 305.0, 390.0], previous=[100.0, 200.0, 300.0, 400.0], gravity=(0, 0, 40), drag=0.5, dt=1 / 30),
    dict(position=[101.0, 199.0, 305.0, 390.0], previous=[100.0, 200.0, 300.0, 400.0], gravity=(0, 0, 40), drag=0.05, dt=1 / 60),
    dict(position=[101.0, 199.0, 305.0, 390.0], previous=[100.0, 200.0, 300.0, 400.0], gravity=(2, 0, 40), drag=0.05, dt=1 / 30),
]
rows = []
residual = 0.0
unchanged = True
for case in CASES:
    u.mem_write(OP, b'\0' * 0x300)
    u.mem_write(COL, b'\0' * 0x400)
    u.mem_write(CTX, b'\0' * 0x100)
    u.mem_write(CONFIG, b'\0' * 0x400)
    wi(COL + 0x48, CONFIG)
    for name, value in (('gravity', case['gravity']), ('drag', case['drag'])):
        row = field[name]
        if row['nativeType'] == 3:
            wf(OP + row['offset'], float(value))
        else:
            for index, part in enumerate(value):
                wf(OP + row['offset'] + 4 * index, float(part))
    reroute(CALL_SITES['log'], math.log(max(1e-30, 1 - max(case['drag'], 0.0))), 0)
    reroute(CALL_SITES['exp'], math.exp(30.0 * case['dt'] * math.log(max(1e-30, 1 - max(case['drag'], 0.0)))), 1)
    call(POST_UNPACK, OP, COL, 0.0, 0)
    wi(COL + 0x20, 1)
    wi(COL + 0x30, 4)
    wf(COL + 0x24, case['dt'])
    wf(COL + 0x34, case['dt'])
    wf(COL + 0x38, 1 / 30)
    before = {}
    for number, values in ((POSITION, case['position']), (PREVIOUS, case['previous'])):
        at = buffer(number)
        lanes(at, values)
        lanes(at + 0x10, values)
        lanes(at + 0x20, values)
        before[number] = [read(at + step) for step in (0, 0x10, 0x20)]
    lanes(COL + 0x10, [0.0] * 4)
    call(APPLY, OP, COL, 1.0, CTX)
    after = {}
    for number in (POSITION, PREVIOUS):
        at = buffer(number)
        after[number] = [read(at + step) for step in (0, 0x10, 0x20)]
    rows.append(dict(case=case, before=before, after=after))
    # The candidate rule this measurement is here to test: the operator advances one of the
    # two position slots by `d * (position - previous)` plus `g * dt * dt`, and leaves the
    # other slot exactly as it found it.
    d = math.pow(max(1e-30, 1 - max(case['drag'], 0.0)), 30.0 * case['dt']) * (case['dt'] / (1 / 30))
    for lane in range(4):
        for axis in range(3):
            expected = (before[POSITION][axis][lane]
                        + d * (before[POSITION][axis][lane] - before[PREVIOUS][axis][lane])
                        + case['gravity'][axis] * case['dt'] * case['dt'])
            residual = max(residual, abs(after[PREVIOUS][axis][lane] - expected))
            unchanged = unchanged and abs(after[POSITION][axis][lane] - before[POSITION][axis][lane]) < 1e-6
    print('case', json.dumps({k: v for k, v in case.items() if k != 'position'}), 'residual so far', residual)
report = dict(
    format='source-movement-basic-apply-v1',
    binary='.reference-assets/csgo-legacy/csgo/bin/client_client.so',
    method=dict(postUnpack='0xd2c0c0', apply='0xd0d800', instanceVTable='0x1110ca8'),
    operatorSchema={name: dict(offset=row['offset'], nativeType=row['nativeType']) for name, row in field.items()},
    substeps='The apply method\'s two libm calls (__logf_finite and __expf_finite) are replaced at their call '
            'sites by stubs that load the value Python computes for `log(1 - max(drag,0))` and '
            '`exp(30 * dt * that)`; every other instruction, including the position algebra, is the original code.',
    derived='output = position + dragFactor * (position - previous) + gravity * dt * dt, with '
            'dragFactor = (1 - max(drag, 0)) ** (30 * dt) * (dt / tickInterval). The operator writes the second '
            'position slot and leaves the first untouched; the two slots are swapped afterwards, so the value it '
            'wrote becomes the next call\'s position.',
    maxLaneError=residual,
    firstSlotUnchanged=unchanged,
    cases=rows,
    notYetRead='How a particle gets its first displacement is not measured here: the initializer that gives a spawn '
               'speed has to seed the pair for this operator to move a particle at that speed, and that seeding has '
               'not been read yet.',
    boundary='This executes the shipped apply method over synthetic buffers. It states the position update and the '
             'drag factor; it does not state the initializer, the scheduler or the RNG.',
)
(ROOT / 'output/source-movement-basic-apply.json').write_text(json.dumps(report, indent=2) + '\n')
(ROOT / 'research/source-movement-basic-apply.json').write_text(json.dumps(report, indent=2) + '\n')
print('MAX_LANE_ERROR', residual, 'FIRST_SLOT_UNCHANGED', unchanged)
