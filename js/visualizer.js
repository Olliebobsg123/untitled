"use strict";

window.Viz = {
  scene: null, camera: null, renderer: null, controls: null,
  fixtures: [], animating: false, State: { fixtures:[], fixtureStates:new Map(), current:{intensity:100,hue:0,sat:0,master:100,pan:128,tilt:128} }
};

function debugLog(msg, type='info') {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] [${type.toUpperCase()}] ${msg}`;
  console.log(line);
  const logDiv = document.getElementById('debugLog');
  if(logDiv) logDiv.textContent += line + "\n";
}

function initVisualizer() {
  debugLog("🚀 Visualizer starting...");
  const container = document.getElementById('vizContainer');
  if (!container) return debugLog("❌ vizContainer not found", "error");
  if (typeof THREE === 'undefined') return debugLog("❌ Three.js not loaded", "error");

  Viz.scene = new THREE.Scene();
  Viz.scene.background = new THREE.Color(0x101010);
  debugLog("✅ Scene created");

  Viz.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100);
  Viz.camera.position.set(8, 4, 12);
  Viz.camera.lookAt(0,1.5,0);
  debugLog("✅ Camera set");

  Viz.renderer = new THREE.WebGLRenderer({antialias:true});
  Viz.renderer.setSize(container.clientWidth, container.clientHeight);
  Viz.renderer.shadowMap.enabled = true;
  container.appendChild(Viz.renderer.domElement);
  debugLog("✅ Renderer added");

  if (typeof THREE.OrbitControls !== 'undefined') {
    Viz.controls = new THREE.OrbitControls(Viz.camera, Viz.renderer.domElement);
    Viz.controls.target.set(0, 1.5, 0);
    debugLog("✅ OrbitControls active");
  }

  // Base scene
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), new THREE.MeshStandardMaterial({color:0x1a1a1a, roughness:0.8}));
  floor.rotation.x = -Math.PI/2;
  floor.receiveShadow = true;
  Viz.scene.add(floor);

  const truss = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 0.2), new THREE.MeshStandardMaterial({color:0x444444}));
  truss.position.y = 3.5;
  Viz.scene.add(truss);

  Viz.scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  debugLog("✅ Base scene ready");

  window.addEventListener('resize', () => {
    Viz.camera.aspect = container.clientWidth / container.clientHeight;
    Viz.camera.updateProjectionMatrix();
    Viz.renderer.setSize(container.clientWidth, container.clientHeight);
  });

  Viz.animating = true;
  animateViz();
  connectConsole();
  debugLog("✅ Visualizer ready — waiting for data");
}

// --- ✅ FULLY FIXED WebSocket ---
function connectConsole() {
  debugLog("🔌 Connecting to ws://localhost:8081");
  try {
    const ws = new WebSocket('ws://localhost:8081');

    ws.onopen = () => {
      debugLog("✅ WebSocket connected");
      // ✅ ASK FOR STATE IMMEDIATELY + KEEP ASKING
      requestState();
      setInterval(requestState, 300);
    };

    // ✅ NEW: Ask controller to send full state
    function requestState() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({type:'REQUEST_STATE'}));
      }
    }

    ws.onmessage = e => {
      try {
        // ✅ STRIP THE JSON: PREFIX BEFORE PARSING!
        let raw = e.data.trim();
        debugLog(`📩 Raw msg: ${raw.slice(0,60)}...`); // Show incoming text

        if (raw.startsWith("JSON:")) raw = raw.slice(5).trim();
        const data = JSON.parse(raw);

        debugLog(`📥 Received: ${data.type}, fixtures=${data.fixtures?.length||0}`);
        if (data.type === 'VIZ_STATE') {
          Viz.State.fixtures = data.fixtures || [];
          Viz.State.fixtureStates = new Map(data.fixtureStates || []);
          Viz.State.current = data.current || Viz.State.current;
          rebuildFixtures();
          updateVisualizer();
        }
      } catch(err) { debugLog(`❌ Parse error: ${err.message}`, "error"); }
    };

    ws.onclose = () => { debugLog("🔌 Reconnecting in 2s", "warn"); setTimeout(connectConsole,2000); };
    ws.onerror = () => debugLog("❌ WebSocket error", "error");
  } catch(err) { debugLog(`❌ Failed: ${err.message}`, "error"); }
}

function rebuildFixtures() {
  Viz.fixtures.forEach(f => Viz.scene.remove(f.group));
  Viz.fixtures = [];
  if (!Viz.State.fixtures.length) return debugLog("⚠️ No fixtures yet", "warn");
  Viz.State.fixtures.forEach((fx, i) => addFixtureViz(fx, i));
  debugLog(`💡 Built ${Viz.fixtures.length} fixtures`);
}

function addFixtureViz(fx, idx) {
  const group = new THREE.Group();
  group.position.set(-5 + idx * 1.2, 3.5, 0);
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.3,0.3,0.3), new THREE.MeshStandardMaterial({color:0x222})));
  const spot = new THREE.SpotLight(0xffffff, 0, 15, Math.PI/6, 0.3, 1);
  spot.castShadow = true;
  spot.target.position.set(0, -3, 0);
  group.add(spot, spot.target);
  Viz.fixtures.push({group, spot, fx});
  Viz.scene.add(group);
}

function updateVisualizer() {
  Viz.fixtures.forEach(fv => {
    const s = Viz.State.fixtureStates.get(fv.fx.id) || Viz.State.current;
    const col = new THREE.Color().setHSL(Math.max(0,Math.min(1,(s.hue||0)/360)), (s.sat||0)/100, 0.5);
    const power = ((s.intensity||100)/100) * ((s.master||100)/100);
    fv.spot.color.copy(col);
    fv.spot.intensity = power * 3;
    fv.group.rotation.y = ((s.pan||128)/255 - 0.5) * Math.PI * 0.7;
    fv.group.rotation.x = ((s.tilt||128)/255) * Math.PI * 0.5;
  });
}

function animateViz() {
  if (!Viz.animating) return;
  requestAnimationFrame(animateViz);
  if (Viz.controls) Viz.controls.update();
  Viz.renderer.render(Viz.scene, Viz.camera);
}

document.addEventListener('DOMContentLoaded', initVisualizer);