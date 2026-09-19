"""Process-local correction for pinned SourceIO's relative start-corner match."""
import numpy as np

corrections=[]
def source_start(points,start,face_id):
    distance=np.linalg.norm(points-start,axis=1)
    selected=int(np.argmin(distance))
    # SDK FindSurfPointStartIndex chooses minimum squared distance, not isclose.
    # Original BSP corners are rounded: observed max start separation .02002u.
    if not np.isfinite(distance).all() or distance[selected]>.1:raise ValueError(f'Displacement {face_id} start point has no original corner')
    old=np.where(np.sum(np.isclose(points,start,.005),axis=1)==3)[0]
    if len(old) and old[0]!=selected:
        corrections.append({'face':int(face_id),'oldCorner':int(old[0]),'sourceCorner':selected,
            'wrongCornerDistanceSourceUnits':float(distance[old[0]])})
    return selected

def instrument(code):
    first='        min_index = np.where('
    last='        left_edge = '
    if code.count(first)!=1 or code.count(last)!=1:raise ValueError('Pinned displacement start selection changed')
    a,b=code.index(first),code.index(last)
    return code[:a]+'        min_index = _source_displacement_start(face_vertices, start_pos * settings.scale, disp_info.map_face)\n\n'+code[b:]
