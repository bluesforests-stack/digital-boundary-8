/* 困于算法之中 / 被赋予的字符
   p5.js 1.9.4 + ml5.js 0.12.2 PoseNet + Matter.js 0.20.0.
   PoseNet supplies presence and movement vectors, not semantic gesture recognition.
   The label is RANDOM: it is an artistic attribution, never an inferred personality.
   No video is drawn, stored or transmitted. All session state is memory-only. */
const {Engine,Bodies,Body,Composite,Events}=Matter;
const N=260,LANES=24,STEP=1000/120,ABC='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,dt,tau)=>a+(b-a)*(1-Math.exp(-dt/tau));
let engine,letters=[],walls=[],beams=[],ripples=[],echoes=[];
let t=0,acc=0,stage='idle',stageAt=0,label=null,cycle=0,moving=false;
let drive={x:0,y:0,vx:0,vy:0,energy:0},lastSeen=-Infinity,lastMotion=-Infinity;
let lastPose=null,lastPoseAt=0,inputKind='',seenNow=false;
let pointer={x:0,y:0,active:false},pointerSample=null;
let demo=false,demoAt=0,hidden=false,lastUI=0,error='';
let cameraState='off',cameraToken=0,stream=null,video=null,net=null,timer=null;
let cameraSample=null,cameraSampleSeq=0,usedCameraSeq=0;
function setup(){
 createCanvas(windowWidth,windowHeight);pixelDensity(Math.min(window.devicePixelRatio||1,2));textFont('monospace');textAlign(CENTER,CENTER);
 drive.x=width/2;drive.y=height*.51;
 engine=Engine.create({positionIterations:7,velocityIterations:5});engine.gravity.y=0;createWalls();
 for(let i=0;i<LANES;i++)beams.push({a:i/LANES*TWO_PI+Math.sin(i*5.27)*.065,length:.55+(Math.sin(i*2.71)+1)*.22,phase:(i*.618)%1});
 for(let i=0;i<N;i++){
  const r=random(3.2,4.8),b=Bodies.circle(random(32,width-32),random(32,height-32),r,{density:.0018,restitution:.87,friction:.01,frictionAir:.022,label:'letter'});
  Composite.add(engine.world,b);letters.push({b,r,lane:i%LANES,phase:(Math.floor(i/LANES)/12+(i%LANES)*.017)%1,char:ABC[i%26],next:0,trail:[],alpha:1,target:null});
 }
 Events.on(engine,'collisionStart',e=>{for(const pair of e.pairs){
  const wall=pair.bodyA.label.startsWith('wall:')?pair.bodyA:pair.bodyB.label.startsWith('wall:')?pair.bodyB:null;if(!wall)continue;
  const b=wall===pair.bodyA?pair.bodyB:pair.bodyA,s=wall.label.slice(5),p=b.position;
  if(stage!=='idle'&&(moving||stage==='burst')&&b.speed>2.5){
   ripples.push({x:s==='l'?22:s==='r'?width-22:clamp(p.x,22,width-22),y:s==='t'?22:s==='b'?height-22:clamp(p.y,22,height-22),side:s,born:t,power:clamp(b.speed/8,.35,1)});
   if(ripples.length>65)ripples.shift();
  }
 }});
}
function createWalls(){
 walls.forEach(b=>Composite.remove(engine.world,b));const T=120;
 walls=[Bodies.rectangle(22-T/2,height/2,T,height+240,{isStatic:true,label:'wall:l'}),Bodies.rectangle(width-22+T/2,height/2,T,height+240,{isStatic:true,label:'wall:r'}),Bodies.rectangle(width/2,22-T/2,width+240,T,{isStatic:true,label:'wall:t'}),Bodies.rectangle(width/2,height-22+T/2,width+240,T,{isStatic:true,label:'wall:b'})];Composite.add(engine.world,walls);
}
function newGlyph(){return random()<.17?String(Math.floor(random(2))):ABC[Math.floor(random(26))];}
function begin(){
 label=ABC[Math.floor(random(26))];cycle++;stage='gather';stageAt=t;echoes=[];ripples=[];
 letters.forEach(p=>{p.char=label;p.trail=[];p.alpha=1;});
}
function leave(){
 stage='idle';stageAt=t;label=null;moving=false;echoes=[];ripples=[];lastPose=null;lastPoseAt=0;
 drive.vx=drive.vy=drive.energy=0;
 letters.forEach(p=>{p.char=newGlyph();p.next=t+random(100,700);p.trail=[];p.target=null;Body.setVelocity(p.b,{x:p.b.velocity.x*.25,y:p.b.velocity.y*.25});});
}
function burst(){
 stage='burst';stageAt=t;
 for(let i=0;i<N;i++){const p=letters[i],a=i*2.3999632297,speed=8+(i%19)/18*13;Body.setVelocity(p.b,{x:Math.cos(a)*speed,y:Math.sin(a)*speed});p.trail=[];}
}
function demoPose(age){
 const p=age%46;
 if(p<4||p>=38)return null;
 // Entry / active movement / stillness / movement / departure, without a jump at transitions.
 let x=width*.5,y=height*.49;
 if(p>=11&&p<24){const u=p-11;x+=Math.sin(u*1.8)*width*.29;y+=Math.sin(u*1.1)*height*.17;}
 else if(p>=24&&p<31){x+=Math.sin(13*1.8)*width*.29;y+=Math.sin(13*1.1)*height*.17;}
 else if(p>=31){const u=p-31;x+=(Math.sin(13*1.8)+Math.sin(u*2.1)*.65)*width*.29;y+=Math.sin(13*1.1)*height*.17;}
 return Array.from({length:17},(_,i)=>({x:x+(i%2?1:-1)*width*.045,y:y+(i-8)*height*.009,score:1}));
}
function cameraPoints(pose){
 const vw=video.videoWidth||640,vh=video.videoHeight||480,scale=Math.min((width-70)/vw,(height-70)/vh),ox=(width-vw*scale)/2,oy=(height-vh*scale)/2;
 return pose.keypoints.map(k=>({x:ox+(vw-k.position.x)*scale,y:oy+k.position.y*scale,score:k.score}));
}
function acceptPose(points,stamp){
 const valid=points?.filter(p=>p.score>.4)||[];if(valid.length<5)return false;
 const torso=[5,6,11,12].map(i=>points[i]).filter(p=>p?.score>.4),anchors=torso.length>=2?torso:valid;
 const x=anchors.reduce((s,p)=>s+p.x,0)/anchors.length,y=anchors.reduce((s,p)=>s+p.y,0)/anchors.length;
 const sampleDt=lastPoseAt?stamp-lastPoseAt:33;
 let vx=0,vy=0,energy=0;
 const shoulders=points[5]?.score>.4&&points[6]?.score>.4?Math.max(45,Math.hypot(points[5].x-points[6].x,points[5].y-points[6].y)):Math.min(width,height)*.15;
 if(lastPose&&sampleDt>0&&sampleDt<350){
  let weight=0,sumX=0,sumY=0,best={speed:0,vx:0,vy:0},speedSum=0,count=0;
  for(let i=0;i<points.length;i++){const p=points[i],old=lastPose[i];if(p.score<.4||!old||old.score<.4)continue;
   const dx=(p.x-old.x)/sampleDt*16.667,dy=(p.y-old.y)/sampleDt*16.667,s=Math.hypot(dx,dy);
   // Ignore tiny estimation jitter and clamp implausible jumps.
   if(s<shoulders*.009)continue;
   const cap=shoulders*.33,k=Math.min(1,cap/Math.max(s,.001)),w=[5,6,11,12].includes(i)?2:1;
   sumX+=dx*k*w;sumY+=dy*k*w;weight+=w;speedSum+=s*k;count++;
   if(s*k>best.speed)best={speed:s*k,vx:dx*k,vy:dy*k};
  }
  vx=sumX/Math.max(1,weight);vy=sumY/Math.max(1,weight);
  // Opposing limbs can cancel an average: preserve the strongest displacement.
  if(Math.hypot(vx,vy)<best.speed*.25){vx=best.vx*.6;vy=best.vy*.6;}
  energy=clamp(speedSum/Math.max(1,count)/(shoulders*.09),0,1);
  drive.vx=smooth(drive.vx,clamp(vx,-26,26),sampleDt,100);drive.vy=smooth(drive.vy,clamp(vy,-26,26),sampleDt,100);
  drive.energy=smooth(drive.energy,energy,sampleDt,120);
  if(energy>.14)lastMotion=t;
 }
 drive.x=smooth(drive.x,clamp(x,70,width-70),sampleDt,180);drive.y=smooth(drive.y,clamp(y,70,height-70),sampleDt,180);
 lastPose=points.map(p=>({...p}));lastPoseAt=stamp;lastSeen=t;return true;
}
function updateInput(dt){
 seenNow=false;let kind='';
 if(demo){kind='demo';const points=demoPose((t-demoAt)/1000);if(kind!==inputKind){lastPose=null;lastPoseAt=0;}if(points)seenNow=acceptPose(points,t);}
 else if(cameraState==='on'){
  kind='camera';if(kind!==inputKind){lastPose=null;lastPoseAt=0;}
  if(cameraSample&&cameraSampleSeq!==usedCameraSeq){usedCameraSeq=cameraSampleSeq;if(cameraSample.points)seenNow=acceptPose(cameraSample.points,cameraSample.time);}
 }else if(pointer.active){
  kind='pointer';if(kind!==inputKind){lastPose=null;lastPoseAt=0;}
  // Synthetic points use the same motion calculation as the camera.
  const points=Array.from({length:17},(_,i)=>({x:pointer.x+(i%2?25:-25),y:pointer.y+(i-8)*4,score:1}));seenNow=acceptPose(points,t);
 }
 inputKind=kind;
 const stale=kind==='camera'&&cameraSample?performance.now()-cameraSample.time>230:!seenNow;
 if(stale){drive.energy*=Math.exp(-dt/180);drive.vx*=Math.exp(-dt/180);drive.vy*=Math.exp(-dt/180);}
 const present=t-lastSeen<1450;
 if(present&&stage==='idle')begin();
 if(!present&&stage!=='idle')leave();
 // Separate stationary presence from departure, with a small motion hysteresis.
 moving=present&&t-lastMotion<380&&drive.energy>.07;
}
function flowTarget(p,dt){
 const beam=beams[p.lane];p.phase+=dt*.00011*(.8+drive.energy*.7);
 // No active-mode recycling: collisions and all travel stay inside the cage.
 if(p.phase>1)p.phase%=1;
 const phase=p.phase,pulse=.4+.6*Math.pow(.5+.5*Math.sin(t*.001+beam.phase*9),2);
 const a=beam.a+Math.sin(t*.00025+beam.phase*8+phase*3)*.06;
 const centerX=drive.x,centerY=drive.y,dx=Math.cos(a),dy=Math.sin(a);
 const ex=dx>0?(width-32-centerX)/dx:(32-centerX)/dx,ey=dy>0?(height-32-centerY)/dy:(32-centerY)/dy;
 const radius=(.08+Math.pow(phase,.85)*.94)*Math.max(25,Math.min(ex,ey))*beam.length;
 p.alpha=.45+pulse*.55;
 return{x:clamp(centerX+dx*radius,30,width-30),y:clamp(centerY+dy*radius,30,height-30)};
}
function updateTargets(dt){
 const age=t-stageAt;
 if(stage==='gather'&&age>1700){stage='hold';stageAt=t;}
 else if(stage==='hold'&&age>380)burst();
 else if(stage==='burst'&&age>1850){stage='flow';stageAt=t;letters.forEach(p=>p.trail=[]);}
 for(let i=0;i<N;i++){const p=letters[i];p.alpha=1;
  if(stage==='gather'||stage==='hold'){const a=i*2.3999632297,r=Math.sqrt((i+.5)/N)*Math.min(width,height)*.025;p.target={x:width/2+Math.cos(a)*r,y:height*.51+Math.sin(a)*r};}
  else if(stage==='flow'&&moving)p.target=flowTarget(p,dt);
  else p.target=null;
 }
}
function physics(){
 const falling=stage==='idle'||(stage==='flow'&&!moving);
 for(let i=0;i<N;i++){
  const p=letters[i],b=p.b;
  if(p.target){const gain=stage==='gather'?.00007:stage==='hold'?.00012:.000022;
   let fx=clamp((p.target.x-b.position.x)*gain,-.009,.009),fy=clamp((p.target.y-b.position.y)*gain,-.009,.009);
   if(stage==='flow'){fx+=drive.vx*.00046;fy+=drive.vy*.00046;}
   Body.applyForce(b,b.position,{x:b.mass*fx,y:b.mass*fy});
  }else if(falling){
   Body.applyForce(b,b.position,{x:b.mass*Math.sin(t*.0004+i)*.000008,y:b.mass*.00023});
   // Only the unattended idle loop recycles fallen random glyphs.
   // A present but stationary viewer retains their label and the fallen pile.
   if(stage==='idle'&&b.position.y>height-24-p.r&&b.speed<1.2){Body.setPosition(b,{x:random(32,width-32),y:32});Body.setVelocity(b,{x:random(-.3,.3),y:.3});p.char=newGlyph();p.trail=[];}
  }
  if(b.speed>24)Body.setVelocity(b,{x:b.velocity.x/b.speed*24,y:b.velocity.y/b.speed*24});
 }
 Engine.update(engine,STEP);
 // Thick walls + speed bound + 120Hz steps; containment guard handles stalls/resize.
 for(const p of letters){const b=p.b,x=clamp(b.position.x,22+p.r,width-22-p.r),y=clamp(b.position.y,22+p.r,height-22-p.r);
  if(x!==b.position.x||y!==b.position.y){let vx=b.velocity.x,vy=b.velocity.y;
   if(x!==b.position.x)vx=x===22+p.r?Math.abs(vx)*.85:-Math.abs(vx)*.85;
   if(y!==b.position.y)vy=y===22+p.r?Math.abs(vy)*.85:-Math.abs(vy)*.85;
   Body.setPosition(b,{x,y});Body.setVelocity(b,{x:vx,y:vy});
  }
 }
}
function renderLetters(){
 if(stage==='flow'&&moving&&t-(echoes.at(-1)?.born??-Infinity)>180){echoes.push({born:t,pts:letters.filter((_,i)=>i%4===0).map(p=>({x:p.b.position.x,y:p.b.position.y,c:label}))});if(echoes.length>5)echoes.shift();}
 echoes=echoes.filter(e=>t-e.born<1100);noStroke();textSize(9);
 for(const e of echoes){fill(91,182,121,(1-(t-e.born)/1100)*40);for(const q of e.pts)text(q.c,q.x,q.y);}
 for(const p of letters){const b=p.b;
  if(stage!=='idle'&&(moving||stage!=='flow')){p.trail.push({x:b.position.x,y:b.position.y});if(p.trail.length>12)p.trail.shift();}else p.trail=[];
  if(p.trail.length&&b.speed>1){strokeWeight(.65);for(let j=1;j<p.trail.length;j++){stroke(105,236,151,j/p.trail.length*(50+drive.energy*60)*p.alpha);line(p.trail[j-1].x,p.trail[j-1].y,p.trail[j].x,p.trail[j].y);}}
  if(stage==='idle'&&t>p.next){p.char=newGlyph();p.next=t+random(170,700);}else if(label!==null)p.char=label;
  noStroke();fill(155,240,181,(stage==='idle'?100:225)*p.alpha);textSize(p.r*2.5);text(p.char,b.position.x,b.position.y);
 }
 if(stage==='hold'){noStroke();for(let r=35;r>0;r-=4){fill(134,255,172,3);circle(width/2,height*.51,r);}}
}
function renderBoundary(){
 ripples=ripples.filter(r=>t-r.born<900);
 const digit=(x,y,side,k)=>{let glow=0,bulge=0;
  for(const r of ripples){if(r.side!==side)continue;const age=(t-r.born)/900,d=Math.hypot(x-r.x,y-r.y);glow=Math.max(glow,Math.exp(-Math.abs(d-age*170)/21)*(1-age)*r.power);bulge+=Math.exp(-d*d/1800)*Math.sin(age*Math.PI)*r.power*8;}
  const sign=side==='l'||side==='t'?-1:1;if(side==='l'||side==='r')x+=sign*bulge;else y+=sign*bulge;
  fill(77+glow*178,127+glow*128,92+glow*163,35+noise(k,t*.003)*45+glow*180);textSize(9+glow*4);text(noise(k*2,Math.floor(t/95))>.5?'1':'0',x,y);
 };
 noStroke();for(let x=22;x<width-22;x+=14){digit(x,22,'t',x);digit(x,height-22,'b',x+1000);}for(let y=36;y<height-22;y+=14){digit(22,y,'l',y+2000);digit(width-22,y,'r',y+3000);}
 for(const r of ripples){const age=(t-r.born)/900;noFill();strokeWeight(.8);stroke(161,255,187,(1-age)*155*r.power);circle(r.x,r.y,age*190+3);stroke(161,255,187,(1-age)*60*r.power);circle(r.x,r.y,age*125+3);}
}
function draw(){
 const dt=Math.min(deltaTime,50);t+=dt;background(0);updateInput(dt);updateTargets(dt);
 acc+=dt;while(acc>=STEP){physics();acc-=STEP;}
 renderLetters();renderBoundary();
 let status=error||(cameraState==='loading'?'正在加载摄像头与模型…':stage==='idle'?'无人 / 随机字符飘落':stage==='gather'?'进入 / 字符聚焦':stage==='hold'?'停顿 / 标签已赋予':stage==='burst'?'爆发 / 辐射展开':moving?'移动 / 冲撞，无法越界':'静止 / 标签仍在，字符下落');
 if(demo)status='自动演示 / '+status;
 $('status').textContent=status;$('identity').textContent=label?'ASSIGNED / '+label:'';
 if(!hidden&&t-lastUI>24000)setHidden(true);
}
function setHidden(v){hidden=v;document.body.classList.toggle('hidden',v);}
function reset(){leave();lastSeen=-Infinity;lastPose=null;lastPoseAt=0;cameraSample=null;usedCameraSeq=cameraSampleSeq;error='';if(demo)demoAt=t;}
function setDemo(v){if(v)stopCamera();demo=v;demoAt=t;pointer.active=false;reset();$('demo').textContent=v?'停止演示':'自动演示';$('demo').setAttribute('aria-pressed',String(v));}
function input(e,on){
 lastUI=t;if(e.target.tagName!=='CANVAS'){pointer.active=false;return;}
 if(hidden)setHidden(false);if(demo)setDemo(false);pointer={x:e.clientX,y:e.clientY,active:on};
}
window.addEventListener('pointerdown',e=>{input(e,true);if(e.target.tagName==='CANVAS')e.target.setPointerCapture(e.pointerId);});
window.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'||e.buttons)input(e,true);});
window.addEventListener('pointerup',e=>{if(e.pointerType!=='mouse')pointer.active=false;});
window.addEventListener('pointercancel',()=>pointer.active=false);window.addEventListener('blur',()=>pointer.active=false);window.addEventListener('pointerout',e=>{if(!e.relatedTarget)pointer.active=false;});
$('demo').onclick=()=>setDemo(!demo);$('reset').onclick=reset;$('hide').onclick=()=>setHidden(true);
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(e){error='此浏览器不支持全屏，可使用浏览器全屏功能';}}
$('full').onclick=fullscreen;
window.addEventListener('keydown',e=>{lastUI=t;if(e.key.toLowerCase()==='h')setHidden(!hidden);if(e.key.toLowerCase()==='f')fullscreen();if(e.key.toLowerCase()==='r')reset();});
function stopCamera(){cameraToken++;clearTimeout(timer);if(net)net.removeAllListeners('pose');net=null;if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;if(video){video.pause();video.srcObject=null;video.remove();video=null;}cameraState='off';cameraSample=null;lastPose=null;lastPoseAt=0;$('camera').textContent='开启摄像头';}
$('camera').onclick=async()=>{
 if(cameraState!=='off'){stopCamera();return;}
 if(!window.isSecureContext||!navigator.mediaDevices){error='摄像头需要 HTTPS 或 localhost；仍可使用自动演示';return;}
 if(demo)setDemo(false);pointer.active=false;
 const token=++cameraToken;cameraState='loading';error='';$('camera').textContent='取消摄像头';
 timer=setTimeout(()=>{if(token===cameraToken){stopCamera();error='模型加载超时，请重试或使用自动演示';}},60000);
 try{
  const s=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'},audio:false});if(token!==cameraToken){s.getTracks().forEach(v=>v.stop());return;}stream=s;
  const v=document.createElement('video');video=v;v.muted=true;v.playsInline=true;v.width=640;v.height=480;v.srcObject=s;document.body.appendChild(v);await v.play();if(token!==cameraToken)return;
  net=ml5.poseNet(v,{detectionType:'single',architecture:'MobileNetV1',outputStride:16,inputResolution:257,multiplier:.75,quantBytes:2,modelUrl:'model/model.json',flipHorizontal:false},()=>{if(token!==cameraToken)return;clearTimeout(timer);cameraState='on';$('camera').textContent='关闭摄像头';});
  net.on('pose',results=>{if(token!==cameraToken||cameraState!=='on')return;const pose=results[0]?.pose;cameraSample={points:pose&&pose.score>.2?cameraPoints(pose):null,time:performance.now()};cameraSampleSeq++;});
 }catch(e){if(token===cameraToken){stopCamera();error='摄像头不可用，可使用自动演示：'+e.message;}}
};
function windowResized(){
 const ow=width,oh=height;resizeCanvas(windowWidth,windowHeight);createWalls();letters.forEach(p=>{Body.setPosition(p.b,{x:clamp(p.b.position.x/ow*width,30,width-30),y:clamp(p.b.position.y/oh*height,30,height-30)});p.trail=[];});
 drive.x=clamp(drive.x/ow*width,70,width-70);drive.y=clamp(drive.y/oh*height,70,height-70);lastPose=null;lastPoseAt=0;cameraSample=null;echoes=[];ripples=[];acc=0;
}
window.addEventListener('pagehide',stopCamera);
