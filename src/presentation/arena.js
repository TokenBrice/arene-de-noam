import * as THREE from 'three';

const THEMES={
  crystal:{sky:0x07132f,fog:0x101d40,floor:0x142950,glow:0x67eaff,accent:0xa67cff,secondary:0xffd97c,particle:'crystal'},
  grove:{sky:0x061b18,fog:0x0b2920,floor:0x16392d,glow:0x79f28a,accent:0xd1ff72,secondary:0x4ac8a7,particle:'leaf'},
  tidal:{sky:0x021627,fog:0x05283d,floor:0x0a3b50,glow:0x53f5ed,accent:0x4d80ff,secondary:0xd0fbff,particle:'bubble'},
  volcano:{sky:0x210805,fog:0x34100a,floor:0x351b1a,glow:0xff5b31,accent:0xffc052,secondary:0xfff08c,particle:'ember'},
  astral:{sky:0x090822,fog:0x151036,floor:0x23204b,glow:0xd98cff,accent:0x68dfff,secondary:0xffdd88,particle:'star'},
  eclipse:{sky:0x100817,fog:0x1b0b25,floor:0x331735,glow:0xff7ab8,accent:0x8455ff,secondary:0xffbd68,particle:'ash'},
};

function material(color,{emissive=.25,metalness=.3,roughness=.45,transparent=false,opacity=1}={}){return new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:emissive,metalness,roughness,transparent,opacity});}

export class ArenaScene{
  constructor(canvas,theme='crystal',{reducedMotion=false}={}){
    this.canvas=canvas;this.reducedMotion=reducedMotion;this.theme=THEMES[theme]?theme:'crystal';this.disposed=false;this.animations=[];this.tension=0;this.targetTension=0;this.arenaCharge=0;
    try{this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});}catch(error){throw new Error('WEBGL_UNAVAILABLE',{cause:error});}
    this.renderer.setPixelRatio(Math.min(2,globalThis.devicePixelRatio||1));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(42,1,.1,100);this.cameraBase={x:0,y:5.2,z:9.4};this.cameraKick={x:0,y:0,z:0};this.camera.position.set(this.cameraBase.x,this.cameraBase.y,this.cameraBase.z);this.camera.lookAt(0,.55,0);this.clock=new THREE.Clock();this.elapsed=0;
    this.build(this.theme);this.resize();this.onResize=()=>this.resize();globalThis.addEventListener('resize',this.onResize);this.contextLost=(event)=>{event.preventDefault();canvas.dispatchEvent(new CustomEvent('arena-context-lost',{bubbles:true}));};canvas.addEventListener('webglcontextlost',this.contextLost);this.animate();
  }
  add(object,parent=this.scene){parent.add(object);return object;}
  build(themeId){
    const t=THEMES[themeId];this.colors=t;this.scene.background=new THREE.Color(t.sky);this.scene.fog=new THREE.FogExp2(t.fog,.052);
    this.hemi=this.add(new THREE.HemisphereLight(t.glow,0x03030b,1.8));this.moon=this.add(new THREE.DirectionalLight(t.secondary,3.4));this.moon.position.set(-4,8,5);this.rim=this.add(new THREE.PointLight(t.glow,25,16));this.rim.position.set(4,3,-1);
    this.buildDais(t);this.buildArchitecture(themeId,t);this.buildParticles(t);this.createBurstPool(t.glow);
  }
  buildDais(t){
    const dais=this.add(new THREE.Group());
    const base=this.add(new THREE.Mesh(new THREE.CylinderGeometry(5.25,5.8,.48,64),material(t.floor,{emissive:.12,metalness:.48,roughness:.5})),dais);base.position.y=-.42;
    const inset=this.add(new THREE.Mesh(new THREE.CylinderGeometry(4.62,4.86,.12,64),material(t.floor,{emissive:.2,metalness:.25,roughness:.7})),dais);inset.position.y=-.13;
    [4.35,3.65,2.15].forEach((radius,index)=>{const ring=this.add(new THREE.Mesh(new THREE.TorusGeometry(radius,.035+index*.008,8,96),new THREE.MeshBasicMaterial({color:index===2?t.accent:t.glow,transparent:true,opacity:.62-index*.1})),dais);ring.rotation.x=Math.PI/2;ring.position.y=-.04;this.animations.push({object:ring,type:'spin',speed:(index%2?-.05:.04)*(index+1)});});
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2;const rune=this.add(new THREE.Mesh(new THREE.BoxGeometry(.08,.015,.46),new THREE.MeshBasicMaterial({color:i%3===0?t.secondary:t.glow,transparent:true,opacity:.72})),dais);rune.position.set(Math.cos(a)*3.05,-.015,Math.sin(a)*3.05);rune.rotation.y=-a;}
  }
  buildArchitecture(theme,t){
    if(theme==='crystal')this.buildCrystal(t);if(theme==='grove')this.buildGrove(t);if(theme==='tidal')this.buildTidal(t);if(theme==='volcano')this.buildVolcano(t);if(theme==='astral')this.buildAstral(t);if(theme==='eclipse')this.buildEclipse(t);
  }
  buildCrystal(t){
    for(let i=0;i<14;i++){const a=i/14*Math.PI*2,h=1.2+(i%5)*.48;const cluster=this.add(new THREE.Group());cluster.position.set(Math.cos(a)*5.6,h*.35-.2,Math.sin(a)*5.6);cluster.rotation.z=(i%3-1)*.09;for(let s=0;s<3;s++){const shard=this.add(new THREE.Mesh(new THREE.ConeGeometry(.18+s*.04,h*(1-s*.18),5),material(s===1?t.accent:t.glow,{emissive:.65,metalness:.6,roughness:.2,transparent:true,opacity:.82})),cluster);shard.position.x=(s-1)*.22;shard.rotation.z=(s-1)*.16;}this.animations.push({object:cluster,type:'breathe',offset:i});}
    const arch=this.add(new THREE.Mesh(new THREE.TorusGeometry(3.15,.16,8,48,Math.PI),material(t.accent,{emissive:.8,metalness:.65,roughness:.18})));arch.position.set(0,2.15,-5.3);arch.rotation.z=Math.PI;this.animations.push({object:arch,type:'pulse'});
  }
  buildGrove(t){
    for(const side of [-1,1]){const trunk=this.add(new THREE.Mesh(new THREE.CylinderGeometry(.35,.62,5.5,9),material(0x29442e,{emissive:.04,metalness:0,roughness:1})));trunk.position.set(side*5.2,2.1,-2.4);trunk.rotation.z=-side*.12;for(let i=0;i<8;i++){const leaf=this.add(new THREE.Mesh(new THREE.SphereGeometry(.62+(i%3)*.15,10,7),material(i%2?t.glow:t.accent,{emissive:.3,metalness:0,roughness:.8,transparent:true,opacity:.82})));leaf.scale.set(1.5,.55,1);leaf.position.set(side*(4.2+(i%3)*.55),3.8+(i%4)*.35,-2.7+(i%2)*.7);this.animations.push({object:leaf,type:'sway',offset:i+side});}}
    for(let i=0;i<10;i++){const a=i/10*Math.PI*2;const flower=this.add(new THREE.Mesh(new THREE.TorusKnotGeometry(.12,.045,32,6,2,3),material(i%2?t.glow:t.secondary,{emissive:.9,metalness:.1,roughness:.45})));flower.position.set(Math.cos(a)*5.15,.05+Math.sin(i)*.08,Math.sin(a)*5.15);this.animations.push({object:flower,type:'float',offset:i});}
  }
  buildTidal(t){
    for(const side of [-1,1])for(let i=0;i<4;i++){const arch=this.add(new THREE.Mesh(new THREE.TorusGeometry(1.2+i*.08,.12,8,36,Math.PI),material(i%2?t.glow:t.accent,{emissive:.5,metalness:.45,roughness:.25,transparent:true,opacity:.75})));arch.position.set(side*(4.6+i*.28),1.25+i*.18,-2.5-i*.6);arch.rotation.z=Math.PI;arch.rotation.y=side*.25;this.animations.push({object:arch,type:'sway',offset:i+side});}
    const whirl=this.add(new THREE.Mesh(new THREE.TorusGeometry(2.25,.07,8,80),new THREE.MeshBasicMaterial({color:t.glow,transparent:true,opacity:.55})));whirl.position.set(0,2.6,-5);whirl.rotation.x=.35;this.animations.push({object:whirl,type:'spin',speed:.22});
  }
  buildVolcano(t){
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2,h=.7+(i%4)*.55;const rock=this.add(new THREE.Mesh(new THREE.DodecahedronGeometry(.35+(i%3)*.12,0),material(i%3===0?t.glow:0x3b2522,{emissive:i%3===0?.85:.08,metalness:.15,roughness:.9})));rock.scale.y=h;rock.position.set(Math.cos(a)*5.45,h*.25-.12,Math.sin(a)*5.45);this.animations.push({object:rock,type:i%3===0?'pulse':'still',offset:i});}
    const sun=this.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.25,2),new THREE.MeshBasicMaterial({color:t.secondary,transparent:true,opacity:.78})));sun.position.set(0,3.5,-6);this.animations.push({object:sun,type:'pulse',speed:2});
  }
  buildAstral(t){
    const orb=this.add(new THREE.Mesh(new THREE.SphereGeometry(.72,24,18),material(t.secondary,{emissive:1,metalness:.1,roughness:.1})));orb.position.set(0,3.05,-5.4);this.animations.push({object:orb,type:'float'});
    for(let i=0;i<5;i++){const ring=this.add(new THREE.Mesh(new THREE.TorusGeometry(1.25+i*.32,.035,6,64),new THREE.MeshBasicMaterial({color:i%2?t.glow:t.accent,transparent:true,opacity:.58})));ring.position.copy(orb.position);ring.rotation.set(i*.42,i*.67,0);this.animations.push({object:ring,type:'orbit',speed:.08+i*.035,offset:i});}
    for(let i=0;i<9;i++){const crystal=this.add(new THREE.Mesh(new THREE.OctahedronGeometry(.2+(i%2)*.1),material(i%2?t.glow:t.accent,{emissive:.7,metalness:.5,roughness:.2})));const a=i/9*Math.PI*2;crystal.position.set(Math.cos(a)*5.2,1+(i%3)*.65,Math.sin(a)*5.2);this.animations.push({object:crystal,type:'float',offset:i});}
  }
  buildEclipse(t){
    const corona=this.add(new THREE.Mesh(new THREE.TorusGeometry(1.45,.16,12,80),material(t.secondary,{emissive:1,metalness:.35,roughness:.18})));corona.position.set(0,3.2,-5.5);this.animations.push({object:corona,type:'pulse',speed:1.3});
    const dark=this.add(new THREE.Mesh(new THREE.SphereGeometry(1.28,28,20),new THREE.MeshBasicMaterial({color:0x06030b})));dark.position.copy(corona.position);
    for(let i=0;i<9;i++){const a=i/9*Math.PI*2,h=1.1+(i%4)*.38;const blade=this.add(new THREE.Mesh(new THREE.ConeGeometry(.2,h,4),material(i%2?t.accent:t.glow,{emissive:.5,metalness:.75,roughness:.25})));blade.position.set(Math.cos(a)*5.4,h*.35,Math.sin(a)*5.4);blade.rotation.z=(i%2?1:-1)*.22;this.animations.push({object:blade,type:'breathe',offset:i});}
  }
  buildParticles(t){
    const count=this.reducedMotion?70:170,positions=new Float32Array(count*3),colors=new Float32Array(count*3),base=new THREE.Color(t.glow),alt=new THREE.Color(t.secondary);
    for(let i=0;i<count;i++){positions[i*3]=((((i*73)%197)/197)-.5)*16;positions[i*3+1]=((i*43+17)%191)/191*7;positions[i*3+2]=((((i*61+9)%181)/181)-.5)*10;const c=i%4===0?alt:base;colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b;}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));this.dust=this.add(new THREE.Points(geometry,new THREE.PointsMaterial({size:t.particle==='ember'?.075:.045,transparent:true,opacity:.7,vertexColors:true,depthWrite:false,blending:THREE.AdditiveBlending})));this.dust.userData.particle=t.particle;
  }
  createBurstPool(color){const count=180,positions=new Float32Array(count*3);positions.fill(99);this.burstVelocity=new Float32Array(count*3);const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));const mat=new THREE.PointsMaterial({color,size:.13,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});this.burstPoints=this.add(new THREE.Points(geometry,mat));this.burstPoints.frustumCulled=false;this.fxLight=this.add(new THREE.PointLight(color,0,14));this.burstLife=0;}
  resize(){if(this.disposed)return;const rect=this.canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);}
  setBattleState({tension=0,imminent=false}={}){this.targetTension=Math.max(0,Math.min(1,tension));this.arenaCharge=imminent?1:0;}
  burst(color='#fff',targetSide='enemy',strength=1){if(!this.burstPoints)return;const positions=this.burstPoints.geometry.attributes.position.array,origin=targetSide==='enemy'?2.35:-2.35,count=this.reducedMotion?34:strength>1?180:112;this.burstPoints.material.color.set(color);this.burstPoints.material.size=.1+.06*strength;this.burstPoints.material.opacity=1;this.fxLight.color.set(color);this.fxLight.position.set(origin,1.7,.5);this.fxLight.intensity=30*strength;for(let i=0;i<180;i++){const p=i*3;if(i<count){const angle=i*2.399963,fan=.4+((i*37)%71)/71*1.5;positions[p]=origin+Math.cos(angle)*.12;positions[p+1]=1.15+Math.sin(angle)*.12;positions[p+2]=.4;this.burstVelocity[p]=Math.cos(angle)*fan;this.burstVelocity[p+1]=Math.sin(angle)*fan+1.25;this.burstVelocity[p+2]=((((i*53)%97)/97)-.5)*2;}else positions[p]=positions[p+1]=positions[p+2]=99;}this.burstPoints.geometry.attributes.position.needsUpdate=true;this.burstLife=.82;}
  flash(kind='hit',color='#fff',targetSide='enemy'){this.burst(color,targetSide,kind==='power'?1.65:1);if(this.reducedMotion)return;this.canvas.classList.remove('arena-hit','arena-power');void this.canvas.offsetWidth;this.canvas.classList.add(kind==='power'?'arena-power':'arena-hit');}
  punch(targetSide='enemy',strength=1){if(this.reducedMotion)return;this.cameraKick.x=(targetSide==='enemy'?-.22:.22)*strength;this.cameraKick.y=.09*strength;this.cameraKick.z=-.42*strength;}
  animate(){if(this.disposed)return;const dt=Math.min(.04,this.clock.getDelta());this.elapsed+=dt;const t=this.elapsed;this.tension+=(this.targetTension-this.tension)*Math.min(1,dt*2.4);const chargePulse=this.arenaCharge*(.5+Math.sin(t*5)*.5);this.renderer.toneMappingExposure=1.15+this.tension*.2+chargePulse*.07;if(this.rim)this.rim.intensity=25+this.tension*19+chargePulse*12;if(this.moon)this.moon.intensity=3.4+this.tension*1.4;if(this.hemi)this.hemi.intensity=1.8+this.tension*.45;if(this.dust){this.dust.rotation.y=t*(this.dust.userData.particle==='ember'?.06:.022)*(1+this.tension*.9);this.dust.position.y=Math.sin(t*.4)*.08+(this.dust.userData.particle==='ember'?(t*.1)%1:0);this.dust.material.opacity=.7+this.tension*.22;}if(!this.reducedMotion){this.cameraKick.x*=.84;this.cameraKick.y*=.84;this.cameraKick.z*=.84;this.cameraBase.z=9.4-this.tension*.5;this.cameraBase.y=5.2-this.tension*.12;this.camera.position.set(this.cameraBase.x+this.cameraKick.x,this.cameraBase.y+this.cameraKick.y,this.cameraBase.z+this.cameraKick.z);this.camera.lookAt(this.cameraKick.x*-.45,.55+this.cameraKick.y*.2,0);for(const item of this.animations){const o=item.object,phase=t*(item.speed||1)*(1+this.tension*.35)+(item.offset||0);if(item.type==='spin')o.rotation.y+=dt*(item.speed||.1)*(1+this.tension);if(item.type==='orbit'){o.rotation.x+=dt*item.speed*(1+this.tension);o.rotation.y-=dt*item.speed*.7*(1+this.tension);}if(item.type==='float')o.position.y+=Math.sin(phase*1.2)*.0018;if(item.type==='sway')o.rotation.z=Math.sin(phase*.65)*.07;if(item.type==='breathe')o.scale.y=1+Math.sin(phase*.8)*(.035+this.tension*.012);if(item.type==='pulse'&&o.material)o.material.emissiveIntensity=.5+this.tension*.3+Math.sin(phase*(item.speed||1))*(.3+chargePulse*.18);}}
    if(this.burstLife>0){const positions=this.burstPoints.geometry.attributes.position.array;for(let i=0;i<180;i++){const p=i*3;if(positions[p]>50)continue;positions[p]+=this.burstVelocity[p]*dt;positions[p+1]+=this.burstVelocity[p+1]*dt;positions[p+2]+=this.burstVelocity[p+2]*dt;this.burstVelocity[p+1]-=2.9*dt;}this.burstLife=Math.max(0,this.burstLife-dt);this.burstPoints.material.opacity=Math.min(1,this.burstLife*2);this.fxLight.intensity*=.87;this.burstPoints.geometry.attributes.position.needsUpdate=true;}this.renderer.render(this.scene,this.camera);this.frame=requestAnimationFrame(()=>this.animate());}
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);globalThis.removeEventListener('resize',this.onResize);this.canvas.removeEventListener('webglcontextlost',this.contextLost);this.scene.traverse((o)=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach((m)=>m.dispose());else o.material?.dispose();});this.renderer.dispose();}
}
