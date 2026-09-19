"""Read the installed App740 server ELF, without loading or running native code.

The fixed build's CCSGameRules vtable, getter and 27 immediate initializer stores
must agree. ConVars are read from real constructor argument sites, not arbitrary
nearby float/string patterns. Unknown binaries fail closed.
"""
from pathlib import Path
import hashlib
import json
import struct

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / '.reference-assets/csgo-legacy/csgo/bin/server.so'
EXPECTED_SHA = '7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386'

def main():
    raw = SERVER.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    if sha != EXPECTED_SHA: raise ValueError('Unreviewed App740 server binary')
    if raw[:6] != b'\x7fELF\x01\x01': raise ValueError('Expected ELF32 little endian')
    table = struct.unpack_from('<I', raw, 32)[0]
    width, count, names_index = struct.unpack_from('<HHH', raw, 46)
    sections = [struct.unpack_from('<10I', raw, table + i * width) for i in range(count)]
    names = sections[names_index]; strings = raw[names[4]:names[4] + names[5]]
    named = {strings[s[0]:strings.index(0, s[0])].decode(): s for s in sections}
    def file_offset(address):
        for s in sections:
            if s[1] != 8 and s[3] <= address < s[3] + s[5]: return s[4] + address - s[3]
        raise ValueError(f'Address not file backed: {address:x}')
    def address_of(offset):
        for s in sections:
            if s[1] != 8 and s[4] <= offset < s[4] + s[5]: return s[3] + offset - s[4]
        raise ValueError('Offset outside sections')
    def uint(address): return struct.unpack_from('<I', raw, file_offset(address))[0]
    def cstring(address):
        offset = file_offset(address); return raw[offset:raw.index(0, offset)].decode()
    init, base, getter, vtable_slot = 0x4495af, 0x181a680, 0xbab450, 0x12b3918
    values = []; writes = []
    for i in range(27):
        address = init + i * 10; offset = file_offset(address)
        instruction = raw[offset:offset + 10]
        if instruction[:2] != b'\xc7\x05' or struct.unpack_from('<I', instruction, 2)[0] != base + 4 * i:
            raise ValueError('CViewVectors initialization instructions changed')
        value = struct.unpack_from('<f', instruction, 6)[0]
        values.append(value); writes.append(dict(instructionVA=hex(address), targetVA=hex(base + 4 * i), value=value))
    getter_bytes = b'\x55\xb8' + struct.pack('<I', base) + b'\x89\xe5\x5d\xc3'
    if raw[file_offset(getter):file_offset(getter) + 10] != getter_bytes: raise ValueError('View getter does not return this exact object')
    if uint(vtable_slot) != getter: raise ValueError('Vtable getter changed')
    # In this build a real caller loads virtual slot +0x7c then compares the
    # resulting function pointer against the very same getter (0xbad18c).
    compare = file_offset(0xbad18c)
    if raw[compare:compare + 14] != b'\x8b\x50\x7c\xb8' + struct.pack('<I', base) + b'\x81\xfa' + struct.pack('<I', getter):
        raise ValueError('Virtual slot call-site proof changed')
    vtable = vtable_slot - 0x7c; typeinfo = uint(vtable - 4)
    class_name = cstring(uint(typeinfo + 4))
    if class_name != '12CCSGameRules' or uint(vtable - 8) != 0: raise ValueError('Not CCSGameRules primary vtable')
    labels = ['view', 'hullMin', 'hullMax', 'duckHullMin', 'duckHullMax', 'duckView', 'observerMin', 'observerMax', 'deadView']
    vectors = {name: values[i * 3:i * 3 + 3] for i, name in enumerate(labels)}
    constructors = {0xe79590, 0xe79630, 0xe796d0, 0xe79780}
    text_section = named['.text']; rodata = named['.rodata']; convars = {}
    names = ['sv_gravity', 'sv_stepsize', 'sv_accelerate', 'sv_airaccelerate', 'sv_friction', 'sv_stopspeed',
             'sv_maxspeed', 'sv_jump_impulse', 'sv_maxvelocity', 'sv_accelerate_use_weapon_speed',
             'sv_standable_normal', 'sv_walkable_normal', 'sv_timebetweenducks', 'sv_enablebunnyhopping', 'sv_autobunnyhopping']
    for name in names:
        string_offset = raw.index(name.encode() + b'\0', rodata[4], rodata[4] + rodata[5])
        name_address = address_of(string_offset); pattern = b'\x68' + struct.pack('<I', name_address)
        candidates = []; pos = text_section[4]
        while True:
            pos = raw.find(pattern, pos, text_section[4] + text_section[5])
            if pos < 0: break
            # PUSH default_string, PUSH name, PUSH ConVar instance, CALL ctor.
            if raw[pos - 5] == 0x68 and raw[pos + 5] == 0x68 and raw[pos + 10] == 0xe8:
                call_address = address_of(pos + 10)
                constructor = call_address + 5 + struct.unpack_from('<i', raw, pos + 11)[0]
                if constructor in constructors:
                    default_address = struct.unpack_from('<I', raw, pos - 4)[0]
                    default = cstring(default_address); float(default)
                    candidates.append(dict(default=default, nameVA=hex(name_address), defaultVA=hex(default_address),
                        registrationVA=hex(address_of(pos)), constructorVA=hex(constructor),
                        instanceVA=hex(struct.unpack_from('<I', raw, pos + 6)[0])))
            pos += 5
        if len(candidates) != 1: raise ValueError(f'No unique constructor arguments for {name}')
        convars[name] = candidates[0]
    cfgs = []
    for cfg in sorted((SERVER.parents[1] / 'cfg').glob('gamemode*.cfg')):
        body = cfg.read_text(errors='replace'); matching = [line for line in body.splitlines()
            if any(line.strip().startswith(name + ' ') for name in names)]
        cfgs.append(dict(file=cfg.name, sha256=hashlib.sha256(cfg.read_bytes()).hexdigest(), relevantOverrides=matching))
    result = dict(server=str(SERVER), sha256=sha, bytes=len(raw), appId=740, installedBuild=12426148,
        method='Static ELF initializer + virtual-call slot + CCSGameRules RTTI; native code never executed',
        vectorsSourceUnits=vectors, initializerVA=hex(init), objectVA=hex(base), getterVA=hex(getter),
        vtableVA=hex(vtable), vtableSlotOffset='0x7c', rttiVA=hex(typeinfo), rttiName=class_name, writes=writes,
        convars=convars, installedGamemodeCfgs=cfgs,
        limits=['Constructor defaults, not a running engine console readback. Server cfg, plugins and gamemode code can override.',
                'sv_maxspeed is a global ceiling; held weapon, duck/walk and game state change actual movement speed.',
                'Rapier KCC tests below use these dimensions/step/gravity, not the full Source movement solver.'])
    out = ROOT / 'output/tests/source-player-parameters.json'; out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(vectors=vectors, defaults={name: value['default'] for name, value in convars.items()}), indent=2))

if __name__ == '__main__': main()
