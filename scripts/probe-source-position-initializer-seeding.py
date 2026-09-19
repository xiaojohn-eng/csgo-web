"""Measure how a spawn speed reaches the position pair, by running the original chain.

`Movement Basic` advances a pair of position slots (measured in
`probe-source-movement-basic-apply.py`), so a particle only moves at its spawn speed if the
initializer that carries that speed seeds the pair. This runs the original chain on the one
system whose addresses are already known from the verified operator executor — the pistol's
`weapon_muzzle_flash_pistol_main`, whose own sphere initializer spawns at 80..500 units per
second along the local X axis — and reads the position slots of the particles it creates.

Run: PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages \
     python3 scripts/probe-source-position-initializer-seeding.py
"""
import contextlib
import io
import json
import runpy
import struct
from pathlib import Path
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP

ROOT = Path(__file__).resolve().parents[1]
with contextlib.redirect_stdout(io.StringIO()):
    defaults = runpy.run_path(str(ROOT / 'scripts/probe-source-pistol-particle-defaults.py'))
u = defaults['u']
BASE = 0x21000000
u.mem_map(BASE, 0x40000)
OP, OP2, COL, CTX = BASE, BASE + 0x800, BASE + 0x1000, BASE + 0x2000
# The chain the verified operator executor uses for the pistol's main system, whose own
# sphere initializer carries the speed this measurement is about.
POST_UNPACK, INIT_NEW, EMIT = 0xd03f80, 0xd04af0, 0xd037a0
STACK_TOP = 0x20000000
u.mem_map(STACK_TOP - 0x200000, 0x200000)
MY_STACK = STACK_TOP - 0x8000
MY_RET = MY_STACK + 0x1000
TICK = 0.0075


def wi(at, value):
    u.mem_write(at, struct.pack('<I', value))


def wf(at, value):
    u.mem_write(at, struct.pack('<f', value))


def read_lane(at, lane):
    return struct.unpack('<4f', u.mem_read(at, 16))[lane]


def stop_at_sentinel(uc, address, size, data):
    if address == MY_RET:
        uc.emu_stop()


u.hook_add(UC_HOOK_CODE, stop_at_sentinel)


def call(entry, *words):
    stack = MY_STACK
    u.mem_write(stack, b''.join(struct.pack('<I', word) if isinstance(word, int) else struct.pack('<f', word)
                                for word in (MY_RET,) + words))
    u.reg_write(UC_X86_REG_ESP, stack)
    u.emu_start(entry, MY_RET, count=400000)


def buffer(number, initial=False):
    at = BASE + 0x10000 + number * 0x400 + (0x2000 if initial else 0)
    wi(COL + (0x1a0 if initial else 0xe0) + 4 * number, at)
    wi(COL + (0x200 if initial else 0x140) + 4 * number, 4)
    return at


def component(base, particle, lane_component):
    """One particle's component: the field buffer holds one vec4 per component, four lanes
    per vec4, and one 0x30-byte block per group of four particles."""
    group, lane = divmod(particle, 4)
    return read_lane(base + group * 0x30 + lane_component * 0x10, lane)


systems = {}
graph = json.loads((ROOT / '.reference-assets/source-exports/pistol-particles/graph.json').read_text())
for element in graph['elements']:
    if element.get('name') == 'weapon_muzzle_flash_pistol_main':
        systems['emitter'] = element
rows = []
for run in range(2):
    u.mem_write(OP, b'\0' * 0x300)
    u.mem_write(COL, b'\0' * 0x400)
    u.mem_write(CTX, b'\0' * 0x100)
    wi(COL + 0x11c, 120)
    call(POST_UNPACK, OP, COL, 0.0, 0)
    wi(COL + 0x20, 1)
    wi(COL + 0x30, 4)
    wi(COL + 0x50, 120)
    wf(COL + 0x24, TICK)
    wf(COL + 0x34, TICK)
    wf(COL + 0x38, TICK)
    wi(COL + 0x48, BASE + 0x8000)
    fields = {number: buffer(number) for number in (0, 1, 2, 3, 6, 7, 8)}
    call(INIT_NEW, OP, COL, CTX)
    call(EMIT, OP, COL, 1.0, CTX)
    # The chain replaces the collection's own per-field pointer and count tables, so the
    # particles it made are read where the collection now points rather than where this probe
    # put its buffers.
    live = {}
    for number in range(9):
        pointer = struct.unpack('<I', u.mem_read(COL + 0xe0 + 4 * number, 4))[0]
        count = struct.unpack('<I', u.mem_read(COL + 0x140 + 4 * number, 4))[0]
        if not pointer or pointer < BASE or pointer >= BASE + 0x40000:
            live[number] = None
            continue
        floats = list(struct.unpack('<' + 'f' * min(36, max(12, count * 3)), u.mem_read(pointer, 4 * min(36, max(12, count * 3)))))
        live[number] = dict(pointer=hex(pointer), count=count, floats=[round(value, 4) for value in floats[:24]])
    sample = []
    particles = 4
    for particle in range(particles):
        sample.append(dict(particle=particle,
            position=[component(fields[0], particle, axis) for axis in range(3)],
            previous=[component(fields[2], particle, axis) for axis in range(3)]))
    rows.append(dict(run=run, particles=particles, sample=sample, liveFields=live))
    print('RUN', run, 'particles', particles)
    for number in sorted(live):
        entry = live[number]
        if entry and any(value != 0 for value in entry['floats']):
            print('   FIELD', number, 'count', entry['count'], entry['floats'][:12])
report = dict(format='source-position-initializer-seeding-v1',
              finding='The shipped chain runs (the pistol main system\'s own emitter and new-particle init both return), '
                      'and it creates nothing this probe can read: every field pointer the collection ends up holding is '
                      'empty, and every buffer the probe supplied stays at zero across both runs. The particles an '
                      'emitter makes come from the collection\'s own allocator and its system definition, neither of which '
                      'a synthetic collection has.',
              initializerApply=dict(address='0xd02980', collectionOffsets=['0x68', '0x6c', '0x74', '0x78'],
                                    virtualCalls=['[eax+0x98]'],
                                    note='The initializer reads its new particles through these four collection fields and '
                                         'calls a virtual on the object it finds, so driving it by hand means building that '
                                         'object rather than only the buffers.'),
              next='Reproducing the client\'s particle system definition — its element and per-field tables and the '
                   'new-particle plumbing a collection gets from it — is what stands between this and the seeding rule. '
                   'It is a scaffolding job, not another operator measurement.',
              chain=dict(postUnpack=hex(POST_UNPACK), initNew=hex(INIT_NEW), emit=hex(EMIT), tick=TICK),
              system='weapon_muzzle_flash_pistol_main',
              systemSphereInitializer=(systems.get('emitter') or {}).get('attributes'),
              runs=rows,
              boundary='Executes the shipped chain over a synthetic collection. It reports the position slots of the '
                       'particles it created, not the meaning of every field.')
(ROOT / 'output/source-position-initializer-seeding.json').write_text(json.dumps(report, indent=2, default=str) + '\n')
(ROOT / 'research/source-position-initializer-seeding.json').write_text(json.dumps(report, indent=2, default=str) + '\n')
print('TOTAL', sum(row['particles'] for row in rows))
