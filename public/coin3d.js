// Timbre fiscal 3D: moneda de metal azul con grabado guilloché, renderizada
// en tiempo real con Three.js (WebGL) e iluminación de estudio (PMREM).
// Se monta en la portada (giro lento que sigue al puntero) y en la pantalla
// de éxito (animación de "estampado" al timbrar).

import * as THREE from "three";
import { RoomEnvironment } from "/vendor/RoomEnvironment.js";

const BLUE = 0x2f66d0;
const FACE_BLUE = 0x3b74de;

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGL2RenderingContext && c.getContext("webgl2"));
  } catch {
    return false;
  }
}

async function engravingTexture(maxAnisotropy) {
  try { await document.fonts.load("italic 700 48px Saira"); } catch { /* usa la alternativa */ }
  const size = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const mid = size / 2;

  // Gris medio = superficie plana; claro = relieve; oscuro = surco.
  g.fillStyle = "#808080";
  g.fillRect(0, 0, size, size);

  // Guilloché: roseta de elipses giradas, como en billetes y sellos oficiales.
  g.save();
  g.translate(mid, mid);
  g.beginPath();
  g.arc(0, 0, 350, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = "rgba(255,255,255,0.42)";
  g.lineWidth = 1.6;
  for (let i = 0; i < 96; i++) {
    g.save();
    g.rotate((i / 96) * Math.PI * 2);
    g.beginPath();
    g.ellipse(0, 0, 340, 128, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  g.strokeStyle = "rgba(0,0,0,0.28)";
  for (let r = 186; r < 350; r += 7) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();

  // Disco central liso para la leyenda.
  g.fillStyle = "#808080";
  g.beginPath();
  g.arc(mid, mid, 182, 0, Math.PI * 2);
  g.fill();

  // Anillos: surco y filete.
  const ring = (r, w, color) => {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.beginPath();
    g.arc(mid, mid, r, 0, Math.PI * 2);
    g.stroke();
  };
  ring(500, 10, "#e8e8e8");
  ring(478, 16, "#3c3c3c");
  ring(358, 8, "#e0e0e0");
  ring(182, 6, "#e0e0e0");

  // Leyenda circular.
  const legend = "TIMBRE FISCAL DIGITAL  ·  CFDI 4.0  ·  Z E-SCOOTERS MÉXICO  ·  ";
  g.fillStyle = "#f0f0f0";
  g.font = "italic 700 44px Saira, 'Arial Narrow', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const chars = [...legend];
  const step = (Math.PI * 2) / chars.length;
  chars.forEach((ch, i) => {
    g.save();
    g.translate(mid, mid);
    g.rotate(i * step - Math.PI / 2);
    g.translate(0, -420);
    g.fillText(ch, 0, 0);
    g.restore();
  });

  // Centro: CFDI 4.0 en relieve.
  g.fillStyle = "#ffffff";
  g.font = "italic 800 150px Saira, 'Arial Black', sans-serif";
  g.fillText("CFDI", mid, mid - 30);
  g.font = "italic 700 84px Saira, 'Arial Black', sans-serif";
  g.fillText("4.0", mid, mid + 88);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = maxAnisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function coinGeometry() {
  // Perfil del canto: bisel, filete elevado y cara rebajada.
  const pts = [
    [0.0, 0.1], [0.78, 0.1], [0.8, 0.118], [0.86, 0.14], [0.925, 0.14],
    [0.975, 0.118], [1.0, 0.07], [1.0, -0.07], [0.975, -0.118], [0.925, -0.14],
    [0.86, -0.14], [0.8, -0.118], [0.78, -0.1], [0.0, -0.1]
  ].map(([x, y]) => new THREE.Vector2(x, y)).reverse();
  const geo = new THREE.LatheGeometry(pts, 160);
  geo.rotateX(Math.PI / 2);
  return geo;
}

const easeOutBack = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

export async function mountCoin(container, { mode = "hero" } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute("aria-hidden", "true");
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 0, 5.4);

  const engraving = await engravingTexture(renderer.capabilities.getMaxAnisotropy());

  const rimMat = new THREE.MeshPhysicalMaterial({
    color: BLUE, metalness: 1, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.12
  });
  const faceMat = new THREE.MeshPhysicalMaterial({
    color: FACE_BLUE, metalness: 1, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2,
    bumpMap: engraving, bumpScale: 2.4
  });

  const coin = new THREE.Group();
  coin.add(new THREE.Mesh(coinGeometry(), rimMat));
  const faceGeo = new THREE.CircleGeometry(0.79, 160);
  const front = new THREE.Mesh(faceGeo, faceMat);
  front.position.z = 0.1005;
  const back = new THREE.Mesh(faceGeo, faceMat);
  back.position.z = -0.1005;
  back.rotation.y = Math.PI;
  coin.add(front, back);
  scene.add(coin);

  const key = new THREE.DirectionalLight(0xe2ecff, 2.4);
  key.position.set(3, 4, 5);
  const rim = new THREE.DirectionalLight(0x6c9dff, 3.2);
  rim.position.set(-4, -1, -3);
  const sweep = new THREE.PointLight(0xffffff, 18, 9);
  scene.add(key, rim, sweep);

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (event) => {
    const r = container.getBoundingClientRect();
    pointer.tx = ((event.clientX - r.left) / r.width - 0.5) * 2;
    pointer.ty = ((event.clientY - r.top) / r.height - 0.5) * 2;
  };
  const tracker = container.closest("[data-coin-tracker]") || container;
  tracker.addEventListener("pointermove", onMove);
  tracker.addEventListener("pointerleave", () => { pointer.tx = 0; pointer.ty = 0; });

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let visible = true;
  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  io.observe(container);

  const clock = new THREE.Clock();
  let stampStart = mode === "stamp" ? 0 : -1;
  let raf = 0;

  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!visible || document.hidden) return;
    const t = clock.getElapsedTime();
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;

    let rotY = Math.sin(t * 0.45) * 0.5 + pointer.x * 0.45;
    let rotX = Math.sin(t * 0.7) * 0.08 + pointer.y * 0.3;
    let posZ = 0;
    let scale = 1;

    if (stampStart >= 0) {
      // Estampado: la moneda cae girando y se asienta de frente.
      const p = Math.min(1, (t - stampStart) / 1.9);
      const e = easeOutCubic(p);
      rotY = (1 - e) * Math.PI * 4 + rotY * e;
      rotX = (1 - e) * -0.6 + rotX * e;
      posZ = (1 - e) * 4.2;
      scale = 0.6 + 0.4 * easeOutBack(p);
      if (p >= 1) stampStart = -1;
    }

    coin.rotation.set(rotX, rotY, 0);
    coin.position.set(0, Math.sin(t * 1.1) * 0.04, posZ);
    coin.scale.setScalar(scale);

    // Luz que barre el metal como un reflejo de estudio.
    sweep.position.set(Math.sin(t * 0.6) * 3, 1.4 + Math.cos(t * 0.4) * 0.6, 2.6);

    renderer.render(scene, camera);
  };
  tick();

  return {
    stamp() { stampStart = clock.getElapsedTime(); },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      tracker.removeEventListener("pointermove", onMove);
      engraving.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
