"""Exact finite/nonfinite alpha packing used by installed displacement upload."""
import math
import struct

f32 = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]


def source_world_alpha_byte(value):
    value = f32(value)
    if not math.isfinite(value): return 0
    normalized = min(1., max(0., f32(value * f32(1 / 255))))
    packed = f32(f32(normalized * 255) + 8388608)
    return struct.unpack('<I', struct.pack('<f', packed))[0] & 255
