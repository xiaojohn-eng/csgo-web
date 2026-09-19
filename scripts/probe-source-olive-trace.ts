import {SOURCE_OLIVE_TREESWAY_GLSL} from '../game/source-olive-treesway-glsl';
import {SOURCE_TREESWAY_GLSL} from '../game/source-treesway-glsl';
type Trace={word:number;register:string;mask:number[];expected:number[]};
type Row={index:number;case:{sourcePosition:number[];sourceModelRows:number[][];time:number;windSourceXY:number[]};traces:Trace[]};
export async function probeSourceOliveTrace(){
 const rows=await(await fetch('/assets/source-exports/dust2-foliage-audit/olive-power/trace.json',{cache:'no-cache'})).json()as Row[];
 const original=SOURCE_TREESWAY_GLSL.replaceAll('sourceTreePosition','sourceOlivePosition')
  .replace('c14=vec4(100.0,0.5,200.0,0.0),c15=vec4(0.20000000298023224,0.25,2.0,0.5)','c14=vec4(10.0,0.5,100.0,0.0),c15=vec4(0.20000000298023224,0.15000000596046448,2.0,0.15000000596046448)')
  .replace('c52=vec4(200.0,600.0,0.0,0.0)','c52=vec4(200.0,800.0,0.0,0.0)');
 const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');if(!gl)throw Error('WebGL2 required');
 const results=[];
 try{for(const [name,source]of [['plain',original],['round',SOURCE_OLIVE_TREESWAY_GLSL]]){
  const shaders:WebGLShader[]=[],buffers:WebGLBuffer[]=[];let program:WebGLProgram|null=null,vao:WebGLVertexArrayObject|null=null,tf:WebGLTransformFeedback|null=null;
  try{
   const points=rows[0].traces;let code=source;for(const [i,t]of points.entries()){const marker='// word '+t.word+'\n';if(!code.includes(marker))throw Error('Missing trace word '+t.word);code=code.replace(marker,marker+`debug${i}=${t.register};\n`);}
   const shader=(type:number,code:string)=>{const s=gl.createShader(type)!;shaders.push(s);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)??'trace compile');return s;};
   program=gl.createProgram()!;gl.attachShader(program,shader(gl.VERTEX_SHADER,`#version 300 es
precision highp float;precision highp int;
layout(location=0) in vec3 position;layout(location=1) in vec4 row0;layout(location=2) in vec4 row1;layout(location=3) in vec4 row2;layout(location=4) in vec4 timeWind;
${points.map((_,i)=>`out vec4 debug${i};`).join('\n')}
${code}
void main(){vec3 p=sourceOlivePosition(position,timeWind,row0,row1,row2);gl_Position=vec4(p,1.0);}`));
   gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1.0);}'));
   gl.transformFeedbackVaryings(program,points.map((_,i)=>'debug'+i),gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)??'trace link');gl.useProgram(program);
   const mask=gl.getUniformLocation(program,'sourceOliveRoundMask');if(mask)gl.uniform1ui(mask,0);
   vao=gl.createVertexArray();gl.bindVertexArray(vao);const input=gl.createBuffer()!,output=gl.createBuffer()!;buffers.push(input,output);
   gl.bindBuffer(gl.ARRAY_BUFFER,input);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(rows.flatMap(({case:c})=>[...c.sourcePosition,...c.sourceModelRows.flat(),0,c.time,...c.windSourceXY])),gl.STATIC_DRAW);
   for(const [loc,size,off]of [[0,3,0],[1,4,3],[2,4,7],[3,4,11],[4,4,15]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,76,off*4);}
   tf=gl.createTransformFeedback();gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,tf);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,rows.length*points.length*16,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);
   gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,rows.length);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);
   const data=new Float32Array(rows.length*points.length*4);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,data);if(gl.getError())throw Error('trace GL error');
   results.push({name,rows:rows.map((row,i)=>({index:row.index,traces:row.traces.map((t,j)=>{const actual=Array.from(data.subarray((i*points.length+j)*4,(i*points.length+j+1)*4));return {...t,actual,maxError:Math.max(...t.mask.map(k=>Math.abs(actual[k]-t.expected[k])))};})}))});
  }finally{gl.bindVertexArray(null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);for(const b of buffers)gl.deleteBuffer(b);if(tf)gl.deleteTransformFeedback(tf);if(vao)gl.deleteVertexArray(vao);if(program)gl.deleteProgram(program);for(const s of shaders)gl.deleteShader(s);}
 }}finally{gl.getExtension('WEBGL_lose_context')?.loseContext();}
 return results;
}
