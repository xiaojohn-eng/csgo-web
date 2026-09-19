import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('overlay',Path(__file__).with_name('source-overlay-geometry.py'))
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
class OverlayGeometryTests(unittest.TestCase):
    def test_authored_skew_and_mirrored_basis(self):
        quad=[[0,0],[1,4],[6,5],[5,0]]
        for expected,point in [((0,0),quad[0]),((0,1),quad[1]),((1,1),quad[2]),((1,0),quad[3]),((.5,.5),[3,2.25])]:
            actual=g.quad_coordinates(point,quad)
            self.assertAlmostEqual(actual[0],expected[0]);self.assertAlmostEqual(actual[1],expected[1])
        self.assertEqual(g.basis([[0,0,1],[0,0,0],[0,0,0],[0,0,1]],[0,0,1]),([1,0,0],[0,-1,0]))
    def test_clipped_receiver_preserves_sloping_surface_and_baked_uv(self):
        # Attribute z=2x+3y and HDR u=x/10+0.2 must remain interpolated at every cut.
        vertices=[[x,y,2*x+3*y,x/10+.2]for x,y in [(-1,-1),(3,-1),(-1,3)]]
        quad=[[0,0],[0,1],[1,1],[1,0]]
        clipped=g.clip_triangle(vertices,quad)
        self.assertGreaterEqual(len(clipped),3)
        for x,y,z,u in clipped:
            self.assertGreaterEqual(x,-1e-7);self.assertLessEqual(x,1.0000001)
            self.assertGreaterEqual(y,-1e-7);self.assertLessEqual(y,1.0000001)
            self.assertAlmostEqual(z,2*x+3*y);self.assertAlmostEqual(u,x/10+.2)
    def test_missing_receiver_is_not_filled_by_overlay_rectangle(self):
        self.assertEqual(g.clip_triangle([[3,3],[4,3],[3,4]],[[0,0],[0,1],[1,1],[1,0]]),[])
    def test_reversed_tiled_uv_range_is_not_clamped(self):
        s,t=g.quad_coordinates([1,1],[[0,0],[0,2],[2,2],[2,0]])
        self.assertEqual((3+s*(-4),-2+t*8),(1,2))
if __name__=='__main__':unittest.main()
