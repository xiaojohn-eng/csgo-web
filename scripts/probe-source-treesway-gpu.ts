import {SOURCE_TREESWAY_GLSL,SOURCE_TREESWAY_PROGRAM_SHA256} from '../game/source-treesway-glsl';
interface Case {sourcePosition:number[];sourceModelRows:number[][];time:number;windSourceXY:number[];expectedSourcePosition:number[]}
export async function probeSourceTreeswayGPU(){
  const response=await fetch('/assets/source-exports/dust2-foliage-audit/treesway/oracle.json',{cache:'no-cache'});if(!response.ok)throw Error('Tree oracle HTTP '+response.status);
  const oracle=await response.json() as {cases:Case[];program:{programSha256:string}};
  if(oracle.program.programSha256!==SOURCE_TREESWAY_PROGRAM_SHA256||oracle.cases.length!==1400)throw Error('Original tree oracle differs');
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');if(!gl)throw Error('WebGL2 required');
  const shaders:WebGLShader[]=[],buffers:WebGLBuffer[]=[];let program:WebGLProgram|null=null,vao:WebGLVertexArrayObject|null=null,tf:WebGLTransformFeedback|null=null;
  try{
    const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)??'Tree shader compile');return s;};
    program=gl.createProgram()!;gl.attachShader(program,shader(gl.VERTEX_SHADER,`#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec4 row0;
layout(location=2) in vec4 row1;
layout(location=3) in vec4 row2;
layout(location=4) in vec4 timeWind;
out vec3 resultPosition;
${SOURCE_TREESWAY_GLSL}
void main(){resultPosition=sourceTreePosition(position,timeWind,row0,row1,row2);gl_Position=vec4(0.0,0.0,0.0,1.0);}`));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1.0);}'));
    gl.transformFeedbackVaryings(program,['resultPosition'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)??'Tree program link');
    gl.useProgram(program);vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const data=new Float32Array(oracle.cases.flatMap(c=>[...c.sourcePosition,...c.sourceModelRows.flat(),0,c.time,...c.windSourceXY]));
    const input=gl.createBuffer()!,output=gl.createBuffer()!;buffers.push(input,output);gl.bindBuffer(gl.ARRAY_BUFFER,input);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    for(const [location,size,offset] of [[0,3,0],[1,4,3],[2,4,7],[3,4,11],[4,4,15]]){gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,19*4,offset*4);}
    tf=gl.createTransformFeedback();gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,tf);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,oracle.cases.length*3*4,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);
    gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,oracle.cases.length);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);
    const actual=new Float32Array(oracle.cases.length*3);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,actual);const error=gl.getError();if(error!==gl.NO_ERROR)throw Error('Tree GPU error '+error);
    let maxSourceError=0,maxZeroWindError=0,maxMoved=0;const worst:{index:number;sourceError:number}[]=[];
    for(const [i,c] of oracle.cases.entries()){
      const position=Array.from(actual.subarray(i*3,i*3+3));if(!position.every(Number.isFinite))throw Error('Non-finite tree GPU result '+i);
      const delta=Math.hypot(...position.map((v,k)=>v-c.expectedSourcePosition[k]));maxSourceError=Math.max(maxSourceError,delta);
      const moved=Math.hypot(...position.map((v,k)=>v-c.sourcePosition[k]));maxMoved=Math.max(maxMoved,moved);
      if(c.windSourceXY.every(v=>v===0))maxZeroWindError=Math.max(maxZeroWindError,moved);
      worst.push({index:i,sourceError:delta});
    }
    return {cases:oracle.cases.length,maxSourceError,maxPositionErrorMetres:maxSourceError*.0254,maxZeroWindError,maxMoved,
      worst:worst.sort((a,b)=>b.sourceError-a.sourceError).slice(0,5),programSha256:SOURCE_TREESWAY_PROGRAM_SHA256,glError:error,
      boundary:'Actual WebGL2 transform feedback versus independent float32 original-token interpreter. Original native GPU/FMA precision and env_wind simulation are not claimed.'};
  }finally{gl.bindVertexArray(null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);for(const b of buffers)gl.deleteBuffer(b);if(tf)gl.deleteTransformFeedback(tf);if(vao)gl.deleteVertexArray(vao);if(program)gl.deleteProgram(program);for(const s of shaders)gl.deleteShader(s);gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
