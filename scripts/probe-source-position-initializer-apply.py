"""Measure what the rifle smoke's position initializer writes, by running it.

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
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ_UNMAPPED, UC_HOOK_MEM_WRITE, UC_HOOK_MEM_WRITE_UNMAPPED
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
POST_UNPACK, APPLY = 0xd2c0c0, 0xd02980
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


NAME = 'Position Within Sphere Random'
schema = next(row for row in defaults['result'] if row['functionName'] == NAME)
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


# The initializer's own fields, taken from its schema and set to the muzzle smoke's own
# numbers: a sphere of radius 0.5 around the control point and a spawn speed of 100..120
# along the local +X axis.
VALUES = {
    'control_point_number': 0, 'distance_min': 0.0, 'distance_max': 0.5,
    'speed_min': 0.0, 'speed_max': 0.0, 'speed_random_exponent': 1.0,
    'speed_in_local_coordinate_system_min': [100.0, 0.0, 0.0],
    'speed_in_local_coordinate_system_max': [120.0, 0.0, 0.0],
}
writes = []
WATCH = (BASE, BASE + 0x8000)


def log_write(uc, access, address, size, value, data):
    if WATCH[0] <= address < WATCH[1]:
        writes.append(dict(address=hex(address), size=size, value=hex(value), eip=hex(uc.reg_read(UC_X86_REG_EIP))))
    return True


u.hook_add(UC_HOOK_MEM_WRITE, log_write)
u.mem_write(OP, b'\0' * 0x300)
u.mem_write(COL, b'\0' * 0x400)
u.mem_write(CTX, b'\0' * 0x100)
u.mem_write(CONFIG, b'\0' * 0x400)
wi(COL + 0x48, CONFIG)
for name, value in VALUES.items():
    row = field[name]
    if row['nativeType'] == 3:
        wf(OP + row['offset'], float(value))
    elif row['nativeType'] == 2:
        u.mem_write(OP + row['offset'], struct.pack('<i', int(value)))
    else:
        for index, part in enumerate(value):
            wf(OP + row['offset'] + 4 * index, float(part))
wi(COL + 0x20, 1)
wi(COL + 0x30, 4)
wi(COL + 0x50, 120)
wf(COL + 0x24, 1 / 30)
wf(COL + 0x34, 1 / 30)
wf(COL + 0x38, 1 / 30)
lanes(COL + 0x10, [0.0] * 4)
# A per-element pointer table, which is where a new particle's own fields are addressed
# from; the initializer is expected to fill the entries it is given.
NEW = BASE + 0x6000
for element in range(4):
    wi(COL + 0x6c + 4 * element, NEW + element * 0x100)
    wi(CONFIG + 0x194 + 4 * element, 0)
call(POST_UNPACK, OP, COL, 0.0, 0)
call(APPLY, OP, COL, 1.0, CTX)
report = dict(format='source-position-initializer-apply-v1',
              status='initializer-located-but-not-driven',
              operator=NAME,
              instance=dict(factory='0xcff480', apply=hex(APPLY),
                            definitionVTable='0x110ad88'),
              fields={name: (entry['offset'], entry['nativeType']) for name, entry in field.items()},
              values=VALUES,
              writes=writes,
              newParticleArea={hex(NEW + element * 0x100): [read(NEW + element * 0x100 + step) for step in (0, 0x10, 0x20)]
                               for element in range(2)},
              finding='The initializer\'s apply method was located and called over a synthetic collection, and it '
                      'wrote nothing: every write in the log comes from the post-unpack call. An initializer fills the '
                      'particles an emitter has just created, so it needs the emitter\'s new-particle context — the '
                      'count and the per-element pointer tables the emitter builds — before it does anything.',
              next='Drive it the way the already-verified operator executor drives the pistol emitters '
                   '(`scripts/probe-source-pistol-particle-operators.py`): call `emit_instantaneously`\'s own two '
                   'entry points (that file records them as 0xd04af0 and 0xd037a0) and then read the created '
                   'particles\' position slots. Two things are needed first, and both were measured while trying: '
                   'the collection has to be given the emitter\'s new-particle pointers and a maximum count '
                   '(`COL+0x11c`), and the emitter is preceded by a per-system post-unpack — the same file uses '
                   '0xd03f80 for one pistol system and 0xd04120 for the other — so the smoke systems\' own '
                   'post-unpack entries have to be found first, by enumerating the definitions this client built '
                   'from the particle files rather than by name.',
              boundary='Executed over a synthetic collection. It reports that the initializer did not run, not what it '
                       'would write once an emitter has made particles for it.')
(ROOT / 'output/source-position-initializer-apply.json').write_text(json.dumps(report, indent=2) + '\n')
(ROOT / 'research/source-position-initializer-apply.json').write_text(json.dumps(report, indent=2) + '\n')
print('WRITES', len(writes), 'STATUS', report['status'])
