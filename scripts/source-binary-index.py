"""Read a shipped Source binary the way the probes need to: functions, vtables, strings.

Three things are needed again and again when reading `client_client.so` / `server_client.so`:

  * **Where a function begins.** The binaries ship their own frame information, one entry per
    function with its start and length, so a reader never has to guess a boundary or point at an
    address somewhere inside a function.
  * **Which class a function belongs to.** Offsets cannot say it - two classes can keep members at
    the same numbers, and one in this build does. A class's virtual table can: every entry is a
    relocation, and the slot just before the table points at the class's type information, whose
    second word points at a name string. So a table is found by name and membership in it is the
    proof.
  * **What a `lea` points at**, so a string loaded by an instruction is read from the instruction
    rather than from a name that looks right.

Usage: `from source_binary_index import open_binary` (add `scripts` to `sys.path`), then

    binary = open_binary(ROOT / '.reference-assets/.../server_client.so')
    binary.function_of(0x9cfda0)          # (start, length)
    binary.vtable_named('CRopeKeyframe')  # (head address, [entry addresses])
"""
from __future__ import annotations

import bisect
import re
import struct
from dataclasses import dataclass
from pathlib import Path

from elftools.elf.elffile import ELFFile

# Disassembly is imported on use rather than at import time. Everything else here - sections, the
# relocation table, function bounds, vtables, address arithmetic - needs only the ELF reader, and
# that half has to be importable where capstone is not (the environment probe runs under Blender).
_CAPSTONE: tuple | None = None


def _capstone():
    """The decoder pair: (plain, detailed), imported and built once."""
    global _CAPSTONE
    if _CAPSTONE is None:
        from capstone import Cs, CS_ARCH_X86, CS_MODE_64
        plain = Cs(CS_ARCH_X86, CS_MODE_64)
        detailed = Cs(CS_ARCH_X86, CS_MODE_64)
        detailed.detail = True
        _CAPSTONE = (plain, detailed)
    return _CAPSTONE


def _x86_registers():
    """The operand and register constants, imported on use with capstone."""
    from capstone.x86 import X86_OP_MEM, X86_OP_REG, X86_REG_RBP, X86_REG_RIP
    return X86_OP_MEM, X86_OP_REG, X86_REG_RBP, X86_REG_RIP

# How wide each DW_EH_PE encoding is, and which of them are signed. 0x01/0x09 are LEB128 and are
# never used for the two fields read here.
ENCODED_SIZE = {0x00: 8, 0x01: 1, 0x02: 2, 0x03: 4, 0x04: 8,
                0x09: 1, 0x0A: 2, 0x0B: 4, 0x0C: 8}
SIGNED_KINDS = (0x09, 0x0A, 0x0B, 0x0C)
R_X86_64_RELATIVE = 8


def _leb128(data: bytes, at: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while True:
        byte = data[at]
        at += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, at
        shift += 7


@dataclass
class Binary:
    path: Path
    data: bytes
    text_lo: int
    text_hi: int
    sections: tuple[tuple[int, int, int, str], ...]
    relative: dict[int, int]
    bounds: tuple[tuple[int, int], ...]
    starts: tuple[int, ...]
    _body_cache: bytes | None = None

    def offset_of(self, address: int) -> int:
        """The file offset a virtual address sits at."""
        for start, end, at, _ in self.sections:
            if start <= address < end:
                return at + (address - start)
        raise ValueError(f'{address:#x} is not in a loaded section')

    def string_at(self, address: int) -> str | None:
        """The C string at an address, or None when the bytes are not a plain string."""
        try:
            at = self.offset_of(address)
        except ValueError:
            return None
        stop = self.data.find(b'\x00', at)
        run = self.data[at:stop]
        if run and all(32 <= c < 127 for c in run):
            return run.decode('latin1')
        return None

    def function_of(self, address: int) -> tuple[int, int]:
        """The start and length of the function containing an address."""
        index = bisect.bisect_right(self.starts, address) - 1
        return self.bounds[index]

    def is_function_start(self, address: int) -> bool:
        index = bisect.bisect_right(self.starts, address) - 1
        return 0 <= index < len(self.starts) and self.starts[index] == address

    def lea_target(self, address: int) -> int:
        """Where the `lea reg, [rip + disp]` at an address points."""
        at = self.offset_of(address)
        assert self.data[at] in (0x48, 0x4C) and self.data[at + 1] == 0x8D, hex(address)
        return address + 7 + struct.unpack_from('<i', self.data, at + 3)[0]

    def rip_target(self, address: int) -> int:
        """Where the RIP-relative operand of any instruction at an address points.

        `lea_target` only handles `lea`, and adding a displacement by hand is how a probe reads the
        wrong global, so anything else that names data goes through this instead.
        """
        op_mem, _, _, rip = _x86_registers()
        _, detailed = _capstone()
        at = self.offset_of(address)
        instructions = list(detailed.disasm(self.data[at:at + 16], address))
        assert instructions, hex(address)
        ins = instructions[0]
        for operand in ins.operands:
            if operand.type == op_mem and operand.mem.base == rip:
                return ins.address + ins.size + operand.mem.disp
        raise ValueError(f'{address:#x} ({ins.mnemonic}) has no RIP-relative operand')

    def instruction_at(self, address: int, length: int = 16):
        """Disassemble from an address, which must be an instruction boundary."""
        at = self.offset_of(address)
        plain, _ = _capstone()
        return list(plain.disasm(self.data[at:at + length], address))

    def bytes_at(self, address: int, length: int) -> bytes:
        at = self.offset_of(address)
        return self.data[at:at + length]

    def instructions(self, address: int, length: int):
        at = self.offset_of(address)
        plain, _ = _capstone()
        return list(plain.disasm(self.data[at:at + length], address))

    def frame_aliases(self, start: int, length: int, base: int | None = None) -> dict[str, int]:
        """Registers a function loads as `frame pointer + k`, and each one's k.

        A store through one of these reaches exactly the bytes a store through the frame pointer
        would, so a scan that only looks for the frame register itself can miss the writer.
        """
        op_mem, op_reg, frame, _ = _x86_registers()
        base = frame if base is None else base
        _, detailed = _capstone()
        aliases: dict[str, int] = {}
        for ins in detailed.disasm(self.body()[start - self.text_lo:
                                              start - self.text_lo + length], start):
            if ins.mnemonic != 'lea' or len(ins.operands) != 2:
                continue
            destination, source = ins.operands
            if destination.type != op_reg or source.type != op_mem:
                continue
            if source.mem.base == base and source.mem.index == 0 and source.mem.disp <= 0:
                aliases[detailed.reg_name(destination.reg)] = source.mem.disp
        return aliases

    def frame_stores(self, start: int, length: int, disp: int,
                     base: int | None = None) -> list[tuple[int, str, str]]:
        """Instructions in a function whose store lands on the four bytes at a frame offset.

        `disp` is the frame offset itself, negative as frame offsets are. The window a store covers
        is the size of its own memory operand, so a wide store counts even though it never names
        `disp`; frame-pointer aliases are followed as well. Returns address, mnemonic and text.
        """
        op_mem, _, frame, _ = _x86_registers()
        base = frame if base is None else base
        _, detailed = _capstone()
        aliases = {detailed.reg_name(base): 0}
        aliases.update(self.frame_aliases(start, length, base))
        found: list[tuple[int, str, str]] = []
        for ins in detailed.disasm(self.body()[start - self.text_lo:
                                              start - self.text_lo + length], start):
            if not ins.operands or ins.mnemonic in READ_ONLY_MNEMONICS:
                continue
            destination = ins.operands[0]
            if destination.type != op_mem or destination.mem.index != 0:
                continue
            name = detailed.reg_name(destination.mem.base)
            if name not in aliases:
                continue
            at = aliases[name] + destination.mem.disp
            if at <= disp < at + (destination.size or 4):
                found.append((ins.address, ins.mnemonic, ins.op_str))
        return found

    def vtable_runs(self) -> list[list[int]]:
        """Every run of consecutive slots holding code addresses, longest first."""
        slots = sorted(address for address, value in self.relative.items()
                       if self.text_lo <= value < self.text_hi)
        runs: list[list[int]] = []
        current = [slots[0]]
        for address in slots[1:]:
            if address == current[-1] + 8:
                current.append(address)
            else:
                runs.append(current)
                current = [address]
        runs.append(current)
        return runs

    def vtable_name(self, head: int) -> str | None:
        """The name of the class whose table starts at a head, through its type information."""
        type_info = self.relative.get(head - 8)
        if type_info is None:
            return None
        return self.string_at(self.relative.get(type_info + 8, 0))

    def vtable_named(self, suffix: str, minimum: int = 8) -> tuple[int, list[int]]:
        """The table whose class name ends with a suffix, and its entries.

        The name is checked with `endswith` because the compiler stores a template-and-class
        spelling; a suffix that matches more than one table is refused rather than guessed.
        """
        found = []
        for run in self.vtable_runs():
            if len(run) < minimum:
                continue
            name = self.vtable_name(run[0])
            if name and name.endswith(suffix):
                found.append((run[0], [self.relative[address] for address in run]))
        assert len(found) == 1, [(hex(head), len(entries)) for head, entries in found]
        return found[0]

    def body(self) -> bytes:
        """The text section's bytes, cached because the scans below walk it."""
        if self._body_cache is None:
            self._body_cache = self.data[self.text_lo:self.text_hi]
        return self._body_cache

    def lea_sites(self, target: int) -> list[int]:
        """Every `lea reg, [rip + disp]` in the text section that lands on an address.

        Both encodings are searched: the one with a REX prefix (seven bytes, the usual form) and
        the one without (six bytes, what the compiler uses for 32-bit destinations).
        """
        found = []
        body = self.body()
        for match in re.finditer(rb'\x8d', body):
            index = match.start()
            if (body[index + 1] & 0xC7) != 0x05:
                continue
            # The displacement always sits right after the two-byte opcode plus the ModRM byte;
            # what the REX prefix changes is where the instruction begins, and so its length.
            length = 7 if index and 0x40 <= body[index - 1] <= 0x4F else 6
            start = self.text_lo + index - (length - 6)
            disp = struct.unpack_from('<i', body, index + 2)[0]
            if start + length + disp == target:
                found.append(start)
        return found

    def address_of(self, file_offset: int) -> int | None:
        """The virtual address a file offset loads at."""
        for start, end, at, _ in self.sections:
            if at <= file_offset < at + (end - start):
                return start + (file_offset - at)
        return None

    def lea_sites_of_string(self, needle: bytes) -> list[int]:
        """Every `lea` that loads a NUL-terminated string, found by its bytes."""
        offset = self.data.find(needle + b'\x00')
        if offset < 0:
            return []
        address = self.address_of(offset)
        return [] if address is None else self.lea_sites(address)

    def callers(self, target: int) -> list[int]:
        """Every `call`/`jmp rel32` in the text section whose destination is a target."""
        found = []
        body = self.body()
        for match in re.finditer(rb'[\xe8\xe9]', body):
            here = self.text_lo + match.start()
            if here + 5 + struct.unpack_from('<i', body, match.start() + 1)[0] == target:
                found.append(here)
        return found


# Mnemonics whose memory operand is read rather than written. A scan for stores skips these; the
# list is deliberately short, so an unfamiliar mnemonic counts as a store rather than the reverse.
READ_ONLY_MNEMONICS = frozenset({
    'cmp', 'comiss', 'comisd', 'ucomiss', 'ucomisd', 'test', 'add', 'sub', 'or', 'and', 'xor',
    'imul', 'shl', 'shr', 'sar', 'neg', 'lea', 'movsxd', 'movzx', 'movsx', 'prefetchnta',
})


def frame_bounds(data: bytes, at: int, size: int, address: int) -> list[tuple[int, int]]:
    """Every function's start and length, walked out of the binary's own frame entries."""
    cies: dict[int, int] = {}
    bounds: list[tuple[int, int]] = []
    cursor = 0
    while cursor < size - 4:
        length = int.from_bytes(data[at + cursor:at + cursor + 4], 'little')
        if length == 0:
            cursor += 4
            continue
        if length == 0xFFFFFFFF:
            length = int.from_bytes(data[at + cursor + 4:at + cursor + 12], 'little')
            body = cursor + 12
        else:
            body = cursor + 4
        entry = int.from_bytes(data[at + body:at + body + 4], 'little')
        here = body + 4
        if entry == 0:
            here += 1                                    # version
            augmentation = b''
            while data[at + here] != 0:
                augmentation += bytes([data[at + here]])
                here += 1
            here += 1
            _, here = _leb128(data, at + here)
            here -= at
            here += 1                                    # data alignment
            _, here = _leb128(data, at + here)
            here -= at
            encoding = 0
            if augmentation.startswith(b'z'):
                aug_len, here = _leb128(data, at + here)
                here -= at
                walk = here
                for letter in augmentation[1:]:
                    if letter in (ord('L'), ord('R')):
                        if letter == ord('R'):
                            encoding = data[at + walk]
                        walk += 1
                    elif letter == ord('P'):
                        walk += 1
                        walk += ENCODED_SIZE.get(data[at + walk - 1] & 0x0F, 8)
                    else:
                        break
                here = here + aug_len
            cies[address + cursor] = encoding
        else:
            encoding = cies[address + body - entry]
            kind = encoding & 0x0F
            field = address + here
            raw = int.from_bytes(data[at + here:at + here + ENCODED_SIZE[kind]], 'little',
                                 signed=kind in SIGNED_KINDS)
            here += ENCODED_SIZE[kind]
            start = field + raw if encoding & 0x10 else raw
            span = int.from_bytes(data[at + here:at + here + ENCODED_SIZE[kind]], 'little',
                                  signed=kind in SIGNED_KINDS)
            bounds.append((start, span))
        cursor += (12 + length) if length == 0xFFFFFFFF else (4 + length)
    bounds.sort()
    return bounds


def open_binary(path: Path) -> Binary:
    """Index a shipped binary: sections, relative relocations, function bounds."""
    path = Path(path)
    data = path.read_bytes()
    with path.open('rb') as handle:
        elf = ELFFile(handle)
        text = elf.get_section_by_name('.text')
        frame = elf.get_section_by_name('.eh_frame')
        assert text is not None and frame is not None, path
        sections = tuple((s['sh_addr'], s['sh_addr'] + s['sh_size'], s['sh_offset'], s.name)
                         for s in elf.iter_sections() if s['sh_addr'] and s['sh_size'])
        relative = {}
        for section in elf.iter_sections():
            if section.header['sh_type'] == 'SHT_RELA' and section.name == '.rela.dyn':
                for relocation in section.iter_relocations():
                    if relocation['r_info_type'] == R_X86_64_RELATIVE:
                        relative[relocation['r_offset']] = relocation['r_addend']
    bounds = tuple(frame_bounds(data, frame['sh_offset'], frame['sh_size'], frame['sh_addr']))
    assert len(bounds) > 10_000, (path, len(bounds))
    return Binary(path=path, data=data, text_lo=text['sh_addr'],
                  text_hi=text['sh_addr'] + text['sh_size'], sections=sections,
                  relative=relative, bounds=bounds,
                  starts=tuple(start for start, _ in bounds))


def assert_bytes(binary: Binary, expected: dict[int, tuple[str, str]]) -> None:
    """Check each instruction encoding at its own address, so a misread address fails."""
    for address, (hex_bytes, what) in expected.items():
        at = binary.offset_of(address)
        got = binary.data[at:at + len(hex_bytes) // 2].hex()
        assert got == hex_bytes, f'{address:#x} {what}: read {got}, expected {hex_bytes}'


def assert_lea_string(binary: Binary, address: int, text: str) -> None:
    """Check that the `lea` at an address loads exactly a string."""
    target = binary.lea_target(address)
    read = binary.string_at(target)
    assert read == text, f'{address:#x} loads {read!r}, expected {text!r}'
