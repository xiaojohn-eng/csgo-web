"""Process-local Source1 section decoder using Valve mstudioanimdesc_t::pAnim.
Original last-frame section and omitted-bone defaults are retained. No addon edit.
"""
def install_source_section_decoder(observations):
 import numpy as np
 from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc,ANIM_DTYPE
 original=StudioAnimDesc.read_animations
 def decode(desc,buffer,bones,ani_buffer=None,block_table=None):
  if not desc.section_offset or not desc.section_frame_count:return original(desc,buffer,bones,ani_buffer,block_table)
  sections=desc.get_sections(buffer)
  if any(s.anim_block>0 for s in sections)and ani_buffer is None:return None
  count=desc.frame_count;delta=bool(int(desc.flags)&4);result={}
  for bone in bones:
   data=np.zeros(count,ANIM_DTYPE);data['rot']=(0,0,0,1)if delta else bone.quat
   if not delta:data['pos']=bone.position
   result[bone.name]=data
  groups={}
  for frame in range(count):
   section=count//desc.section_frame_count+1 if count>desc.section_frame_count and frame==count-1 else frame//desc.section_frame_count
   local=0 if frame==count-1 and count>desc.section_frame_count else frame-section*desc.section_frame_count
   groups.setdefault(section,[]).append((frame,local))
  for index,frames in groups.items():
   section=sections[index]
   if section.anim_block==0:target=buffer;offset=desc._entry_offset+section.anim_offset
   else:
    assert ani_buffer is not None
    target=ani_buffer;offset=section.anim_offset+(block_table[section.anim_block].data_offset if block_table is not None else 0)
   target.seek(offset);decoded=desc._read_animation_frames(target,bones,max(local for _,local in frames)+1)
   assert decoded is not None,('Missing source section',desc.name,index)
   for name,data in decoded.items():
    for frame,local in frames:
     assert len(data)==1 or local<len(data)
     result[name][frame]=data[0 if len(data)==1 else local]
  old=original(desc,buffer,bones,ani_buffer,block_table);maximum=0;last_maximum=0;changed=[]
  if old is not None:
   for bone in bones:
    previous=old.get(bone.name)
    if previous is None:continue
    for channel in ('pos','rot'):
     d=np.abs(result[bone.name][channel]-previous[channel]);maximum=max(maximum,float(d.max()));last_maximum=max(last_maximum,float(d[-1].max()))
     if float(d[-1].max())>1e-7:changed.append(bone.name+':'+channel)
  observations.append({'animation':desc.name,'frames':count,'sectionFrames':desc.section_frame_count,
   'sections':[{'id':i,'block':sections[i].anim_block,'offset':sections[i].anim_offset,'outputFrames':[f for f,_ in frames],'localFrames':[f for _,f in frames]}for i,frames in groups.items()],
   'sourceioPreviousMaxComponentDifference':maximum,'lastFrameMaxComponentDifference':last_maximum,'lastFrameChangedChannels':changed})
  return result
 StudioAnimDesc.read_animations=decode
 return lambda:setattr(StudioAnimDesc,'read_animations',original)
