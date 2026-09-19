"""Pure geometry for the BSP overlay sidecar; no scene or asset mutations.

Valve's public vbsp/overlay.cpp stores BasisU in UVPoints[0..2].z and the
BasisV sign in UVPoints[3].z. The XY values remain the authored four corners.
Clip the *receiver triangles*, including displacement triangles, against that
quad. Interpolate receiver attributes at every cut; never float a whole decal
rectangle over holes or steps. Texture UVs retain reversed and tiled ranges.
"""
import math


def cross2(a, b):
    return a[0] * b[1] - a[1] * b[0]


def sub(a, b):
    return [x - y for x, y in zip(a, b)]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def basis(points, normal):
    u = [points[i][2] for i in range(3)]
    v = [normal[1] * u[2] - normal[2] * u[1],
         normal[2] * u[0] - normal[0] * u[2],
         normal[0] * u[1] - normal[1] * u[0]]
    if points[3][2] != 0:
        v = [-x for x in v]
    if abs(dot(u, u) - 1) > 1e-4 or abs(dot(v, v) - 1) > 1e-4:
        raise ValueError('Overlay basis is not orthonormal')
    return u, v


def clip_triangle(vertices, quad):
    """Vertices start with projected XY followed by linearly varying attributes."""
    area = sum(cross2(quad[i], quad[(i + 1) % 4]) for i in range(4))
    if abs(area) < 1e-9:
        raise ValueError('Degenerate overlay quad')
    sign = 1 if area > 0 else -1
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        edge = sub(b, a)
        if sign * cross2(edge, sub(quad[(i + 2) % 4], b)) < -1e-5:
            raise ValueError('Non-convex overlay quad')
        if not vertices:
            return []
        result = []
        prev = vertices[-1]
        dp = sign * cross2(edge, sub(prev[:2], a))
        for cur in vertices:
            dc = sign * cross2(edge, sub(cur[:2], a))
            inside_p, inside_c = dp >= -1e-7, dc >= -1e-7
            if inside_p != inside_c:
                t = dp / (dp - dc)
                result.append([x + (y - x) * t for x, y in zip(prev, cur)])
            if inside_c:
                result.append(cur)
            prev, dp = cur, dc
        vertices = result
    return vertices


def quad_coordinates(point, quad):
    """Invert the authored bilinear quad: 0=(0,0),1=(0,1),2=(1,1),3=(1,0)."""
    a = sub(quad[3], quad[0]); b = sub(quad[1], quad[0])
    c = [quad[0][i] - quad[1][i] + quad[2][i] - quad[3][i] for i in range(2)]
    d = sub(point, quad[0]); det = cross2(a, b)
    if abs(det) < 1e-10:
        raise ValueError('Singular overlay mapping')
    s, t = cross2(d, b) / det, cross2(a, d) / det
    for _ in range(12):
        e = [a[i] * s + b[i] * t + c[i] * s * t - d[i] for i in range(2)]
        if math.hypot(*e) < 1e-7:
            break
        ds = [a[i] + c[i] * t for i in range(2)]
        dt = [b[i] + c[i] * s for i in range(2)]
        det = cross2(ds, dt)
        if abs(det) < 1e-10:
            raise ValueError('Singular bilinear overlay mapping')
        s -= cross2(e, dt) / det; t -= cross2(ds, e) / det
    error = math.hypot(*[a[i] * s + b[i] * t + c[i] * s * t - d[i] for i in range(2)])
    if error > 1e-4 or min(s, t) < -1e-4 or max(s, t) > 1.0001:
        raise ValueError('Overlay UV inverse outside clipped quad')
    return s, t
