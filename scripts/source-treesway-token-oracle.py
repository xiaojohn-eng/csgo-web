"""Independent float32 register interpreter for the installed VS128/dynamic0.

No hand-transcribed sway formula. D3D transcendental/FMA GPU precision is not
claimed: this records scalar float32 instruction semantics for bounded samples.
"""
import math
import struct


def f(value):
    try:
        return struct.unpack('<f', struct.pack('<f', value))[0]
    except OverflowError:
        return math.copysign(math.inf, value)


def kind(token):
    return ((token >> 28) & 7) | ((token >> 8) & 24)


def evaluate(instructions, constants, inputs, stop=707):
    registers = {(2, int(k)): list(map(f, v)) for k, v in constants.items()}
    registers.update({(1, int(k)): list(map(f, v)) for k, v in inputs.items()})

    def read(token):
        assert not token & (1 << 13), 'Relative source register is outside this oracle'
        values = registers[(kind(token), token & 2047)]
        value = [values[(token >> (16+2*i)) & 3] for i in range(4)]
        modifier = (token >> 24) & 15
        assert modifier in (0, 1, 11, 12)
        if modifier in (11, 12):
            value = list(map(abs, value))
        if modifier in (1, 12):
            value = [-x for x in value]
        return value

    for address, words in instructions.items():
        if address >= stop:
            break
        opcode, destination, *arguments = words
        opcode &= 65535
        if opcode == 31:
            continue
        if opcode == 81:
            value = list(struct.unpack('<4f', struct.pack('<4I', *arguments)))
        else:
            args = list(map(read, arguments))
            a = args[0]
            b = args[1] if len(args) > 1 else None
            if opcode == 1: value = a
            elif opcode == 2: value = [f(x+y) for x, y in zip(a, b)]
            elif opcode == 4: value = [f(f(x*y)+z) for x, y, z in zip(a, b, args[2])]
            elif opcode == 5: value = [f(x*y) for x, y in zip(a, b)]
            elif opcode == 6: value = [f(1/a[0]) if a[0] else math.copysign(math.inf, a[0])]*4
            elif opcode == 7: value = [f(1/math.sqrt(abs(a[0]))) if a[0] else math.inf]*4
            elif opcode in (8, 9):
                products = [f(x*y) for x, y in zip(a, b)][:3 if opcode == 8 else 4]
                total = products[0]
                for product in products[1:]: total = f(total+product)
                value = [total]*4
            elif opcode == 10: value = list(map(min, a, b))
            elif opcode == 11: value = list(map(max, a, b))
            elif opcode == 12: value = [float(x < y) for x, y in zip(a, b)]
            elif opcode == 13: value = [float(x >= y) for x, y in zip(a, b)]
            elif opcode == 14: value = [f(2**a[0])]*4
            elif opcode == 15: value = [f(math.log2(abs(a[0]))) if a[0] else -math.inf]*4
            elif opcode == 18: value = [f(f(x*y)+f(f(1-x)*z)) for x, y, z in zip(a, b, args[2])]
            elif opcode == 19: value = [f(x-math.floor(x)) for x in a]
            elif opcode == 32: value = [f(abs(a[0])**b[0])]*4
            elif opcode == 35: value = list(map(abs, a))
            else: raise ValueError((address, opcode))
        if destination & (1 << 20):
            value = [min(1, max(0, x)) for x in value]
        target = registers.setdefault((kind(destination), destination & 2047), [0.]*4)
        for lane in range(4):
            if destination & (1 << (16+lane)):
                target[lane] = f(value[lane])
    return {'sourcePosition': registers[(0, 0)][:3], 'bakedDiffuse': registers[(6, 7)][:3]}
