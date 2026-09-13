// DEADLINE 2099 - build 0.4.3 "MARKER CLEAR"
// Fan-made browser sequel set in Chicago 2099. No assets - everything procedural.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

/* ============================== settings ============================== */
const S = {
  vol: 0.7, sens: 0.8, invertY: false, quality: 'med',
  pixelRatio: 1, fogDensity: 0.016,
};
function saveSettings(){
  try { localStorage.setItem('deadline2099-settings', JSON.stringify({ vol:S.vol, sens:S.sens, invertY:S.invertY, quality:S.quality })); } catch(e){}
}
function loadSettings(){
  try {
    const s = JSON.parse(localStorage.getItem('deadline2099-settings') || 'null');
    if (s){ Object.assign(S, s); }
  } catch(e){}
}
let moonLight = null;
function applyQuality(){
  const q = S.quality;
  S.pixelRatio = q==='low' ? Math.min(devicePixelRatio,1) : q==='med' ? Math.min(devicePixelRatio,1.5) : Math.min(devicePixelRatio,2);
  S.fogDensity = q==='low' ? 0.02 : q==='med' ? 0.016 : 0.013;
  if (renderer){
    renderer.setPixelRatio(S.pixelRatio);
    scene.fog.density = S.fogDensity;
    renderer.shadowMap.enabled = q !== 'low';
    if (moonLight) moonLight.castShadow = q !== 'low';
    rebuildRain();
    saveSettings();
  }
}

/* ============================== seeded rng ============================== */
const urlParams = new URLSearchParams(location.search);
const CITY_SEED = parseInt(urlParams.get('seed') || '2099', 10);
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(CITY_SEED);

// world layout constants - terminal sits just inside the L ring ("under the L")
const L_RADIUS = 210;
const TERMINAL_POS = { x: -142, z: -142 };
const EXTRACTION_POS = { x: 82, z: 96 };

/* ============================== dom refs ============================== */
const $ = id => document.getElementById(id);
const el = {
  title: $('title-screen'), opts: $('options-screen'), creds: $('credits-screen'),
  hud: $('hud'), card: $('card-screen'), cardTitle: $('card-title'),
  cardBody: $('card-body'), cardMenu: $('card-menu'),
  objText: $('obj-text'), objDist: $('obj-dist'),
  hp: $('hp-fill'), sh: $('sh-fill'), heat: $('heat-fill'),
  msg: $('hud-msg'), hint: $('hint'), vig: $('damage-vignette'),
  rain: $('rain-streaks'),
};

/* ============================== audio ============================== */
const AudioSys = {
  ctx:null, master:null, musicGain:null, sfxGain:null, combatGain:null,
  started:false, combat:0, combatTarget:0, seq:null,
  init(){
    if (this.started) return;
    const C = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = C;
    this.master = C.createGain(); this.master.gain.value = S.vol;
    this.master.connect(C.destination);
    this.musicGain = C.createGain(); this.musicGain.gain.value = 0.5; this.musicGain.connect(this.master);
    this.combatGain = C.createGain(); this.combatGain.gain.value = 0.0; this.combatGain.connect(this.master);
    this.sfxGain = C.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
    this.startRain();
    this.startMusic();
    this.started = true;
  },
  setVol(v){ if (this.master) this.master.gain.value = v; },
  startRain(){
    const C = this.ctx;
    const len = C.sampleRate * 2, buf = C.createBuffer(1, len, C.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i] = (Math.random()*2-1) * 0.5;
    const src = C.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = C.createBiquadFilter(); f.type='bandpass'; f.frequency.value=2400; f.Q.value=0.4;
    const g = C.createGain(); g.gain.value = 0.05;
    src.connect(f); f.connect(g); g.connect(this.musicGain); src.start();
    this.rainGain = g;
  },
  note(freq, t0, dur, type, gain, dest, slideTo){
    const C = this.ctx;
    const o = C.createOscillator(); o.type = type || 'sawtooth'; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0+dur);
    const g = C.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    const f = C.createBiquadFilter(); f.type='lowpass'; f.frequency.value = 1800;
    o.connect(f); f.connect(g); g.connect(dest || this.musicGain);
    o.start(t0); o.stop(t0+dur+0.05);
  },
  startMusic(){
    // D minor progression, slow pad + 16th arp + sub pulse. Combat adds driving hats.
    const C = this.ctx;
    const chords = [
      [146.83, 220.0, 293.66],   // Dm
      [116.54, 174.61, 233.08],  // Bb
      [130.81, 196.0, 261.63],   // C
      [110.0, 164.81, 220.0],    // Am
    ];
    const arpNotes = [293.66, 349.23, 440.0, 587.33, 440.0, 349.23];
    let bar = 0;
    const barLen = 2.4;
    const tick = () => {
      if (!this.started) return;
      const t = C.currentTime + 0.1;
      const ch = chords[bar % 4];
      for (const f of ch) this.note(f, t, barLen*1.05, 'sawtooth', 0.028);
      this.note(ch[0]/2, t, barLen*1.05, 'sine', 0.06);
      for (let i=0;i<8;i++){
        const a = arpNotes[(bar*3+i) % arpNotes.length];
        this.note(a, t + i*(barLen/8), 0.16, 'square', 0.012);
      }
      // combat layer: sub kick + hats
      for (let i=0;i<4;i++){
        const kt = t + i*(barLen/4);
        this.note(55, kt, 0.22, 'sine', 0.5, this.combatGain, 38);
        this.noiseHit(kt + barLen/8, 0.03, 6000, 0.05, this.combatGain);
        this.noiseHit(kt + 3*barLen/16, 0.02, 8000, 0.03, this.combatGain);
      }
      bar++;
      this.seq = setTimeout(tick, barLen*1000 - 80);
    };
    tick();
  },
  noiseHit(t0, dur, freq, gain, dest){
    const C = this.ctx;
    const len = Math.floor(C.sampleRate*dur), buf = C.createBuffer(1, len, C.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i] = (Math.random()*2-1) * (1 - i/len);
    const src = C.createBufferSource(); src.buffer = buf;
    const f = C.createBiquadFilter(); f.type='highpass'; f.frequency.value=freq;
    const g = C.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(dest || this.sfxGain);
    src.start(t0);
  },
  shoot(){
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.note(880, t, 0.09, 'square', 0.14, this.sfxGain, 160);
    this.noiseHit(t, 0.08, 1800, 0.2);
  },
  hitConfirm(){
    if (!this.started) return;
    this.note(1320, this.ctx.currentTime, 0.06, 'sine', 0.12, this.sfxGain);
  },
  explosion(){
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.note(120, t, 0.5, 'sawtooth', 0.3, this.sfxGain, 30);
    this.noiseHit(t, 0.45, 300, 0.4);
  },
  hurt(){
    if (!this.started) return;
    this.note(180, this.ctx.currentTime, 0.2, 'sawtooth', 0.2, this.sfxGain, 70);
  },
  blip(){
    if (!this.started) return;
    this.note(660, this.ctx.currentTime, 0.05, 'sine', 0.08, this.sfxGain);
  },
  objective(){
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.note(523, t, 0.12, 'sine', 0.1, this.sfxGain);
    this.note(784, t+0.12, 0.18, 'sine', 0.1, this.sfxGain);
  },
  trainRumble(){
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, 0.9, 120, 0.12);
  },
  jumpSfx(){ if (this.started) this.note(300, this.ctx.currentTime, 0.1, 'sine', 0.06, this.sfxGain, 500); },
};

/* ============================== scene core ============================== */
let renderer, scene, camera, clock;
const WORLD = { size: 640, block: 64, road: 18 };

function initRenderer(){
  renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('app').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);
  scene.fog = new THREE.FogExp2(0x0a0e18, S.fogDensity);

  camera = new THREE.PerspectiveCamera(68, innerWidth/innerHeight, 0.1, 900);
  camera.position.set(0, 3, 8);

  clock = new THREE.Clock();
  applyQuality();
  addEventListener('resize', () => {
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // lighting: cold moon + warm sodium street level
  const moon = new THREE.DirectionalLight(0x7a9cc8, 0.5);
  moon.position.set(-120, 220, 80);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024,1024);
  moon.shadow.camera.left=-160; moon.shadow.camera.right=160;
  moon.shadow.camera.top=160; moon.shadow.camera.bottom=-160;
  moon.shadow.camera.far=600;
  scene.add(moon);
  moonLight = moon;
  scene.add(new THREE.AmbientLight(0x2a3448, 0.85));
  const hemi = new THREE.HemisphereLight(0x1c2c4a, 0x0c0805, 0.8);
  scene.add(hemi);
}

/* ---------- procedural textures ---------- */
function canvasTex(w, h, draw){
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
function buildingTexture(seedHue){
  return canvasTex(128, 256, (g,w,h) => {
    g.fillStyle = '#0a0d13'; g.fillRect(0,0,w,h);
    for (let y=8; y<h-8; y+=14){
      for (let x=6; x<w-6; x+=12){
        const lit = rand();
        if (lit > 0.55){
          const warm = rand() > 0.3;
          g.fillStyle = warm
            ? `rgba(255,${170+rand()*60|0},${90+rand()*40|0},${0.55+rand()*0.45})`
            : `rgba(${120+rand()*60|0},${200+rand()*40|0},255,${0.5+rand()*0.5})`;
          g.fillRect(x, y, 7, 9);
        } else {
          g.fillStyle = 'rgba(30,38,52,0.9)';
          g.fillRect(x, y, 7, 9);
        }
      }
    }
  });
}
const NEON_WORDS = [
  ['MALORT','#ff3e8d'],['THE L','#3ee6ff'],['PIEROGI 24H','#ffb54d'],
  ['NOODLE BAR','#ff5e3e'],['RIVERWALK','#3ee6ff'],['DEEP DISH','#ffb54d'],
  ['DATA MARKET','#b46bff'],['PAWN // GOLD','#ffd23e'],['KARAOKE','#ff3e8d'],
  ['WICKER PK','#3ee6ff'],['POLSKI BAR','#ff5e3e'],['ELOTES','#ffd23e'],
  ['CLINICA','#3ee6ff'],['LIVE BLUES','#b46bff'],['HOTEL','#ff3e8d'],
];
function neonTexture(word, color){
  return canvasTex(256, 64, (g,w,h) => {
    g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0,0,w,h);
    g.font = 'bold 30px "Courier New", monospace';
    g.textAlign='center'; g.textBaseline='middle';
    g.shadowColor = color; g.shadowBlur = 18;
    g.fillStyle = color;
    g.fillText(word, w/2, h/2);
    g.shadowBlur = 6;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.85;
    g.fillText(word, w/2, h/2);
  });
}

/* ---------- city ---------- */
const cityGroup = new THREE.Group();
const colliders = [];   // {minX,maxX,minZ,maxZ}
const trains = [];
let objectiveMarker = null;

function buildCity(){
  scene.add(cityGroup);
  const B = WORLD.block, R = WORLD.road, N = 8; // blocks per side

  // ground
  const groundMat = new THREE.MeshStandardMaterial({ color:0x0b0e14, roughness:0.25, metalness:0.75 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size*2, WORLD.size*2), groundMat);
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  cityGroup.add(ground);

  // wet street glow strips
  const stripMat = new THREE.MeshBasicMaterial({ color:0x18242f, transparent:true, opacity:0.5 });

  // buildings
  const winTexA = buildingTexture(), winTexB = buildingTexture(), winTexC = buildingTexture();
  const winTexs = [winTexA, winTexB, winTexC];
  const boxGeo = new THREE.BoxGeometry(1,1,1);
  boxGeo.translate(0, 0.5, 0);

  for (let bx=-N; bx<N; bx++){
    for (let bz=-N; bz<N; bz++){
      const cx = bx*(B+R) + (B+R)/2, cz = bz*(B+R) + (B+R)/2;
      const dist = Math.hypot(cx, cz);
      if (Math.abs(cz - riverZ) < 30) continue;        // river carve
      if (dist > WORLD.size) continue;
      if (Math.abs(dist - L_RADIUS) < 16) continue;    // the L corridor
      // 1-4 towers per block
      const nT = 1 + (rand()*3|0);
      for (let i=0;i<nT;i++){
        const w = 12 + rand()*22, d = 12 + rand()*22;
        const hBase = dist < 160 ? 45 : 18;
        const h = hBase + rand()*hBase*1.6;
        const ox = cx + (rand()-0.5)*(B-w-6), oz = cz + (rand()-0.5)*(B-d-6);
        const odist = Math.hypot(ox, oz);
        if (Math.abs(odist - L_RADIUS) < 14) continue;             // keep the track clear
        if (Math.hypot(ox-TERMINAL_POS.x, oz-TERMINAL_POS.z) < 16) continue;  // dead drop stays reachable
        if (Math.hypot(ox+60, oz+195) < 16) continue;                         // Act III vault stays reachable
        if (Math.hypot(ox-EXTRACTION_POS.x, oz-EXTRACTION_POS.z) < 16) continue;
        const mat = new THREE.MeshStandardMaterial({
          color:0x11151d, roughness:0.85, metalness:0.2,
          emissive:0xffffff, emissiveMap: winTexs[(rand()*3)|0], emissiveIntensity:0.85,
          map: winTexs[(rand()*3)|0],
        });
        const m = new THREE.Mesh(boxGeo, mat);
        m.position.set(ox, 0, oz);
        m.scale.set(w, h, d);
        m.castShadow = true; m.receiveShadow = true;
        cityGroup.add(m);
        colliders.push({minX:ox-w/2, maxX:ox+w/2, minZ:oz-d/2, maxZ:oz+d/2, maxY:h});

        // rooftop beacon on tall towers
        if (h > 55 && rand() > 0.5){
          const beacon = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 8, 8),
            new THREE.MeshBasicMaterial({ color:0xff2244 }));
          beacon.position.set(ox, h+1, oz);
          beacon.userData.blink = rand()*2;
          cityGroup.add(beacon);
          blinkers.push(beacon);
        }
      }
      // Mag Mile corridor: dense towers + big billboards (x 100..300, z -40..40)
      const onMile = cx > 100 && cx < 300 && Math.abs(cz) < 40;
      if (onMile && rand() > 0.35){
        const boards = [['MAG MILE','#3ee6ff'],['NORTHERLY 875','#ff3e8d'],['WATER TOWER PLACE 2099','#ffb54d'],['THE DRAKE AI','#b46bff'],['OAK ST BEACH ->','#3ee6ff']];
        const [word, color] = boards[(rand()*boards.length)|0];
        const t = canvasTex(512, 128, (g,w,h) => {
          g.clearRect(0,0,w,h);
          g.font = 'bold 52px "Courier New", monospace';
          g.textAlign='center'; g.textBaseline='middle';
          g.shadowColor = color; g.shadowBlur = 26;
          g.fillStyle = color;
          g.fillText(word, w/2, h/2);
          g.shadowBlur = 8; g.globalAlpha = 0.85; g.fillStyle = '#ffffff';
          g.fillText(word, w/2, h/2);
        });
        const bb = new THREE.Mesh(new THREE.PlaneGeometry(34, 8.5),
          new THREE.MeshBasicMaterial({ map:t, transparent:true, side:THREE.DoubleSide, depthWrite:false }));
        bb.position.set(cx + (rand()-0.5)*20, 30 + rand()*26, cz + (Math.abs(cz) < 20 ? (cz >= 0 ? 34 : -34) : 0));
        bb.rotation.y = bb.position.z > cz ? Math.PI : 0;
        cityGroup.add(bb);
        const bl = new THREE.PointLight(new THREE.Color(color), 14, 60, 2);
        bl.position.copy(bb.position);
        cityGroup.add(bl);
      }
      // street neon on some block corners
      if (rand() > (onMile ? 0.2 : 0.45)){
        const [word, color] = NEON_WORDS[(rand()*NEON_WORDS.length)|0];
        const t = neonTexture(word, color);
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(14, 3.5),
          new THREE.MeshBasicMaterial({ map:t, transparent:true, side:THREE.DoubleSide, depthWrite:false }));
        const sx = cx + (rand() > 0.5 ? B/2+1 : -B/2-1);
        sign.position.set(sx, 8 + rand()*10, cz + (rand()-0.5)*B*0.6);
        sign.rotation.y = sx > cx ? Math.PI/2 : -Math.PI/2;
        cityGroup.add(sign);
        // glow pool on the street below
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(16, 10),
          new THREE.MeshBasicMaterial({ color:new THREE.Color(color), transparent:true, opacity:0.10, depthWrite:false }));
        pool.rotation.x = -Math.PI/2;
        pool.position.set(sx + (sx>cx?4:-4), 0.05, sign.position.z);
        cityGroup.add(pool);
        const pl = new THREE.PointLight(new THREE.Color(color), 8, 30, 2);
        pl.position.set(sx + (sx>cx?3:-3), 7, sign.position.z);
        cityGroup.add(pl);
      }
    }
  }

  // street lamps along roads
  const lampGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
  const lampMat = new THREE.MeshStandardMaterial({ color:0x222a33, roughness:0.6, metalness:0.7 });
  const lampHead = new THREE.SphereGeometry(0.35, 8, 8);
  const lampGlow = new THREE.MeshBasicMaterial({ color:0xffb54d });
  for (let i=-N; i<=N; i++){
    for (let j=-N; j<N; j++){
      if (rand() > 0.22) continue;
      const lx = i*(B+R), lz = j*(B+R) + R/2 + (rand()>0.5? 2 : B+R-2);
      if (Math.abs(lz - riverZ) < 30) continue;
      const pole = new THREE.Mesh(lampGeo, lampMat);
      pole.position.set(lx, 3.5, lz);
      cityGroup.add(pole);
      const head = new THREE.Mesh(lampHead, lampGlow);
      head.position.set(lx, 7.1, lz);
      cityGroup.add(head);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(5, 16), stripMat.clone());
      pool.material.color.set(0x6b4d1e); pool.material.opacity = 0.22;
      pool.rotation.x = -Math.PI/2; pool.position.set(lx, 0.06, lz);
      cityGroup.add(pool);
    }
  }

  buildRiver();
  buildL();
  buildSkyline();
}

/* ---------- the Chicago River ---------- */
const riverZ = 96;
function buildRiver(){
  const riverMat = new THREE.MeshStandardMaterial({
    color:0x06121c, roughness:0.08, metalness:0.9,
    emissive:0x0a2432, emissiveIntensity:0.35,
  });
  const river = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size*2, 44), riverMat);
  river.rotation.x = -Math.PI/2;
  river.position.set(0, 0.02, riverZ);
  cityGroup.add(river);
  riverMesh = river;

  // bridges at each road crossing
  const B = WORLD.block, R = WORLD.road;
  for (let i=-8; i<=8; i++){
    const x = i*(B+R);
    if (Math.abs(x) > WORLD.size) continue;
    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(R-1, 1.2, 60),
      new THREE.MeshStandardMaterial({ color:0x1a222d, roughness:0.5, metalness:0.8 }));
    bridge.position.set(x, 0.8, riverZ);
    bridge.castShadow = true; bridge.receiveShadow = true;
    cityGroup.add(bridge);
    // bridge rails - Chicago bridgehouse teal
    for (const s of [-1,1]){
      const rail = new THREE.Mesh(new THREE.BoxGeometry(R-1, 1.4, 1),
        new THREE.MeshStandardMaterial({ color:0x1f6f6f, roughness:0.4, metalness:0.7, emissive:0x0d3a3a, emissiveIntensity:0.4 }));
      rail.position.set(x, 1.9, riverZ + s*29);
      cityGroup.add(rail);
    }
  }
}
let riverMesh = null;

/* ---------- the L ---------- */
function buildL(){
  const trackMat = new THREE.MeshStandardMaterial({ color:0x232b36, roughness:0.45, metalness:0.85 });
  const pillarMat = new THREE.MeshStandardMaterial({ color:0x181f28, roughness:0.7, metalness:0.6 });
  const loopR = L_RADIUS, y = 12;
  const segs = 64;
  for (let i=0;i<segs;i++){
    const a0 = (i/segs)*Math.PI*2, a1 = ((i+1)/segs)*Math.PI*2;
    const x0 = Math.cos(a0)*loopR, z0 = Math.sin(a0)*loopR;
    const x1 = Math.cos(a1)*loopR, z1 = Math.sin(a1)*loopR;
    const len = Math.hypot(x1-x0, z1-z0);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, len+0.5), trackMat);
    seg.position.set((x0+x1)/2, y, (z0+z1)/2);
    seg.lookAt(x1, y, z1);
    cityGroup.add(seg);
    const seg2 = seg.clone(); seg2.position.y = y; seg2.translateX(2.4);
    cityGroup.add(seg2);
    if (i % 4 === 0){
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, y, 1.4), pillarMat);
      pillar.position.set(x0, y/2, z0);
      cityGroup.add(pillar);
    }
  }
  // train: 5 cars with lit windows
  const carMat = new THREE.MeshStandardMaterial({ color:0x8a929e, roughness:0.35, metalness:0.9 });
  const winMat = new THREE.MeshBasicMaterial({ color:0xffd98a });
  for (let c=0;c<5;c++){
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 10), carMat);
    body.position.y = 1.8;
    car.add(body);
    for (let wnd=0; wnd<4; wnd++){
      const wm = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), winMat);
      wm.position.set(1.31, 2.1, -3.5 + wnd*2.3);
      wm.rotation.y = Math.PI/2;
      car.add(wm);
      const wm2 = wm.clone(); wm2.position.x = -1.31; wm2.rotation.y = -Math.PI/2;
      car.add(wm2);
    }
    const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6),
      new THREE.MeshBasicMaterial({ color:0xffffff }));
    headlight.position.set(0, 1.6, 5.1);
    car.add(headlight);
    car.userData.offset = c * 11.2;
    cityGroup.add(car);
    trains.push(car);
  }
  trainState = { loopR, y: y+1.9, a: 0, speed: 0.045, lastRumble: 0 };
}
let trainState = null;

function updateTrain(dt){
  if (!trainState) return;
  trainState.a += trainState.speed * dt;
  for (const car of trains){
    const a = trainState.a - car.userData.offset / trainState.loopR;
    const x = Math.cos(a)*trainState.loopR, z = Math.sin(a)*trainState.loopR;
    car.position.set(x, trainState.y, z);
    const nx = Math.cos(a+0.01)*trainState.loopR, nz = Math.sin(a+0.01)*trainState.loopR;
    car.lookAt(nx, trainState.y, nz);
  }
  // rumble when near player
  const dx = trains[0].position.x - player.pos.x, dz = trains[0].position.z - player.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 40 && clock.elapsedTime - trainState.lastRumble > 3){
    trainState.lastRumble = clock.elapsedTime;
    AudioSys.trainRumble();
  }
}

/* ---------- flying traffic ---------- */
const flyers = [];
function buildTraffic(){
  const bodyMat = new THREE.MeshStandardMaterial({ color:0x151b24, roughness:0.4, metalness:0.85 });
  const lanes = [
    { y: 42, z: -140, dir: 1,  speed: 26 },
    { y: 55, z: -60,  dir: -1, speed: 34 },
    { y: 48, z: 40,   dir: 1,  speed: 30 },
    { y: 66, z: 150,  dir: -1, speed: 38 },
    { y: 78, z: -220, dir: 1,  speed: 44 },
  ];
  for (const lane of lanes){
    for (let i=0;i<4;i++){
      const car = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.9, 1.9), bodyMat);
      car.add(hull);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 1.5),
        new THREE.MeshStandardMaterial({ color:0x0d1118, roughness:0.15, metalness:0.9, emissive:0x3ee6ff, emissiveIntensity:0.25 }));
      cabin.position.y = 0.6;
      car.add(cabin);
      const head = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28),
        new THREE.MeshBasicMaterial({ color:0xfff2cc }));
      head.position.set(2.31*lane.dir, 0, 0);
      head.rotation.y = lane.dir > 0 ? Math.PI/2 : -Math.PI/2;
      car.add(head);
      const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22),
        new THREE.MeshBasicMaterial({ color:0xff2244 }));
      tail.position.set(-2.31*lane.dir, 0, 0);
      tail.rotation.y = lane.dir > 0 ? -Math.PI/2 : Math.PI/2;
      car.add(tail);
      const under = new THREE.PointLight(0x3ee6ff, 2, 12, 2);
      under.position.y = -0.6;
      car.add(under);
      car.position.set((rand()-0.5)*WORLD.size*1.6, lane.y + (rand()-0.5)*4, lane.z + (rand()-0.5)*8);
      car.rotation.y = lane.dir > 0 ? 0 : Math.PI;
      scene.add(car);
      flyers.push({ car, lane });
    }
  }
}
function updateTraffic(dt){
  const lim = WORLD.size * 0.9;
  for (const f of flyers){
    f.car.position.x += f.lane.dir * f.lane.speed * dt;
    if (f.car.position.x > lim) f.car.position.x = -lim;
    if (f.car.position.x < -lim) f.car.position.x = lim;
    f.car.position.y = f.lane.y + Math.sin(clock.elapsedTime*0.7 + f.car.position.z)*0.8;
    f.car.rotation.z = Math.sin(clock.elapsedTime*0.5 + f.car.position.z*0.1)*0.04;
  }
}

/* ---------- skyline silhouette ---------- */
const blinkers = [];
function buildSkyline(){
  const mat = new THREE.MeshBasicMaterial({ color:0x0d1320, fog:false });
  const g = new THREE.Group();
  // Willis Tower with twin antennas - unmistakable Chicago
  const willis = new THREE.Mesh(new THREE.BoxGeometry(30, 190, 30), mat);
  willis.position.set(-380, 95, -420);
  g.add(willis);
  for (const s of [-8, 8]){
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.4, 40, 6), mat);
    ant.position.set(-380+s, 210, -420);
    g.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 6),
      new THREE.MeshBasicMaterial({ color:0xff2244, fog:false }));
    tip.position.set(-380+s, 231, -420);
    tip.userData.blink = Math.random()*2;
    g.add(tip); blinkers.push(tip);
  }
  // Hancock (tapered) + Aon + St Regis-ish
  const hancock = new THREE.Mesh(new THREE.CylinderGeometry(9, 16, 160, 4), mat);
  hancock.position.set(-160, 80, -480); hancock.rotation.y = Math.PI/4;
  g.add(hancock);
  const aon = new THREE.Mesh(new THREE.BoxGeometry(22, 150, 22), mat);
  aon.position.set(60, 75, -460);
  g.add(aon);
  const vista = new THREE.Mesh(new THREE.CylinderGeometry(10, 12, 130, 8), mat);
  vista.position.set(210, 65, -430);
  g.add(vista);
  for (let i=0;i<14;i++){
    const b = new THREE.Mesh(new THREE.BoxGeometry(14+Math.random()*16, 40+Math.random()*70, 14), mat);
    b.position.set(-480 + i*72 + Math.random()*20, 30, -440 - Math.random()*60);
    b.position.y = b.geometry.parameters.height/2;
    g.add(b);
  }
  scene.add(g);
}

/* ---------- collision / occlusion helpers ---------- */
function pointInCollider(x, z, margin){
  for (const c of colliders){
    if (x > c.minX-margin && x < c.maxX+margin && z > c.minZ-margin && z < c.maxZ+margin) return c;
  }
  return null;
}
function collideCircle(pos, rad, y){
  // push a circle out of building footprints; only when below roofline
  for (const c of colliders){
    if (y > (c.maxY || 0)) continue;
    const px = pos.x, pz = pos.z;
    if (px > c.minX-rad && px < c.maxX+rad && pz > c.minZ-rad && pz < c.maxZ+rad){
      const dxl = px-(c.minX-rad), dxr = (c.maxX+rad)-px;
      const dzl = pz-(c.minZ-rad), dzr = (c.maxZ+rad)-pz;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m===dxl) pos.x = c.minX-rad;
      else if (m===dxr) pos.x = c.maxX+rad;
      else if (m===dzl) pos.z = c.minZ-rad;
      else pos.z = c.maxZ+rad;
    }
  }
}
function segmentBlocked(a, b){
  // 3D slab test against building volumes (x/z footprint, y 0..maxY)
  const dx = b.x-a.x, dy = b.y-a.y, dz = b.z-a.z;
  for (const c of colliders){
    const maxY = c.maxY || 0;
    let t0 = 0, t1 = 1, ok = true;
    const axes = [[a.x, dx, c.minX, c.maxX], [a.y, dy, 0, maxY], [a.z, dz, c.minZ, c.maxZ]];
    for (const [o, d, mn, mx] of axes){
      if (Math.abs(d) < 1e-9){ if (o < mn || o > mx){ ok = false; break; } }
      else {
        let ta = (mn - o)/d, tb = (mx - o)/d;
        if (ta > tb){ const tmp = ta; ta = tb; tb = tmp; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1){ ok = false; break; }
      }
    }
    if (ok && t0 < t1 && t1 > 0 && t0 < 1) return true;
  }
  return false;
}

/* ============================== player ============================== */
const player = {
  pos: new THREE.Vector3(0, 0, 20),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: -0.08,
  hp: 100, maxHp: 100, sh: 50, maxSh: 50, shRegenT: 0,
  heat: 0, grounded: true, dead: false,
  group: null, muzzle: null,
};
function buildPlayer(){
  const g = new THREE.Group();
  const coatMat = new THREE.MeshStandardMaterial({ color:0x141821, roughness:0.75, metalness:0.15 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 6, 12), coatMat);
  body.position.y = 1.05; body.castShadow = true;
  g.add(body);
  // collar + visor - the silhouette reads "runner"
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.44, 0.25, 10), coatMat);
  collar.position.y = 1.75; g.add(collar);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10, 0, Math.PI*2, 0, Math.PI/2),
    new THREE.MeshBasicMaterial({ color:0x3ee6ff }));
  visor.position.set(0, 1.92, 0.06); visor.rotation.x = 0.5;
  g.add(visor);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.02, 6, 20),
    new THREE.MeshBasicMaterial({ color:0xff3e8d }));
  trim.position.y = 1.28; trim.rotation.x = Math.PI/2;
  g.add(trim);
  // gun in right hand
  const gun = new THREE.Group();
  const gm = new THREE.MeshStandardMaterial({ color:0x2a313c, roughness:0.35, metalness:0.9 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.5), gm);
  gun.add(slide);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.12), gm);
  grip.position.set(0, -0.14, 0.14); grip.rotation.x = 0.25;
  gun.add(grip);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.05),
    new THREE.MeshBasicMaterial({ color:0x3ee6ff }));
  sight.position.set(0, 0.08, -0.1);
  gun.add(sight);
  gun.position.set(0.45, 1.35, 0.3);
  g.add(gun);
  player.muzzle = new THREE.Object3D();
  player.muzzle.position.set(0, 0.02, -0.3);
  gun.add(player.muzzle);
  player.gun = gun;
  g.position.copy(player.pos);
  g.visible = false;   // first-person build - body stays for logic, not render
  scene.add(g);
  player.group = g;
  player.bodyMesh = body;
  buildViewmodel();
}

/* ---------- first-person weapon viewmodel ---------- */
const vm = { group:null, gun:null, flash:null, flashT:0, recoil:0, swayX:0, swayY:0 };
function buildViewmodel(){
  const g = new THREE.Group();
  const gm = new THREE.MeshStandardMaterial({ color:0x232a35, roughness:0.32, metalness:0.92 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.34), gm);
  g.add(slide);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.2), gm);
  frame.position.set(0, -0.055, 0.06);
  g.add(frame);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.14, 0.07), gm);
  grip.position.set(0, -0.13, 0.09); grip.rotation.x = 0.22;
  g.add(grip);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.03),
    new THREE.MeshBasicMaterial({ color:0x3ee6ff }));
  sight.position.set(0, 0.052, -0.05);
  g.add(sight);
  // side glow strip - the "runner grade" trim
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.012, 0.2),
    new THREE.MeshBasicMaterial({ color:0xff3e8d }));
  strip.position.y = -0.02;
  g.add(strip);
  const flash = new THREE.PointLight(0x9ff3ff, 0, 8, 2);
  flash.position.set(0, 0, -0.3);
  g.add(flash);
  vm.flash = flash;
  g.position.set(0.26, -0.22, -0.45);
  g.rotation.y = 0.04;
  camera.add(g);
  scene.add(camera);   // camera must be in the scene graph for attached children
  vm.group = g;
  vm.gun = g;
  // world muzzle tracker for tracers
  player.muzzle = new THREE.Object3D();
  player.muzzle.position.set(0, 0.02, -0.24);
  g.add(player.muzzle);
}

function updateViewmodel(dt){
  if (!vm.group) return;
  vm.recoil = Math.max(0, vm.recoil - dt*6);
  vm.flashT = Math.max(0, vm.flashT - dt*14);
  vm.flash.intensity = vm.flashT * 22;
  const walkAmt = Math.hypot(player.vel.x, player.vel.z);
  const bob = walkAmt > 0.5 && player.grounded ? Math.sin(clock.elapsedTime*9.5) * 0.008 * Math.min(walkAmt/6, 1.6) : 0;
  const bobX = walkAmt > 0.5 && player.grounded ? Math.cos(clock.elapsedTime*4.75) * 0.006 * Math.min(walkAmt/6, 1.6) : 0;
  vm.group.position.set(
    0.26 + bobX + vm.swayX,
    -0.22 + bob + vm.swayY,
    -0.45 + vm.recoil*0.06
  );
  vm.group.rotation.x = vm.recoil * 0.16;
  vm.swayX *= Math.pow(0.001, dt);
  vm.swayY *= Math.pow(0.001, dt);
}

/* ---------- input ---------- */
const keys = {};
let mouseDown = false, pointerLocked = false;
addEventListener('keydown', e => { keys[e.code] = true; if (e.code==='Escape' && gameState==='play') pauseGame(); });
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('mousedown', e => {
  if (dialog.active){ advanceDialog(); return; }
  if (gameState !== 'play') return;
  if (!pointerLocked){ renderer.domElement.requestPointerLock(); return; }
  if (e.button === 0) mouseDown = true;
});
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
addEventListener('mousemove', e => {
  if (!pointerLocked || gameState !== 'play') return;
  const s = 0.0022 * S.sens;
  player.yaw -= e.movementX * s;
  player.pitch -= e.movementY * s * (S.invertY ? -1 : 1);
  player.pitch = Math.max(-1.2, Math.min(0.9, player.pitch));
  vm.swayX = Math.max(-0.03, Math.min(0.03, vm.swayX - e.movementX * 0.00004));
  vm.swayY = Math.max(-0.03, Math.min(0.03, vm.swayY + e.movementY * 0.00004));
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  el.hint.classList.toggle('hidden', pointerLocked || gameState !== 'play');
});

/* ---------- movement + camera ---------- */
const camTarget = new THREE.Vector3();
function updatePlayer(dt){
  if (player.dead) return;
  const speed = keys['ShiftLeft'] || keys['ShiftRight'] ? 11.5 : 6.2;
  const f = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const r = new THREE.Vector3(-f.z, 0, f.x);
  const move = new THREE.Vector3();
  if (keys['KeyW']) move.add(f);
  if (keys['KeyS']) move.sub(f);
  if (keys['KeyD']) move.add(r);
  if (keys['KeyA']) move.sub(r);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
  player.vel.x = move.x; player.vel.z = move.z;
  player.vel.y -= 26 * dt;
  if (player.grounded && keys['Space']){
    player.vel.y = 9; player.grounded = false; AudioSys.jumpSfx();
  }
  player.pos.addScaledVector(player.vel, dt);
  if (player.pos.y <= 0){ player.pos.y = 0; player.vel.y = 0; player.grounded = true; }

  // building collision (2D circle vs AABB)
  collideCircle(player.pos, 0.55, player.pos.y + 1);
  // keep off the river
  if (Math.abs(player.pos.z - riverZ) < 21 && Math.abs(player.pos.x) < WORLD.size){
    // bridges are walkable near road x
    const B = WORLD.block, R = WORLD.road, span = B + R;
    const onBridge = Math.abs(player.pos.x - span*Math.round(player.pos.x/span)) < (R-1)/2;
    if (!onBridge){
      player.pos.z = player.pos.z > riverZ ? riverZ + 21 : riverZ - 21;
    }
  }
  const lim = WORLD.size - 10;
  player.pos.x = Math.max(-lim, Math.min(lim, player.pos.x));
  player.pos.z = Math.max(-lim, Math.min(lim, player.pos.z));

  // shield regen
  player.shRegenT += dt;
  if (player.shRegenT > 3 && player.sh < player.maxSh){
    player.sh = Math.min(player.maxSh, player.sh + 14*dt);
  }
  player.heat = Math.max(0, player.heat - 0.55*dt);

  // logic body follows (invisible in first person)
  player.group.position.copy(player.pos);
  player.group.rotation.y = player.yaw;

  // first-person camera: eye height, direct look, head-bob on the walk
  const walkAmt = Math.hypot(player.vel.x, player.vel.z);
  const bobY = walkAmt > 0.5 && player.grounded ? Math.abs(Math.sin(clock.elapsedTime*9.5)) * 0.05 * Math.min(walkAmt/6, 1.5) : 0;
  camera.position.set(player.pos.x, player.pos.y + 1.62 + bobY, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  updateViewmodel(dt);
}

function damagePlayer(n){
  if (player.dead) return;
  player.shRegenT = 0;
  if (player.sh > 0){
    const absorbed = Math.min(player.sh, n);
    player.sh -= absorbed; n -= absorbed;
  }
  player.hp -= n;
  AudioSys.hurt();
  el.vig.style.opacity = 0.9;
  setTimeout(() => el.vig.style.opacity = 0, 160);
  if (player.hp <= 0){
    player.hp = 0; player.dead = true;
    gameState = 'dead';
    showCard('FLATLINED', 'Chicago keeps what it kills.\nThe shift restarts from the last checkpoint.', [
      ['Retry checkpoint', () => respawn()],
    ]);
  }
}
function respawn(){
  player.hp = player.maxHp; player.sh = player.maxSh; player.dead = false; player.heat = 0;
  player.pos.copy(checkpoint); player.vel.set(0,0,0);
  clearDrones(); clearHounds(); stopWaves();
  if (mission.stage === 2){
    startDefense(8, 'UPLOAD RUNNING - BURN THE DRONES', waveMixDrones);
  } else if (mission.stage === 8){
    startDefense(10, 'HOLD THE STREET', waveMixAssault);
  } else if (mission.stage === 3){
    setObjective('UPLOAD COMPLETE - REACH THE BRIDGE EXTRACTION', mission.extraction);
    spawnDroneRing(2, 55);
  } else if (mission.stage === 5){
    setObjective('MEET THE FIXER ON THE MAG MILE', mission.fixer);
  } else if (mission.stage === 6){
    setObjectiveSilent('RECOVER THE SHARDS - ' + mission.shardsGot + '/3');
  } else if (mission.stage === 7){
    setObjective('RETURN TO VERA', mission.fixer);
  } else if (mission.stage === 9){
    setObjective('CLEAN SWEEP - REACH THE BRIDGE EXTRACTION', mission.extraction);
    spawnDroneRing(2, 55);
  } else if (mission.stage === 11){
    setObjective('CROSS THE RIVER - MEET KIKO ON THE NORTH WALK', mission.kiko);
  } else if (mission.stage === 12){
    setObjective('RECOVER THE VAULT CACHE UNDER THE SOUTH L', mission.vault);
  } else if (mission.stage === 13){
    startDefense(12, 'CRACK THE VAULT - HOLD THEM OFF', waveMixAssault);
  } else if (mission.stage === 14){
    setObjective('VAULT CRACKED - REACH THE BRIDGE', mission.extraction);
    spawnDroneRing(2, 55);
  }
  hideCard();
}
let checkpoint = new THREE.Vector3(0, 0, 20);

/* ============================== drones ============================== */
const drones = [];
function spawnDrone(x, y, z){
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 12),
    new THREE.MeshStandardMaterial({ color:0x1c222c, roughness:0.3, metalness:0.9 }));
  g.add(core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.08, 8, 24),
    new THREE.MeshStandardMaterial({ color:0x2a313c, roughness:0.4, metalness:0.9, emissive:0xff2244, emissiveIntensity:0.9 }));
  ring.rotation.x = Math.PI/2;
  g.add(ring);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8),
    new THREE.MeshBasicMaterial({ color:0xff2244 }));
  eye.position.set(0, 0, 0.5);
  g.add(eye);
  const light = new THREE.PointLight(0xff2244, 4, 14, 2);
  g.add(light);
  g.position.set(x, y, z);
  scene.add(g);
  drones.push({
    g, hp: 30, aggro: false, shotT: Math.random()*2, bobPhase: Math.random()*6,
    ring, eye,
  });
}
function clearDrones(){
  for (const d of drones) scene.remove(d.g);
  drones.length = 0;
  AudioSys.combatTarget = 0;
}
function updateDrones(dt){
  let anyAggro = false;
  for (let i=drones.length-1; i>=0; i--){
    const d = drones[i];
    d.bobPhase += dt*2.2;
    d.g.position.y += Math.sin(d.bobPhase)*0.008;
    d.ring.rotation.z += dt*3;
    const toPlayer = new THREE.Vector3().subVectors(player.pos, d.g.position);
    toPlayer.y += 1.2;
    const dist = toPlayer.length();
    if (dist < 42) d.aggro = true;
    if (d.aggro && !player.dead){
      anyAggro = true;
      d.eye.material.color.setHex(0xff5e3e);
      // strafe toward ~12m standoff
      const dir = toPlayer.clone().normalize();
      const want = dist > 13 ? 5.5 : dist < 8 ? -3.5 : 0;
      d.g.position.addScaledVector(dir, want*dt);
      d.g.position.x += Math.sin(d.bobPhase*0.7)*2*dt;
      d.g.position.z += Math.cos(d.bobPhase*0.6)*2*dt;
      if (d.g.position.y < 3) d.g.position.y = 3;
      if (d.g.position.y > 20) d.g.position.y = 20;
      collideCircle(d.g.position, 0.9, d.g.position.y);
      d.g.lookAt(player.pos.x, player.pos.y+1.4, player.pos.z);
      d.shotT -= dt;
      if (d.shotT <= 0 && dist < 38){
        d.shotT = 1.4 + Math.random()*0.9;
        const aimAt = new THREE.Vector3(player.pos.x, player.pos.y + 1.3, player.pos.z);
        if (!segmentBlocked(d.g.position, aimAt)) fireBolt(d.g.position.clone(), toPlayer.normalize());
      }
    } else {
      // patrol drift
      d.g.position.x += Math.sin(d.bobPhase*0.3)*0.6*dt;
      d.g.position.z += Math.cos(d.bobPhase*0.25)*0.6*dt;
      d.g.rotation.y += dt*0.4;
    }
  }
  AudioSys.combatTarget = anyAggro ? 1 : 0;
}

/* ---------- hounds: ground-rush melee bots ---------- */
const hounds = [];
function spawnHound(x, z){
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color:0x1a2029, roughness:0.35, metalness:0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 0.6), bodyMat);
  body.position.y = 0.75;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 0.45), bodyMat);
  head.position.set(0.85, 0.85, 0);
  g.add(head);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6),
    new THREE.MeshBasicMaterial({ color:0xffb54d }));
  eye.position.set(1.08, 0.88, 0);
  g.add(eye);
  const legs = [];
  for (const [lx, lz] of [[-0.5,-0.3],[-0.5,0.3],[0.5,-0.3],[0.5,0.3]]){
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.8, 5), bodyMat);
    leg.position.set(lx, 0.4, lz);
    g.add(leg);
    legs.push(leg);
  }
  const glow = new THREE.PointLight(0xffb54d, 3, 8, 2);
  glow.position.y = 0.8;
  g.add(glow);
  g.position.set(x, 0, z);
  scene.add(g);
  hounds.push({ g, legs, hp: 24, phase: Math.random()*6, hitCd: 0, eye });
}
function clearHounds(){
  for (const h of hounds) scene.remove(h.g);
  hounds.length = 0;
}
function updateHounds(dt){
  for (let i=hounds.length-1; i>=0; i--){
    const h = hounds[i];
    if (player.dead) break;
    h.phase += dt*11;
    h.hitCd -= dt;
    const toP = new THREE.Vector3().subVectors(player.pos, h.g.position);
    toP.y = 0;
    const dist = toP.length();
    if (dist > 1.4){
      toP.normalize();
      h.g.position.addScaledVector(toP, 5.2*dt);
      h.g.rotation.y = Math.atan2(toP.x, toP.z) - Math.PI/2;
    } else if (h.hitCd <= 0){
      h.hitCd = 0.9;
      damagePlayer(12);
      spawnSparks(new THREE.Vector3(player.pos.x, player.pos.y+1, player.pos.z), 0xffb54d, 6);
    }
    collideCircle(h.g.position, 0.7, 0.8);
    for (let l=0; l<4; l++){
      h.legs[l].rotation.x = Math.sin(h.phase + (l%2)*Math.PI) * 0.55;
    }
    h.g.position.y = Math.abs(Math.sin(h.phase*0.5))*0.08;
  }
}
function damageHound(h, dmg){
  h.hp -= dmg;
  spawnSparks(h.g.position.clone().setY(0.9), 0xffb54d, 8);
  AudioSys.hitConfirm();
  if (h.hp <= 0){
    spawnSparks(h.g.position.clone().setY(0.8), 0xff5e3e, 22);
    AudioSys.explosion();
    scene.remove(h.g);
    hounds.splice(hounds.indexOf(h), 1);
    missionHoundKill();
  }
}

/* ---------- projectiles / tracers / sparks ---------- */
const bolts = [], tracers = [], sparks = [];
const boltMat = new THREE.MeshBasicMaterial({ color:0xff5e3e });
const boltGeo = new THREE.SphereGeometry(0.12, 6, 6);
function fireBolt(from, dir){
  const m = new THREE.Mesh(boltGeo, boltMat);
  m.position.copy(from);
  scene.add(m);
  bolts.push({ m, vel: dir.clone().multiplyScalar(26), life: 3 });
  AudioSys.note ? AudioSys.note(220, AudioSys.ctx.currentTime, 0.08, 'square', 0.06, AudioSys.sfxGain, 90) : 0;
}
const playerChest = new THREE.Vector3();
function updateBolts(dt){
  playerChest.set(player.pos.x, player.pos.y + 1.3, player.pos.z);
  for (let i=bolts.length-1; i>=0; i--){
    const b = bolts[i];
    b.life -= dt;
    // substep so fast bolts can't tunnel through the player or walls
    const step = b.vel.clone().multiplyScalar(dt);
    const n = Math.max(1, Math.ceil(step.length() / 0.45));
    let dead = false;
    for (let k=0; k<n; k++){
      const prev = b.m.position.clone();
      b.m.position.addScaledVector(step, 1/n);
      if (b.m.position.distanceToSquared(playerChest) < 0.8){
        damagePlayer(9); dead = true; break;
      }
      if (segmentBlocked(prev, b.m.position)){
        spawnSparks(prev, 0xff5e3e, 4); dead = true; break;
      }
    }
    if (!dead && (b.life <= 0 || b.m.position.y < 0)) dead = true;
    if (dead){ scene.remove(b.m); bolts.splice(i,1); }
  }
}
const tracerMat = new THREE.LineBasicMaterial({ color:0x9ff3ff, transparent:true, opacity:0.9 });
function spawnTracer(from, to){
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, tracerMat.clone());
  scene.add(line);
  tracers.push({ line, life: 0.09 });
}
function updateTracers(dt){
  for (let i=tracers.length-1; i>=0; i--){
    tracers[i].life -= dt;
    if (tracers[i].life <= 0){
      scene.remove(tracers[i].line); tracers.splice(i,1);
    }
  }
}
function spawnSparks(pos, color, n){
  for (let i=0;i<(n||14);i++){
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 4),
      new THREE.MeshBasicMaterial({ color }));
    s.position.copy(pos);
    scene.add(s);
    sparks.push({
      m: s,
      vel: new THREE.Vector3((Math.random()-0.5)*9, Math.random()*7, (Math.random()-0.5)*9),
      life: 0.5 + Math.random()*0.4,
    });
  }
}
function updateSparks(dt){
  for (let i=sparks.length-1; i>=0; i--){
    const s = sparks[i];
    s.vel.y -= 18*dt;
    s.m.position.addScaledVector(s.vel, dt);
    s.life -= dt;
    if (s.life <= 0){ scene.remove(s.m); sparks.splice(i,1); }
  }
}

/* ---------- shooting ---------- */
let shotCd = 0;
function tryShoot(dt){
  shotCd -= dt;
  if (!mouseDown || player.dead || shotCd > 0) return;
  if (player.heat >= 1){ return; }
  shotCd = 0.14;
  player.heat = Math.min(1, player.heat + 0.09);
  vm.recoil = Math.min(1, vm.recoil + 0.4);
  vm.flashT = 1;
  AudioSys.shoot();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const from = new THREE.Vector3();
  player.muzzle.getWorldPosition(from);
  // aim + occlusion from the player's eye, not the chase camera - the camera can
  // sit inside a wall behind you in corner fights and eat dead-on shots
  const eye = new THREE.Vector3(player.pos.x, player.pos.y + 1.6, player.pos.z);
  const ray = new THREE.Raycaster(eye, dir, 0.1, 200);
  let best = null, bestD = 1e9, bestKind = null;
  for (const d of drones){
    const hit = ray.ray.distanceToPoint(new THREE.Vector3(d.g.position.x, d.g.position.y, d.g.position.z));
    const along = d.g.position.clone().sub(eye).dot(dir);
    if (hit < 1.1 && along > 0 && along < bestD){ best = d; bestD = along; bestKind = 'drone'; }
  }
  for (const h of hounds){
    const hc = new THREE.Vector3(h.g.position.x, h.g.position.y + 0.75, h.g.position.z);
    const hit = ray.ray.distanceToPoint(hc);
    const along = hc.clone().sub(eye).dot(dir);
    if (hit < 0.9 && along > 0 && along < bestD){ best = h; bestD = along; bestKind = 'hound'; }
  }
  if (best && segmentBlocked(eye, best.g.position)) best = null;   // no shooting through towers
  const end = best
    ? best.g.position.clone()
    : eye.clone().addScaledVector(dir, 120);
  spawnTracer(from, end);
  if (best && bestKind === 'hound'){
    damageHound(best, 12);
  } else if (best){
    best.hp -= 12;
    AudioSys.hitConfirm();
    spawnSparks(best.g.position, 0x9ff3ff, 8);
    if (best.hp <= 0){
      spawnSparks(best.g.position, 0xff5e3e, 26);
      AudioSys.explosion();
      scene.remove(best.g);
      drones.splice(drones.indexOf(best), 1);
      missionDroneKill();
    }
  }
}

/* ============================== pedestrians ============================== */
const peds = [];
function buildPeds(){
  const coatColors = [0x1a2029, 0x241a20, 0x1a2420, 0x20242c];
  for (let i=0;i<14;i++){
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.85, 4, 8),
      new THREE.MeshStandardMaterial({ color: coatColors[i%4], roughness:0.8 }));
    body.position.y = 1.0;
    g.add(body);
    const umbrella = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x10141c, roughness:0.5 }));
    umbrella.position.y = 2.3;
    g.add(umbrella);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x333a44 }));
    stick.position.y = 1.9;
    g.add(stick);
    let px = 0, pz = 0, tries = 0;
    do {
      const a = rand()*Math.PI*2, r = 40 + rand()*180;
      px = Math.cos(a)*r; pz = Math.sin(a)*r;
      tries++;
    } while (tries < 12 && (pointInCollider(px, pz, 1.5) || Math.abs(pz - riverZ) < 24));
    g.position.set(px, 0, pz);
    scene.add(g);
    peds.push({
      g, body,
      dir: new THREE.Vector3(rand()-0.5, 0, rand()-0.5).normalize(),
      speed: 1.1 + rand()*0.9,
      turnT: rand()*6,
      phase: rand()*6,
    });
  }
}
function updatePeds(dt){
  for (const p of peds){
    p.turnT -= dt;
    if (p.turnT <= 0){
      p.turnT = 4 + Math.random()*6;
      p.dir.set(Math.random()-0.5, 0, Math.random()-0.5).normalize();
    }
    p.phase += dt*7;
    p.g.position.addScaledVector(p.dir, p.speed*dt);
    p.g.position.y = Math.abs(Math.sin(p.phase))*0.06;
    p.g.rotation.y = Math.atan2(p.dir.x, p.dir.z);
    const lim = WORLD.size - 30;
    if (Math.abs(p.g.position.x) > lim || Math.abs(p.g.position.z) > lim){
      p.dir.multiplyScalar(-1);
    }
    if (Math.abs(p.g.position.z - riverZ) < 22){ p.dir.z = p.g.position.z > riverZ ? 0.7 : -0.7; }
  }
}

/* ============================== rain ============================== */
let rain = null;
function rebuildRain(){
  if (!scene) return;
  if (rain){ scene.remove(rain); rain.geometry.dispose(); rain.material.dispose(); rain = null; }
  buildRain();
}
function buildRain(){
  if (rain){ scene.remove(rain); rain.geometry.dispose(); rain.material.dispose(); rain = null; }
  const N = S.quality === 'low' ? 900 : S.quality === 'med' ? 2200 : 3200;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N*3);
  for (let i=0;i<N;i++){
    pos[i*3] = (Math.random()-0.5)*160;
    pos[i*3+1] = Math.random()*60;
    pos[i*3+2] = (Math.random()-0.5)*160;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color:0x8fb8d8, size:0.09, transparent:true, opacity:0.55, sizeAttenuation:true });
  rain = new THREE.Points(geo, mat);
  scene.add(rain);
}
function updateRain(dt){
  if (!rain) return;
  const pos = rain.geometry.attributes.position;
  for (let i=0;i<pos.count;i++){
    let y = pos.getY(i) - 42*dt;
    if (y < 0) y = 60;
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  rain.position.set(player.pos.x, 0, player.pos.z);
}

/* ============================== mission ============================== */
const mission = {
  stage: 0, kills: 0, needKills: 8, shardsGot: 0,
  terminal: new THREE.Vector3(TERMINAL_POS.x, 0, TERMINAL_POS.z),
  extraction: new THREE.Vector3(EXTRACTION_POS.x, 0, EXTRACTION_POS.z),   // river bridge
  fixer: new THREE.Vector3(210, 0, 6),
  kiko: new THREE.Vector3(40, 0, 130),          // north riverwalk
  luckyCat: new THREE.Vector3(46, 0, 124),       // Lucky Cat noodle stand, north riverwalk
  luckyT: -999,                                     // last rub time (cooldown)
  luckyCatMesh: null, luckyPaw: null,
  vault: new THREE.Vector3(-60, 0, -195),       // second dead drop, under the L ring south
  shardPos: [new THREE.Vector3(140, 0, -24), new THREE.Vector3(230, 0, 28), new THREE.Vector3(285, 0, -10)],
  target: null, waveSpawner: null,
};
function buildTerminal(){
  const g = new THREE.Group();
  const kiosk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.8),
    new THREE.MeshStandardMaterial({ color:0x1a222d, roughness:0.4, metalness:0.8 }));
  kiosk.position.y = 1.1;
  g.add(kiosk);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6),
    new THREE.MeshBasicMaterial({ color:0x3ee6ff }));
  screen.position.set(0, 1.5, 0.41);
  g.add(screen);
  const light = new THREE.PointLight(0x3ee6ff, 10, 20, 2);
  light.position.y = 2.5;
  g.add(light);
  g.position.copy(mission.terminal);
  scene.add(g);
  mission.terminalMesh = g;
}

/* ---------- the fixer ---------- */
function buildFixer(){
  const g = new THREE.Group();
  const coatMat = new THREE.MeshStandardMaterial({ color:0x241a10, roughness:0.7, metalness:0.2 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.44, 1.0, 6, 12), coatMat);
  body.position.y = 1.05; body.castShadow = true;
  g.add(body);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10, 0, Math.PI*2, 0, Math.PI/2),
    new THREE.MeshBasicMaterial({ color:0xffb54d }));
  visor.position.set(0, 1.92, 0.05); visor.rotation.x = 0.5;
  g.add(visor);
  const halo = new THREE.PointLight(0xffb54d, 6, 12, 2);
  halo.position.y = 2.4;
  g.add(halo);
  g.position.copy(mission.fixer);
  g.rotation.y = Math.PI;   // faces the street
  scene.add(g);
  mission.fixerMesh = g;
}

/* ---------- Kiko (Act III contact) ---------- */
function buildKiko(){
  const g = new THREE.Group();
  const coatMat = new THREE.MeshStandardMaterial({ color:0x101c24, roughness:0.7, metalness:0.2 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.95, 6, 12), coatMat);
  body.position.y = 1.0; body.castShadow = true;
  g.add(body);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10, 0, Math.PI*2, 0, Math.PI/2),
    new THREE.MeshBasicMaterial({ color:0xff3e8d }));
  visor.position.set(0, 1.82, 0.05); visor.rotation.x = 0.5;
  g.add(visor);
  const halo = new THREE.PointLight(0xff3e8d, 6, 12, 2);
  halo.position.y = 2.3;
  g.add(halo);
  g.position.copy(mission.kiko);
  g.rotation.y = -Math.PI/2;   // faces the river path
  scene.add(g);
  mission.kikoMesh = g;
}
/* ---------- the Lucky Cat (easter egg / fortune mechanic) ---------- */
// Standing directive: a Lucky Cat thread in the world. It lives at a noodle
// stand by Kiko on the north riverwalk - a beckoning maneki-neko you can rub
// for a fortune. Luck cuts both ways out here.
const LUCKY_FORTUNES = [
  'The L runs on time for you tonight.',
  'A corp ledger somewhere has your name on page one.',
  'Stay off the bridges at dawn.',
  'Someone on the Mile owes you. Collect.',
  'The river remembers. So should you.',
  'Lucky in chrome, unlucky in love.',
  'A red door, three floors up. Knock twice.',
  'Your next reload is faster than their next shot.',
];
function buildLuckyCat(){
  const g = new THREE.Group();
  // noodle-stand counter
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 1.0),
    new THREE.MeshStandardMaterial({ color:0x141a22, roughness:0.5, metalness:0.7 }));
  counter.position.y = 0.5; counter.castShadow = true;
  g.add(counter);
  // gold lacquer cat
  const gold = new THREE.MeshStandardMaterial({ color:0xd9a520, roughness:0.28, metalness:0.7, emissive:0x6a4a00, emissiveIntensity:0.25 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), gold);
  body.scale.y = 1.15; body.position.y = 1.35; body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), gold);
  head.position.y = 1.74;
  g.add(head);
  for (const s of [-1, 1]){
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.13, 6), gold);
    ear.position.set(s*0.11, 1.93, 0);
    g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6),
      new THREE.MeshBasicMaterial({ color:0x111111 }));
    eye.position.set(s*0.08, 1.77, 0.18);
    g.add(eye);
  }
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 8, 20),
    new THREE.MeshStandardMaterial({ color:0xcc2233, roughness:0.5 }));
  collar.position.y = 1.56; collar.rotation.x = Math.PI/2;
  g.add(collar);
  // planted left paw
  const pawL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), gold);
  pawL.position.set(-0.14, 1.26, 0.2);
  g.add(pawL);
  // raised right paw, pivoted at the shoulder so it can beckon
  const pawPivot = new THREE.Group();
  pawPivot.position.set(0.17, 1.6, 0.05);
  const pawArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.28, 8), gold);
  pawArm.position.y = 0.14;
  pawPivot.add(pawArm);
  const pawTip = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), gold);
  pawTip.position.y = 0.3;
  pawPivot.add(pawTip);
  g.add(pawPivot);
  // warm lantern light + sign
  const glow = new THREE.PointLight(0xffd23e, 5, 10, 2);
  glow.position.y = 2.1;
  g.add(glow);
  const t = neonTexture('LUCKY CAT', '#ffd23e');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6),
    new THREE.MeshBasicMaterial({ map:t, transparent:true, side:THREE.DoubleSide, depthWrite:false }));
  sign.position.y = 2.7;
  g.add(sign);
  for (const s of [-1, 1]){
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6),
      new THREE.MeshStandardMaterial({ color:0x222a34, roughness:0.6, metalness:0.8 }));
    pole.position.set(s*1.0, 1.6, 0);
    g.add(pole);
  }
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(5, 3),
    new THREE.MeshBasicMaterial({ color:0xffd23e, transparent:true, opacity:0.08, depthWrite:false }));
  pool.rotation.x = -Math.PI/2; pool.position.y = 0.05;
  g.add(pool);
  g.position.copy(mission.luckyCat);
  g.rotation.y = Math.PI;   // face the river path like Kiko
  scene.add(g);
  mission.luckyCatMesh = g;
  mission.luckyPaw = pawPivot;
}
function rubLuckyCat(){
  const now = clock.elapsedTime;
  const left = Math.ceil(mission.luckyT + 75 - now);
  if (left > 0){
    hudMsg("The cat's paw keeps waving. Come back in " + left + 's.', 2.5);
    return;
  }
  mission.luckyT = now;
  const fortune = LUCKY_FORTUNES[(Math.random()*LUCKY_FORTUNES.length)|0];
  const roll = Math.random();
  if (roll < 0.08){
    player.hp = player.maxHp; player.sh = player.maxSh;
    hudMsg('JACKPOT. The cat approves - full integrity, full shield. "' + fortune + '"', 4.5);
  } else if (roll < 0.55){
    player.hp = Math.min(player.maxHp, player.hp + 30);
    hudMsg('GOOD FORTUNE. +30 integrity. "' + fortune + '"', 4);
  } else if (roll < 0.90){
    player.sh = Math.min(player.maxSh, player.sh + 20);
    hudMsg('SMALL LUCK. +20 shield. "' + fortune + '"', 4);
  } else {
    spawnDrone(player.pos.x + 14, 8, player.pos.z + 14);
    AudioSys.combatTarget = 1;
    hudMsg("The cat's paw stops mid-wave. Something heard it. \"" + fortune + '"', 4.5);
  }
}

function buildVault(){
  const g = new THREE.Group();
  const kiosk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.8),
    new THREE.MeshStandardMaterial({ color:0x1a222d, roughness:0.4, metalness:0.8 }));
  kiosk.position.y = 1.1;
  g.add(kiosk);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6),
    new THREE.MeshBasicMaterial({ color:0xff3e8d }));
  screen.position.set(0, 1.5, 0.41);
  g.add(screen);
  const light = new THREE.PointLight(0xff3e8d, 10, 20, 2);
  light.position.y = 2.5;
  g.add(light);
  g.position.copy(mission.vault);
  scene.add(g);
  mission.vaultMesh = g;
}

/* ---------- data shards ---------- */
function spawnShards(){
  mission.shards = [];
  for (const p of mission.shardPos){
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.5),
      new THREE.MeshBasicMaterial({ color:0x3ee6ff }));
    m.position.set(p.x, 1.6, p.z);
    const l = new THREE.PointLight(0x3ee6ff, 5, 10, 2);
    l.position.set(p.x, 2, p.z);
    scene.add(m); scene.add(l);
    mission.shards.push({ m, l, got: false, idx: mission.shards.length });
  }
  mission.shardState = [false, false, false];
}
function updateShards(){
  if (!mission.shards) return;
  for (const s of mission.shards){
    if (s.got) continue;
    s.m.rotation.y += 0.04;
    s.m.position.y = 1.6 + Math.sin(clock.elapsedTime*2 + s.m.position.x)*0.2;
  }
}
function nearestShard(){
  if (!mission.shards) return null;
  let best = null, bd = 1e9;
  for (const s of mission.shards){
    if (s.got) continue;
    const d = Math.hypot(s.m.position.x - player.pos.x, s.m.position.z - player.pos.z);
    if (d < bd){ bd = d; best = s; }
  }
  return best ? { obj: best, dist: bd } : null;
}

/* ---------- save / load ---------- */
const SAVE_KEY = 'deadline2099-save';
let restoringSave = false;
function saveGame(){
  if (restoringSave) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      stage: mission.stage,
      checkpoint: [checkpoint.x, checkpoint.z],
      hp: Math.round(player.hp),
      shardsGot: mission.shardsGot || 0,
      shards: mission.shardState || [false, false, false],
    }));
  } catch(e){}
}
function loadGame(){
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch(e){ return null; }
}
function restoreStage(sv){
  // rebuilds world + mission state for a saved stage; always called inside startGame
  mission.shardsGot = sv.shardsGot || 0;
  mission.shardState = [false, false, false];
  const st = sv.stage;
  if (st <= 1){
    mission.stage = 1;
    setObjective('REACH THE DEAD DROP UNDER THE L', mission.terminal);
  } else if (st === 2){
    mission.stage = 2; checkpoint.copy(mission.terminal);
    startDefense(8, 'UPLOAD RUNNING - BURN THE DRONES', waveMixDrones);
  } else if (st === 3){
    mission.stage = 3; checkpoint.copy(mission.terminal);
    setObjective('UPLOAD COMPLETE - REACH THE BRIDGE EXTRACTION', mission.extraction);
  } else if (st <= 5){
    beginActII();
  } else if (st === 6){
    beginActII(); mission.stage = 6;
    spawnShards();
    // re-apply collected shards: exact flags when present, first-N for older saves
    const flags = Array.isArray(sv.shards) ? sv.shards
      : [0, 1, 2].map(i => i < (sv.shardsGot || 0));
    mission.shardsGot = 0;
    mission.shards.forEach((s, i) => {
      if (flags[i]){
        s.got = true;
        scene.remove(s.m); scene.remove(s.l);
        mission.shardState[i] = true;
        mission.shardsGot++;
      }
    });
    setObjective('RECOVER THE SHARDS - ' + mission.shardsGot + '/3', null);
  } else if (st === 7){
    beginActII(); mission.stage = 7;
    setObjective('RETURN TO VERA', mission.fixer);
  } else if (st === 8){
    beginActII(); mission.stage = 8;
    startDefense(10, 'HOLD THE STREET', waveMixAssault);
  } else if (st === 9){
    beginActII(); mission.stage = 9; checkpoint.copy(mission.fixer);
    setObjective('CLEAN SWEEP - REACH THE BRIDGE EXTRACTION', mission.extraction);
  } else if (st <= 11){
    beginActIII();
  } else if (st === 12){
    beginActIII(); mission.stage = 12; buildVault();
    setObjective('RECOVER THE VAULT CACHE UNDER THE SOUTH L', mission.vault);
    checkpoint.copy(mission.kiko);
  } else if (st === 13){
    beginActIII(); mission.stage = 13; buildVault();
    checkpoint.copy(mission.vault);
    startDefense(12, 'CRACK THE VAULT - HOLD THEM OFF', waveMixAssault);
  } else if (st === 14){
    beginActIII(); mission.stage = 14; buildVault();
    checkpoint.copy(mission.vault);
    setObjective('VAULT CRACKED - REACH THE BRIDGE', mission.extraction);
  } else {
    beginActIII(); mission.stage = 15; buildVault();
    mission.target = null;                 // beginActIII aimed at Kiko - clear for free roam
    el.objDist.textContent = '';
    setObjectiveSilent('FREE ROAM - CHICAGO 2099');
  }
  // normalize shard flags for any save past the shard stage (older saves stored a count only)
  if (mission.shardsGot >= 3) mission.shardState = [true, true, true];
  player.hp = sv.hp || 100;
}

/* ---------- objectives ---------- */
function setObjective(text, target){
  el.objText.textContent = text;
  mission.target = target || null;
  AudioSys.objective();
  hudMsg(text, 2.6);
}
function setObjectiveSilent(t){ el.objText.textContent = t; }
function spawnDroneRing(n, radius){
  for (let i=0;i<n;i++){
    const a = Math.random()*Math.PI*2;
    spawnDrone(player.pos.x + Math.cos(a)*radius*0.5, 5+Math.random()*8, player.pos.z + Math.sin(a)*radius*0.5);
  }
}
function spawnHoundRing(n, radius){
  for (let i=0;i<n;i++){
    const a = Math.random()*Math.PI*2;
    spawnHound(player.pos.x + Math.cos(a)*radius*0.5, player.pos.z + Math.sin(a)*radius*0.5);
  }
}

/* ---------- defense waves (Act I + Act II) ---------- */
function stopWaves(){
  if (mission.waveSpawner){ clearInterval(mission.waveSpawner); mission.waveSpawner = null; }
}
function startDefense(needKills, label, mix){
  mission.kills = 0;
  mission.needKills = needKills;
  mission.defendLabel = label;
  mission.mix = mix;
  setObjective(`${label} - 0/${needKills}`, null);
  mix(1);
  stopWaves();
  mission.waveSpawner = setInterval(() => {
    if (gameState !== 'play') return;
    if (mission.stage !== 2 && mission.stage !== 8 && mission.stage !== 13){ stopWaves(); return; }
    if (mission.kills >= needKills){ stopWaves(); return; }
    if (drones.length + hounds.length < 6) mix(0);
  }, 4000);
}
function waveMixDrones(first){
  spawnDroneRing(first ? 4 : 2, 50);
}
function waveMixAssault(first){
  if (first){ spawnDroneRing(2, 45); spawnHoundRing(3, 30); }
  else if (Math.random() > 0.5){ spawnDroneRing(2, 50); } else { spawnHoundRing(2, 32); }
}
function missionKill(){
  mission.kills++;
  if (mission.stage === 2 || mission.stage === 8 || mission.stage === 13){
    setObjectiveSilent(`${mission.defendLabel} - ${mission.kills}/${mission.needKills}`);
    if (mission.kills >= mission.needKills){
      stopWaves();
      if (mission.stage === 2){
        mission.stage = 3;
        checkpoint.copy(mission.terminal);
        setObjective('UPLOAD COMPLETE - REACH THE BRIDGE EXTRACTION', mission.extraction);
        spawnDroneRing(3, 60);
      } else if (mission.stage === 8){
        mission.stage = 9;
        checkpoint.copy(mission.fixer);
        setObjective('CLEAN SWEEP - REACH THE BRIDGE EXTRACTION', mission.extraction);
        spawnDroneRing(2, 55);
      } else {
        mission.stage = 14;
        checkpoint.copy(mission.vault);
        setObjective('VAULT CRACKED - REACH THE BRIDGE', mission.extraction);
        spawnDroneRing(2, 55); spawnHoundRing(2, 35);
      }
      saveGame();
    }
  }
}
function missionDroneKill(){ missionKill(); }
function missionHoundKill(){ missionKill(); }

/* ---------- dialogue ---------- */
const dialog = { active:false, lines:[], idx:0, onDone:null };
function startDialog(speaker, lines, onDone){
  dialog.active = true; dialog.lines = lines; dialog.idx = 0; dialog.onDone = onDone || null;
  $('dialog-speaker').textContent = speaker;
  $('dialog-line').textContent = lines[0];
  $('dialog').classList.remove('hidden');
  gameState = 'dialog';
  document.exitPointerLock && document.exitPointerLock();
  AudioSys.blip();
}
function advanceDialog(){
  if (!dialog.active) return;
  dialog.idx++;
  AudioSys.blip();
  if (dialog.idx >= dialog.lines.length){
    dialog.active = false;
    $('dialog').classList.add('hidden');
    gameState = 'play';
    el.hint.classList.toggle('hidden', pointerLocked);
    const fn = dialog.onDone; dialog.onDone = null;
    if (fn) fn();
  } else {
    $('dialog-line').textContent = dialog.lines[dialog.idx];
  }
}
addEventListener('keydown', e => {
  if (e.code === 'KeyE'){
    if (dialog.active){ advanceDialog(); return; }
    if (gameState !== 'play') return;
    const nearCat = mission.luckyCatMesh &&
      Math.hypot(mission.luckyCat.x - player.pos.x, mission.luckyCat.z - player.pos.z) < 2.8;
    if (nearCat){ rubLuckyCat(); return; }
    const nearFixer = mission.fixerMesh &&
      Math.hypot(mission.fixer.x - player.pos.x, mission.fixer.z - player.pos.z) < 4;
    if (nearFixer && mission.stage === 5){
      startDialog('VERA // FIXER', [
        'You made the drop. Good. The package you burned those drones for was a map - three shards, three dead spots on the Mile.',
        'The corps want them back. The shards are loose in the canyon, glowing like everything else out there.',
        'Bring me all three. I will make the rest of your night worth the ammo.',
      ], () => {
        mission.stage = 6;
        spawnShards();
        setObjective('RECOVER THE SHARDS - 0/3', null);
        checkpoint.copy(mission.fixer);
      });
    } else if (mission.kikoMesh && mission.stage === 11 &&
               Math.hypot(mission.kiko.x - player.pos.x, mission.kiko.z - player.pos.z) < 4){
      startDialog('KIKO // RUNNER', [
        'Vera vouched for you. That is the only reason we are talking this close to the water.',
        'Her shards decrypted overnight. They point to a vault cache under the south L - city money, corp secrets, the works. It was supposed to be a myth.',
        'Problem: the cache has a dead-man alarm and it is already counting. You crack it, the whole grid knows your name for about four minutes.',
        'I will be on the bridge. Get the cache, get to me, and maybe the river runs backward for once.',
      ], () => {
        mission.stage = 12;
        buildVault();
        setObjective('RECOVER THE VAULT CACHE UNDER THE SOUTH L', mission.vault);
        checkpoint.copy(mission.kiko);
        saveGame();
      });
    } else if (nearFixer && mission.stage === 7){
      startDialog('VERA // FIXER', [
        'All three. You are either very good or very lucky, and I do not believe in luck.',
        'One problem: picking them up tripped every alarm on the Mile. They are sending the hounds this time. Ground units. Fast.',
        'Hold the street until my uplink finishes. Then run for the bridge and do not stop.',
      ], () => {
        mission.stage = 8;
        startDefense(10, 'HOLD THE STREET', waveMixAssault);
      });
    }
  }
});

/* ---------- mission flow ---------- */
function beginActII(){
  mission.stage = 5;
  checkpoint.copy(mission.extraction);
  buildFixer();
  setObjective('MEET THE FIXER ON THE MAG MILE', mission.fixer);
  hudMsg('ACT II - THE MAG MILE AT NIGHT', 3.5);
  saveGame();
}
function beginActIII(){
  mission.stage = 11;
  checkpoint.copy(mission.extraction);
  if (!mission.fixerMesh) buildFixer();
  buildKiko();
  setObjective('CROSS THE RIVER - MEET KIKO ON THE NORTH WALK', mission.kiko);
  hudMsg('ACT III - THE RIVER RUNS BACKWARD', 3.5);
  saveGame();
}
function updateMission(dt){
  if (player.dead) return;
  const target = mission.target;
  if (target){
    const d = Math.hypot(target.x-player.pos.x, target.z-player.pos.z);
    el.objDist.textContent = Math.round(d) + 'M';
    if (mission.stage === 1 && d < 4){
      mission.stage = 2;
      checkpoint.copy(mission.terminal);
      startDefense(8, 'UPLOAD RUNNING - BURN THE DRONES', waveMixDrones);
      saveGame();
    }
    if (mission.stage === 3 && d < 5){
      mission.stage = 4;
      clearDrones(); clearHounds();
      gameState = 'card';
      showCard('ACT I COMPLETE', 'THE PACKAGE IS OUT.\n\nDrones burned: ' + mission.kills + '\nIntegrity remaining: ' + Math.round(player.hp) + '%\n\nBut the Mile is lit, and a fixer named Vera wants a word.', [
        ['Continue to Act II', () => { hideCard(); beginActII(); }],
      ]);
    }
    if (mission.stage === 5){
      if (d < 4) setObjectiveSilent('PRESS E - TALK TO VERA');
      else if (el.objText.textContent === 'PRESS E - TALK TO VERA') setObjectiveSilent('MEET THE FIXER ON THE MAG MILE');
    }
    if (mission.stage === 7){
      if (d < 4) setObjectiveSilent('PRESS E - TALK TO VERA');
      else if (el.objText.textContent === 'PRESS E - TALK TO VERA') setObjectiveSilent('RETURN TO VERA');
    }
    if (mission.stage === 9 && d < 5){
      mission.stage = 10;
      clearDrones(); clearHounds(); stopWaves();
      gameState = 'card';
      saveGame();
      showCard('END OF ACT II', 'THE SHARDS ARE VERA\'S PROBLEM NOW.\n\nStreet held: ' + mission.kills + ' hostiles down\nIntegrity remaining: ' + Math.round(player.hp) + '%\n\nHer last message pointed north. Across the river.', [
        ['Continue to Act III', () => { hideCard(); beginActIII(); }],
      ]);
    }
    if (mission.stage === 11 && d < 4){
      setObjectiveSilent('PRESS E - TALK TO KIKO');
    } else if (mission.stage === 11 && el.objText.textContent === 'PRESS E - TALK TO KIKO'){
      setObjectiveSilent('CROSS THE RIVER - MEET KIKO ON THE NORTH WALK');
    }
    if (mission.stage === 12 && d < 4){
      mission.stage = 13;
      checkpoint.copy(mission.vault);
      startDefense(12, 'CRACK THE VAULT - HOLD THEM OFF', waveMixAssault);
      saveGame();
    }
    if (mission.stage === 14 && d < 5){
      mission.stage = 15;
      clearDrones(); clearHounds(); stopWaves();
      gameState = 'card';
      saveGame();
      showCard('END OF ACT III', 'THE CACHE IS REAL. THE RIVER RAN BACKWARD.\n\nVault assault: ' + mission.kills + ' hostiles down\nIntegrity remaining: ' + Math.round(player.hp) + '%\n\nChicago knows your name now. Act IV - "THE SPIRE" - next build.', [
        ['Keep roaming', () => hideCard()],
      ]);
      setObjectiveSilent('FREE ROAM - CHICAGO 2099');
      el.objDist.textContent = '';
      mission.target = null;
    }
  } else if (mission.stage === 6){
    const ns = nearestShard();
    if (ns){
      mission.target = null;
      el.objDist.textContent = Math.round(ns.dist) + 'M';
      markerTarget = ns.obj.m.position;
      if (ns.dist < 2.4){
        ns.obj.got = true;
        scene.remove(ns.obj.m); scene.remove(ns.obj.l);
        mission.shardsGot++;
        mission.shardState[ns.obj.idx] = true;
        AudioSys.objective();
        spawnSparks(ns.obj.m.position, 0x3ee6ff, 16);
        if (mission.shardsGot >= 3){
          mission.stage = 7;
          markerTarget = null;
          setObjective('RETURN TO VERA', mission.fixer);
          saveGame();
        } else {
          saveGame();
          setObjectiveSilent('RECOVER THE SHARDS - ' + mission.shardsGot + '/3');
          spawnDroneRing(1, 45);
        }
      }
    }
  } else {
    el.objDist.textContent = '';
  }
  if (mission.terminalMesh){
    mission.terminalMesh.children[1].material.color.setHex(
      Math.sin(clock.elapsedTime*4) > 0 ? 0x3ee6ff : 0x1a7f99);
  }
  if (mission.vaultMesh){
    mission.vaultMesh.children[1].material.color.setHex(
      Math.sin(clock.elapsedTime*4) > 0 ? 0xff3e8d : 0x99224f);
  }
  if (mission.kikoMesh){
    mission.kikoMesh.position.y = Math.sin(clock.elapsedTime*1.7)*0.03;
  }
  if (mission.luckyCatMesh){
    mission.luckyCatMesh.position.y = Math.sin(clock.elapsedTime*1.5)*0.02;
    mission.luckyPaw.rotation.x = -0.5 + Math.sin(clock.elapsedTime*3)*0.4;
  }
  if (mission.fixerMesh){
    mission.fixerMesh.position.y = Math.sin(clock.elapsedTime*1.6)*0.03;
    mission.fixerMesh.rotation.y = Math.PI + Math.sin(clock.elapsedTime*0.5)*0.2;
  }
}

/* ---------- objective world marker ---------- */
function buildMarker(){
  const geo = new THREE.ConeGeometry(0.7, 1.6, 4);
  const mat = new THREE.MeshBasicMaterial({ color:0xffb54d, transparent:true, opacity:0.9 });
  objectiveMarker = new THREE.Mesh(geo, mat);
  objectiveMarker.rotation.x = Math.PI;
  scene.add(objectiveMarker);
}
let markerTarget = null;
function updateMarker(){
  if (!objectiveMarker) return;
  const t = mission.target || markerTarget;
  if (t && !player.dead){
    objectiveMarker.visible = true;
    objectiveMarker.position.set(t.x, 6 + Math.sin(clock.elapsedTime*2.4)*0.5, t.z);
    objectiveMarker.rotation.y += 0.03;
  } else {
    objectiveMarker.visible = false;
  }
}

/* ============================== HUD ============================== */
function updateHud(){
  el.hp.style.width = (player.hp/player.maxHp*100) + '%';
  el.sh.style.width = (player.sh/player.maxSh*100) + '%';
  el.heat.style.width = (player.heat*100) + '%';
}
let msgT = null;
function hudMsg(text, secs){
  el.msg.textContent = text;
  el.msg.style.opacity = 1;
  clearTimeout(msgT);
  msgT = setTimeout(() => { el.msg.style.opacity = 0; }, (secs||2)*1000);
}

/* ============================== cards / menus ============================== */
function showCard(title, body, buttons){
  document.exitPointerLock && document.exitPointerLock();
  el.cardTitle.textContent = title;
  el.cardBody.textContent = body;
  el.cardMenu.innerHTML = '';
  for (const [label, fn] of buttons){
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { AudioSys.blip(); fn(); };
    el.cardMenu.appendChild(b);
  }
  el.card.classList.remove('hidden');
}
function hideCard(){
  el.card.classList.add('hidden');
  gameState = 'play';
  el.hint.classList.toggle('hidden', pointerLocked);   // LOW 6: recapture hint after resume
}
function pauseGame(){
  if (gameState !== 'play') return;
  gameState = 'pause';
  document.exitPointerLock && document.exitPointerLock();
  showCard('PAUSED', 'Chicago 2099 waits for no one.\n(Except you, right now.)', [
    ['Resume', () => hideCard()],
    ['Quit to title', () => location.reload()],
  ]);
}

/* ============================== title rain streaks ============================== */
function animateTitleRain(){
  const c = el.rain, g = c.getContext('2d');
  const drops = [];
  function size(){ c.width = innerWidth; c.height = innerHeight; }
  size(); addEventListener('resize', size);
  for (let i=0;i<70;i++) drops.push({ x:Math.random(), y:Math.random(), v:0.002+Math.random()*0.006, l:0.02+Math.random()*0.06 });
  (function draw(){
    if (el.title.classList.contains('hidden')) return;
    g.clearRect(0,0,c.width,c.height);
    g.strokeStyle = 'rgba(160,200,235,0.35)';
    g.lineWidth = 1;
    for (const d of drops){
      d.y += d.v;
      if (d.y > 1.1){ d.y = -0.1; d.x = Math.random(); }
      g.beginPath();
      g.moveTo(d.x*c.width, d.y*c.height);
      g.lineTo(d.x*c.width + 2, (d.y+d.l)*c.height);
      g.stroke();
    }
    requestAnimationFrame(draw);
  })();
}

/* ============================== boot / states ============================== */
let gameState = 'title';
function startGame(fromSave){
  AudioSys.init();
  el.title.classList.add('hidden');
  el.opts.classList.add('hidden');
  el.creds.classList.add('hidden');
  el.hud.classList.remove('hidden');
  gameState = 'play';
  const sv = fromSave ? loadGame() : null;
  if (sv && sv.stage > 1){
    restoringSave = true;
    restoreStage(sv);
    restoringSave = false;
    checkpoint.set(sv.checkpoint[0], 0, sv.checkpoint[1]);
    player.pos.set(sv.checkpoint[0], 0, sv.checkpoint[1]);
    player.vel.set(0, 0, 0);
    hudMsg('SHIFT RESUMED', 2.5);
  } else {
    mission.stage = 1;
    checkpoint.set(0, 0, 20);
    setObjective('REACH THE DEAD DROP UNDER THE L', mission.terminal);
    hudMsg('ACT I - FIRST SHIFT', 3);
    saveGame();
  }
  renderer.domElement.requestPointerLock();
}
function bindMenus(){
  const sv = loadGame();
  const cont = document.querySelector('#main-menu button[data-act=continue]');
  if (cont && sv && sv.stage > 1) cont.classList.remove('hidden');
  document.querySelectorAll('#main-menu button').forEach(b => {
    b.onclick = () => {
      AudioSys.init(); AudioSys.blip();
      const act = b.dataset.act;
      if (act === 'start') startGame(false);
      if (act === 'continue') startGame(true);
      if (act === 'options'){ el.title.classList.add('hidden'); el.opts.classList.remove('hidden'); }
      if (act === 'credits'){ el.title.classList.add('hidden'); el.creds.classList.remove('hidden'); }
    };
  });
  document.querySelectorAll('.back').forEach(b => {
    b.onclick = () => {
      AudioSys.blip();
      el.opts.classList.add('hidden');
      el.creds.classList.add('hidden');
      el.title.classList.remove('hidden');
    };
  });
  $('opt-vol').value = S.vol*100;
  $('opt-sens').value = S.sens*100;
  $('opt-invy').checked = S.invertY;
  $('opt-quality').value = S.quality;
  $('opt-vol').oninput = e => { S.vol = e.target.value/100; AudioSys.setVol(S.vol); saveSettings(); };
  $('opt-sens').oninput = e => { S.sens = e.target.value/100; saveSettings(); };
  $('opt-invy').onchange = e => { S.invertY = e.target.checked; saveSettings(); };
  $('opt-quality').onchange = e => { S.quality = e.target.value; applyQuality(); };
}

/* ============================== main loop ============================== */
function loop(){
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (gameState === 'play'){
    updatePlayer(dt);
    tryShoot(dt);
    updateDrones(dt);
    updateHounds(dt);
    updateBolts(dt);
    updateMission(dt);
    updateShards();
    updateHud();
  } else if (gameState === 'dialog'){
    updateViewmodel(dt);
    updateHud();
  }
  updateTrain(dt);
  updateTraffic(dt);
  updatePeds(dt);
  updateRain(dt);
  updateTracers(dt);
  updateSparks(dt);
  updateMarker();
  for (const b of blinkers){
    b.userData.blink += dt;
    b.material.color.setHex((b.userData.blink % 1.6) < 0.9 ? 0xff2244 : 0x441122);
  }
  // combat music crossfade
  if (AudioSys.started){
    AudioSys.combat += (AudioSys.combatTarget - AudioSys.combat) * Math.min(1, dt*2.5);
    AudioSys.combatGain.gain.value = AudioSys.combat * 0.5;
    AudioSys.musicGain.gain.value = 0.5 - AudioSys.combat*0.15;
  }
  if (riverMesh){
    riverMesh.material.emissiveIntensity = 0.3 + Math.sin(clock.elapsedTime*0.8)*0.08;
  }
  renderer.render(scene, camera);
}

loadSettings();
initRenderer();
buildCity();
buildTraffic();
buildPlayer();
buildPeds();
buildRain();
buildTerminal();
buildLuckyCat();
buildMarker();
bindMenus();
animateTitleRain();
loop();
