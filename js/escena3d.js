/**
 * escena3d.js — Representación 3D del sistema con Three.js
 * Río → captación y bombeo → aducción → tanque → distribución → grifo de la vivienda,
 * y un arroyo canalizado con compuerta que descarga a un pozo de disipación.
 *
 * La escena solo dibuja: todos los números vienen de modelo.js (calcularSistema).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/CSS2DRenderer.js';
import * as M from './modelo.js';

// ── Escalas y posiciones de la escena ──────────────────────────────────────
const VS = 0.6;           // escala vertical: 1 m de cota = 0.6 unidades
const ESC_TUBO = 2.2;     // exageración visual del diámetro de las tuberías
const VIS_FLUJO = 5;      // unidades por segundo por cada m/s de velocidad real
const X_RIO = -40;
const X_BOMBA = -30.5;
const X_CASA = 32;
const Z_CASA = -1;
const Z_FRENTE_CASA = Z_CASA + 2.5;
const X_GRIFO = X_CASA - 1.8;
const Z_CANAL = 21;
const X_CANAL_INI = -22;
const X_CANAL_FIN = 44;
const PISO_CANAL = 6.0;
const FOSA = { x0: 44.4, x1: 55, z0: Z_CANAL - 7.5, z1: Z_CANAL + 7.5, fondo: PISO_CANAL - 5.2 };

const COLOR = {
  cielo: 0xcfe2e8,
  agua: 0x1c86b8,
  aguaClara: 0x9edcf0,
  concreto: 0xcfccc3,
  concretoOsc: 0xa29f96,
  tubo: 0xcde3ea,
  metal: 0x52636a,
  bomba: 0x2f6f8f,
  muro: 0xeadfca,
  techo: 0xa45a3c,
  piezo: 0xd2741c,
  alerta: 0xc0422a,
};

function suave(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

function interp(claves, x) {
  if (x <= claves[0][0]) return claves[0][1];
  for (let i = 0; i < claves.length - 1; i++) {
    const [x0, y0] = claves[i];
    const [x1, y1] = claves[i + 1];
    if (x <= x1) return y0 + (y1 - y0) * suave((x - x0) / (x1 - x0));
  }
  return claves[claves.length - 1][1];
}

// Perfil del corredor del acueducto (z ≈ 0) y de la llanura urbana (z > 16)
const PERFIL = [[-110, 6], [-52, 3.4], [-44, 0.3], [-36, 0.3], [-33, 2.2], [-26, 6], [-7, 22.8], [6, 22.8], [17, 10], [24, 7.2], [44, 7.2], [57, -1.5], [120, -1.5]];
const LLANURA = [[-110, 6], [-52, 3.4], [-44, 0.3], [-36, 0.3], [-32, 3.4], [-27, 6], [57, 6], [63, -1.5], [120, -1.5]];

export function alturaTerreno(x, z) {
  const a = interp(PERFIL, x);
  const b = interp(LLANURA, x);
  let y = a + (b - a) * suave((z - 5) / 11);
  // Estribaciones de la Sierra al fondo (sin tapar el cauce del río)
  const lejos = suave((-z - 14) / 34);
  const cauce = Math.exp(-(((x - X_RIO) / 7) ** 2));
  y += lejos * (1 - cauce) * (14 + 7 * Math.sin(x * 0.06 + 1.3) + 5 * Math.cos(x * 0.11 - z * 0.05));
  // Ondulación suave lejos de las estructuras
  const banda = Math.max(suave(1 - Math.abs(z - Z_CANAL) / 10), 0.85 * suave(1 - Math.abs(z) / 6));
  y += (1 - banda) * 0.45 * Math.sin(x * 0.31 + z * 0.17) * Math.cos(z * 0.23 - x * 0.05);
  // Pozo de disipación al final del canal
  if (x > FOSA.x0 - 0.6 && x < FOSA.x1 + 0.6 && z > FOSA.z0 - 0.6 && z < FOSA.z1 + 0.6) {
    y = Math.min(y, FOSA.fondo);
  }
  return y;
}

function texturaAgua() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2a8fbe';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(210, 240, 250, ${0.08 + Math.random() * 0.22})`;
    g.lineWidth = 1 + Math.random() * 1.5;
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 6, y + 10 + Math.random() * 18);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function liberar(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
    if (o.isCSS2DObject && o.element.parentNode) o.element.parentNode.removeChild(o.element);
  });
}

function caja(w, h, d, color, opciones = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opciones }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const fmt = (x, d = 2) => (Number.isFinite(x) ? M.redondear(x, d).toFixed(d) : '—');

// ── Partículas que recorren una curva (flujo dentro de una tubería) ────────
class FlujoTubo {
  constructor(padre, max = 260) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({ color: COLOR.aguaClara }),
      max,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.aux = new THREE.Object3D();
    padre.add(this.mesh);
  }

  setCurva(curva, radio) {
    this.curva = curva;
    this.largo = curva.getLength();
    this.n = Math.min(this.max, Math.floor(this.largo / 0.85));
    this.u = new Float32Array(this.n).map((_, i) => i / this.n);
    this.radio = radio;
    this.mesh.count = this.n;
    this.paso(0, 0);
  }

  paso(dt, velocidad) {
    if (!this.curva) return;
    const du = (velocidad * VIS_FLUJO * dt) / this.largo;
    const visible = velocidad > 1e-4;
    this.mesh.visible = visible;
    if (!visible) return;
    for (let i = 0; i < this.n; i++) {
      this.u[i] = (this.u[i] + du) % 1;
      this.curva.getPointAt(this.u[i], this.aux.position);
      this.aux.scale.setScalar(this.radio);
      this.aux.updateMatrix();
      this.mesh.setMatrixAt(i, this.aux.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ── Chorro parabólico de partículas ────────────────────────────────────────
class Chorro {
  constructor(padre, max, radio) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 5),
      new THREE.MeshBasicMaterial({ color: COLOR.aguaClara }),
      max,
    );
    this.mesh.frustumCulled = false;
    this.radio = radio;
    this.s = new Float32Array(max).map(() => Math.random());
    this.lado = new Float32Array(max).map(() => Math.random() - 0.5);
    this.alto = new Float32Array(max).map(() => Math.random());
    this.aux = new THREE.Object3D();
    padre.add(this.mesh);
  }

  /**
   * origen: punto de salida; dir: 'x' o 'z' (dirección horizontal del chorro)
   * v: velocidad horizontal [m/s]; h: caída hasta el plano receptor [m];
   * esc: escala de dibujo; ancho: dispersión lateral; espesor: grosor vertical de la lámina [m]
   */
  configurar({ origen, dir, v, h, esc, ancho = 0, espesor = 0, cantidad }) {
    Object.assign(this, { origen, dir, v, h, esc, ancho, espesor });
    this.mesh.count = Math.min(this.max, cantidad ?? this.max);
  }

  paso(dt, lento = 0.55) {
    const activo = this.v > 0.01 && this.h > 0;
    this.mesh.visible = activo;
    if (!activo) return;
    for (let i = 0; i < this.mesh.count; i++) {
      const extra = this.alto[i] * this.espesor;
      const hTot = this.h + extra;
      const tVuelo = Math.sqrt((2 * hTot) / M.G);
      this.s[i] += (dt * lento) / tVuelo;
      if (this.s[i] >= 1) this.s[i] -= 1;
      const t = this.s[i] * tVuelo;
      const x = this.v * t;                              // avance horizontal [m]
      const y = extra - (M.G * t * t) / 2;               // caída: −g·t²/2 = −g·x²/(2v²)
      const p = this.aux.position;
      p.copy(this.origen);
      if (this.dir === 'x') {
        p.x += x * this.esc;
        p.z += this.lado[i] * this.ancho;
      } else {
        p.z += x * this.esc;
        p.x += this.lado[i] * this.ancho;
      }
      p.y += y * this.esc;
      this.aux.scale.setScalar(this.radio);
      this.aux.updateMatrix();
      this.mesh.setMatrixAt(i, this.aux.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Escena {
  constructor(contenedor, { onSeleccion } = {}) {
    this.contenedor = contenedor;
    this.onSeleccion = onSeleccion || (() => {});
    this.claves = {};
    this.etiquetas = {};
    this.tabActiva = null;
    this.seleccionables = [];
  }

  iniciar() {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      return false;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.contenedor.appendChild(r.domElement);

    this.etiquetador = new CSS2DRenderer();
    const el = this.etiquetador.domElement;
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '2';
    this.contenedor.appendChild(el);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLOR.cielo);
    this.scene.fog = new THREE.Fog(COLOR.cielo, 140, 300);

    this.camara = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
    this.controles = new OrbitControls(this.camara, r.domElement);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.08;
    this.controles.maxPolarAngle = 1.42;
    this.controles.minDistance = 12;
    this.controles.maxDistance = 220;
    this.controles.addEventListener('start', () => this.contenedor.querySelector('.ayuda')?.classList.add('oculta'));

    this.luces();
    this.terreno();
    this.aguas();

    this.grupos = {
      bomba: this.grupo('captacion'),
      aduccion: this.grupo('tuberias'),
      tanque: this.grupo('tanque'),
      distribucion: this.grupo('tuberias'),
      casa: this.grupo('vivienda'),
      canal: this.grupo('arroyo'),
    };
    this.construirBomba();
    this.construirFosa();

    this.flujoAduccion = new FlujoTubo(this.scene);
    this.flujoDistribucion = new FlujoTubo(this.scene);
    this.chorroGrifo = new Chorro(this.scene, 70, 0.06);
    this.chorroCompuerta = new Chorro(this.scene, 420, 0.12);
    this.particulasCanal();
    this.lineaPiezometrica();
    this.crearEtiquetas();

    this.encuadrar();
    new ResizeObserver(() => this.redimensionar()).observe(this.contenedor);
    this.redimensionar();
    this.eventosSeleccion();

    this.reloj = new THREE.Clock();
    this.listo = true;
    if (this.p) this.actualizar(this.p, this.r, this.nivel);
    r.setAnimationLoop(() => this.animar());
    return true;
  }

  grupo(tab) {
    const g = new THREE.Group();
    g.userData.tab = tab;
    this.scene.add(g);
    return g;
  }

  // ── Ambiente ────────────────────────────────────────────────────────────
  luces() {
    const cielo = new THREE.HemisphereLight(0xe4f2f6, 0x8c7b56, 1.35);
    this.scene.add(cielo);
    const sol = new THREE.DirectionalLight(0xfff3df, 2.4);
    sol.position.set(55, 95, 60);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    const s = sol.shadow.camera;
    s.left = -80; s.right = 80; s.top = 60; s.bottom = -60; s.near = 10; s.far = 260;
    sol.shadow.bias = -0.0006;
    sol.shadow.normalBias = 0.04;
    sol.target.position.set(5, 0, 8);
    this.scene.add(sol, sol.target);
  }

  terreno() {
    const geo = new THREE.PlaneGeometry(240, 190, 240, 190);
    geo.rotateX(-Math.PI / 2);
    geo.translate(5, 0, -5);
    const pos = geo.attributes.position;
    const colores = new Float32Array(pos.count * 3);
    const arena = new THREE.Color(0xdccca3);
    const seco = new THREE.Color(0xbcab78);
    const verde = new THREE.Color(0x8b9e64);
    const verdeOsc = new THREE.Color(0x5f7a4d);
    const roca = new THREE.Color(0x8f8a78);
    const urbano = new THREE.Color(0xc9c0a8);
    const concreto = new THREE.Color(COLOR.concretoOsc);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = alturaTerreno(x, z);
      pos.setY(i, y);
      if (y < 1.2) c.copy(arena);
      else if (y < 4.5) c.copy(arena).lerp(seco, (y - 1.2) / 3.3);
      else if (y < 15) c.copy(seco).lerp(verde, (y - 4.5) / 10.5);
      else if (y < 28) c.copy(verde).lerp(verdeOsc, (y - 15) / 13);
      else c.copy(verdeOsc).lerp(roca, Math.min(1, (y - 28) / 10));
      const ciudad = suave((z - 10) / 6) * suave((x + 27) / 3) * (1 - suave((x - 56) / 3));
      if (ciudad > 0) c.lerp(urbano, ciudad * 0.75);
      if (x > FOSA.x0 - 0.6 && x < FOSA.x1 + 0.6 && z > FOSA.z0 - 0.6 && z < FOSA.z1 + 0.6) c.copy(concreto);
      const ruido = 0.94 + 0.06 * Math.sin(x * 1.7 + z * 2.3) * Math.cos(x * 0.9 - z * 1.3);
      colores[i * 3] = c.r * ruido;
      colores[i * 3 + 1] = c.g * ruido;
      colores[i * 3 + 2] = c.b * ruido;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colores, 3));
    geo.computeVertexNormals();
    const malla = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
    malla.receiveShadow = true;
    this.scene.add(malla);
  }

  aguas() {
    this.texRio = texturaAgua();
    this.texRio.repeat.set(2, 22);
    const rio = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 190),
      new THREE.MeshStandardMaterial({ map: this.texRio, color: 0xffffff, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.92 }),
    );
    rio.rotation.x = -Math.PI / 2;
    rio.position.set(X_RIO - 0.5, 2.5 * VS, -5);
    rio.receiveShadow = true;
    rio.userData.tab = 'captacion';
    this.scene.add(rio);
    this.seleccionables.push(rio);

    this.texMar = texturaAgua();
    this.texMar.repeat.set(8, 14);
    const mar = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 190),
      new THREE.MeshStandardMaterial({ map: this.texMar, color: 0xcfe9f2, roughness: 0.3, transparent: true, opacity: 0.95 }),
    );
    mar.rotation.x = -Math.PI / 2;
    mar.position.set(102, 0, -5);
    this.scene.add(mar);
  }

  // ── Captación y bombeo ────────────────────────────────────────────────
  construirBomba() {
    const g = this.grupos.bomba;
    const y0 = alturaTerreno(X_BOMBA, 0);
    const losa = caja(5.2, 0.5, 4.2, COLOR.concreto);
    losa.position.set(X_BOMBA, y0 + 0.1, 0);
    g.add(losa);
    // Cobertizo abierto: techo sobre cuatro columnas para ver la bomba
    for (const [dx, dz] of [[-2.3, -1.8], [2.3, -1.8], [-2.3, 1.8], [2.3, 1.8]]) {
      const col = caja(0.25, 3.1, 0.25, COLOR.concreto);
      col.position.set(X_BOMBA + dx, y0 + 1.9, dz);
      g.add(col);
    }
    const techo = caja(5.6, 0.25, 4.6, 0x7d8c8f);
    techo.position.set(X_BOMBA, y0 + 3.5, 0);
    g.add(techo);
    // Bomba: voluta + motor + volante que gira según el caudal
    const metal = new THREE.MeshStandardMaterial({ color: COLOR.bomba, roughness: 0.4, metalness: 0.5 });
    const voluta = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.7, 24), metal);
    voluta.rotation.x = Math.PI / 2;
    voluta.position.set(X_BOMBA - 0.4, y0 + 1.0, 0);
    voluta.castShadow = true;
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 20), metal);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(X_BOMBA + 0.9, y0 + 1.0, 0);
    motor.castShadow = true;
    this.volante = new THREE.Group();
    const aspa = new THREE.MeshStandardMaterial({ color: 0xe8b04a, roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.16), aspa);
      a.rotation.x = (i * Math.PI) / 4;
      this.volante.add(a);
    }
    this.volante.position.set(X_BOMBA + 1.8, y0 + 1.0, 0);
    g.add(voluta, motor, this.volante);
  }

  // ── Tanque ────────────────────────────────────────────────────────────
  radioTanque() {
    return this.p.Dtanque * 0.25;
  }

  construirTanque() {
    const g = this.grupos.tanque;
    g.children.slice().forEach((o) => { g.remove(o); liberar(o); });
    const r = this.radioTanque();
    const base = 38 * VS;
    const alto = this.p.hMax * VS;
    const losa = new THREE.Mesh(
      new THREE.CylinderGeometry(r + 0.6, r + 0.8, 0.6, 48),
      new THREE.MeshStandardMaterial({ color: COLOR.concreto, roughness: 0.9 }),
    );
    losa.position.set(0, base - 0.3, 0);
    losa.receiveShadow = true;
    losa.castShadow = true;
    const pared = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, alto, 48, 1, true),
      new THREE.MeshPhysicalMaterial({ color: 0xdce9ee, roughness: 0.15, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    );
    pared.position.set(0, base + alto / 2, 0);
    const aro = new THREE.MeshStandardMaterial({ color: COLOR.metal, roughness: 0.5, metalness: 0.4 });
    const aroSup = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 8, 48), aro);
    aroSup.rotation.x = Math.PI / 2;
    aroSup.position.set(0, base + alto, 0);
    g.add(losa, pared, aroSup);
    // Marcas de nivel cada metro
    for (let m = 1; m < this.p.hMax; m++) {
      const marca = new THREE.Mesh(
        new THREE.TorusGeometry(r + 0.01, 0.025, 4, 48),
        new THREE.MeshBasicMaterial({ color: COLOR.metal, transparent: true, opacity: 0.45 }),
      );
      marca.rotation.x = Math.PI / 2;
      marca.position.set(0, base + m * VS, 0);
      g.add(marca);
    }
    this.aguaTanque = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.97, r * 0.97, 1, 48),
      new THREE.MeshStandardMaterial({ color: COLOR.agua, roughness: 0.25, transparent: true, opacity: 0.82 }),
    );
    this.aguaTanque.position.set(0, base, 0);
    g.add(this.aguaTanque);
    this.indexar(g);
  }

  // ── Tuberías ──────────────────────────────────────────────────────────
  materialTubo() {
    return new THREE.MeshPhysicalMaterial({ color: COLOR.tubo, roughness: 0.2, transparent: true, opacity: 0.4, depthWrite: false });
  }

  construirAduccion() {
    const g = this.grupos.aduccion;
    g.children.slice().forEach((o) => { g.remove(o); liberar(o); });
    const r = this.radioTanque();
    const tope = 38 * VS + this.p.hMax * VS;
    const yB = alturaTerreno(X_BOMBA, 0) + 1.0;
    const pts = [
      new THREE.Vector3(X_RIO - 1, 1.0, 0),
      new THREE.Vector3(X_RIO + 3, 1.25, 0),
      new THREE.Vector3(X_RIO + 6.2, alturaTerreno(X_RIO + 6.2, 0) + 0.6, 0),
      new THREE.Vector3(X_BOMBA - 0.4, yB, 0),
      new THREE.Vector3(X_BOMBA + 2.6, yB, 0),
    ];
    for (let x = X_BOMBA + 4.5; x < -r - 2; x += 2) {
      pts.push(new THREE.Vector3(x, alturaTerreno(x, 0) + 0.5, 0));
    }
    pts.push(
      new THREE.Vector3(-r - 1.1, alturaTerreno(-r - 1.1, 0) + 0.6, 0),
      new THREE.Vector3(-r - 0.9, tope + 0.2, 0),
      new THREE.Vector3(-r - 0.4, tope + 0.8, 0),
      new THREE.Vector3(-r * 0.45, tope + 0.8, 0),
      new THREE.Vector3(-r * 0.4, tope - 0.2, 0),
    );
    this.curvaAduccion = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const rad = this.p.Daduccion * ESC_TUBO;
    const tubo = new THREE.Mesh(new THREE.TubeGeometry(this.curvaAduccion, 320, rad, 14, false), this.materialTubo());
    g.add(tubo);
    this.flujoAduccion.setCurva(this.curvaAduccion, Math.max(0.07, rad * 0.45));
    this.indexar(g);
  }

  alturaGrifoEscena() {
    return 7.2 + this.p.alturaGrifo;
  }

  construirDistribucion() {
    const g = this.grupos.distribucion;
    g.children.slice().forEach((o) => { g.remove(o); liberar(o); });
    const r = this.radioTanque();
    const base = 38 * VS;
    const zT = 0.6;
    const pts = [
      new THREE.Vector3(r * 0.5, base + 0.35, zT),
      new THREE.Vector3(r + 0.8, base + 0.35, zT),
      new THREE.Vector3(r + 2.0, alturaTerreno(r + 2.0, zT) + 0.4, zT),
    ];
    for (let x = r + 3.5; x < X_CASA - 5; x += 2) {
      pts.push(new THREE.Vector3(x, alturaTerreno(x, zT) + 0.45, zT));
    }
    const yC = alturaTerreno(X_CASA - 4, Z_FRENTE_CASA) + 0.35;
    const zP = Z_FRENTE_CASA + 0.45;
    pts.push(
      new THREE.Vector3(X_CASA - 4.4, yC, zT + 0.3),
      new THREE.Vector3(X_CASA - 3.8, yC, zP - 0.2),
      new THREE.Vector3(X_CASA - 3.3, yC, zP),
      new THREE.Vector3(X_GRIFO - 0.5, yC, zP),
      new THREE.Vector3(X_GRIFO - 0.05, yC + 0.3, zP),
      new THREE.Vector3(X_GRIFO, this.alturaGrifoEscena() - 0.35, zP),
      new THREE.Vector3(X_GRIFO, this.alturaGrifoEscena(), zP),
    );
    this.curvaDistribucion = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const rad = this.p.Ddistribucion * ESC_TUBO;
    const tubo = new THREE.Mesh(new THREE.TubeGeometry(this.curvaDistribucion, 320, rad, 14, false), this.materialTubo());
    g.add(tubo);
    this.flujoDistribucion.setCurva(this.curvaDistribucion, Math.max(0.06, rad * 0.45));
    this.indexar(g);
  }

  // ── Vivienda con grifo exterior ────────────────────────────────────────
  construirCasa() {
    const g = this.grupos.casa;
    g.children.slice().forEach((o) => { g.remove(o); liberar(o); });
    const y0 = 7.2;
    const alto = Math.max(3.0, this.p.alturaGrifo + 1.4);
    const pisos = alto > 4.5 ? 2 : 1;
    const losa = caja(7, 0.3, 6, COLOR.concreto);
    losa.position.set(X_CASA, y0 + 0.05, Z_CASA);
    const muros = caja(6, alto, 5, COLOR.muro);
    muros.position.set(X_CASA, y0 + 0.2 + alto / 2, Z_CASA);
    g.add(losa, muros);
    // Techo a dos aguas
    const forma = new THREE.Shape();
    forma.moveTo(-3.3, 0);
    forma.lineTo(3.3, 0);
    forma.lineTo(0, 1.7);
    forma.closePath();
    const techo = new THREE.Mesh(
      new THREE.ExtrudeGeometry(forma, { depth: 5.6, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: COLOR.techo, roughness: 0.8 }),
    );
    techo.rotation.y = Math.PI / 2;
    techo.position.set(X_CASA - 2.8, y0 + 0.2 + alto, Z_CASA);
    techo.castShadow = true;
    // ExtrudeGeometry crece en +z local; tras girar crece en +x: el techo va de x−2.8 a x+2.8
    g.add(techo);
    // Tanque elevado típico de las casas de la ciudad
    const tanquito = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.9, 20),
      new THREE.MeshStandardMaterial({ color: 0x2a2f31, roughness: 0.6 }),
    );
    tanquito.position.set(X_CASA + 1.4, y0 + 0.2 + alto + 1.1, Z_CASA - 1.2);
    tanquito.castShadow = true;
    g.add(tanquito);
    // Puerta y ventanas en la fachada
    const oscuro = 0x4e5d63;
    const puerta = caja(1.1, 2.1, 0.08, 0x7a5236);
    puerta.position.set(X_CASA + 1.2, y0 + 0.2 + 1.05, Z_FRENTE_CASA + 0.02);
    const ventana = caja(1.2, 1.0, 0.08, oscuro);
    ventana.position.set(X_CASA - 0.6, y0 + 0.2 + 1.6, Z_FRENTE_CASA + 0.02);
    g.add(puerta, ventana);
    if (pisos === 2) {
      for (const dx of [-1.6, 1.4]) {
        const v2 = caja(1.2, 1.0, 0.08, oscuro);
        v2.position.set(X_CASA + dx, y0 + 0.2 + alto - 1.4, Z_FRENTE_CASA + 0.02);
        g.add(v2);
      }
      const franja = caja(6.05, 0.12, 5.05, 0xd5c7ab);
      franja.position.set(X_CASA, y0 + 0.2 + alto / 2, Z_CASA);
      g.add(franja);
    }
    // Grifo: llave y boquilla apuntando hacia +z
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9c2c5, roughness: 0.3, metalness: 0.8 });
    const yG = this.alturaGrifoEscena();
    const zP = Z_FRENTE_CASA + 0.45;
    const boquilla = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 12), metal);
    boquilla.rotation.x = Math.PI / 2;
    boquilla.position.set(X_GRIFO, yG, zP + 0.2);
    const llave = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: COLOR.alerta, roughness: 0.5 }));
    llave.position.set(X_GRIFO, yG + 0.18, zP + 0.1);
    this.llave = llave;
    g.add(boquilla, llave);
    // Rejilla donde cae el chorro
    this.rejilla = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 20),
      new THREE.MeshStandardMaterial({ color: 0x3f4b50, roughness: 0.7 }),
    );
    this.rejilla.rotation.x = -Math.PI / 2;
    g.add(this.rejilla);
    this.salidaGrifo = new THREE.Vector3(X_GRIFO, yG, zP + 0.42);
    this.indexar(g);
  }

  // ── Arroyo canalizado ─────────────────────────────────────────────────
  construirCanal() {
    const g = this.grupos.canal;
    g.children.slice().forEach((o) => { g.remove(o); liberar(o); });
    const b = this.p.anchoCanal;
    const yD = M.tiranteDesdePerimetro(this.p.perimetro, b);
    const L = X_CANAL_FIN - X_CANAL_INI;
    const xm = (X_CANAL_INI + X_CANAL_FIN) / 2;
    const fondo = caja(L, 0.4, b + 0.7, COLOR.concreto);
    fondo.position.set(xm, PISO_CANAL - 0.2, Z_CANAL);
    g.add(fondo);
    for (const s of [-1, 1]) {
      const muro = caja(L, yD + 0.25, 0.3, COLOR.concreto);
      muro.position.set(xm, PISO_CANAL + (yD + 0.25) / 2, Z_CANAL + s * (b / 2 + 0.15));
      g.add(muro);
    }
    // Cabezal de entrada (alcantarilla)
    const cabezal = caja(1.0, yD + 1.2, b + 2.4, COLOR.concretoOsc);
    cabezal.position.set(X_CANAL_INI - 0.5, PISO_CANAL + (yD + 1.2) / 2, Z_CANAL);
    const boca = caja(0.2, Math.max(0.3, yD * 0.8), b * 0.9, 0x24323a);
    boca.position.set(X_CANAL_INI + 0.02, PISO_CANAL + Math.max(0.3, yD * 0.8) / 2, Z_CANAL);
    g.add(cabezal, boca);
    // Compuerta: dos columnas, viga y placa (la placa sube según el tirante del flujo)
    const acero = new THREE.MeshStandardMaterial({ color: COLOR.metal, roughness: 0.45, metalness: 0.5 });
    for (const s of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.35, yD + 2.4, 0.35), acero);
      col.position.set(X_CANAL_FIN, PISO_CANAL + (yD + 2.4) / 2, Z_CANAL + s * (b / 2 + 0.3));
      col.castShadow = true;
      g.add(col);
    }
    const viga = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, b + 1.0), acero);
    viga.position.set(X_CANAL_FIN, PISO_CANAL + yD + 2.4, Z_CANAL);
    viga.castShadow = true;
    this.placa = new THREE.Mesh(new THREE.BoxGeometry(0.14, yD + 0.6, b), new THREE.MeshStandardMaterial({ color: 0x6f7f84, roughness: 0.5, metalness: 0.4 }));
    this.placa.castShadow = true;
    g.add(viga, this.placa);
    // Agua dentro del canal y lámina de inundación
    this.aguaCanal = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: COLOR.agua, roughness: 0.25, transparent: true, opacity: 0.78 }),
    );
    this.aguaCanal.scale.set(L - 0.3, 0.01, b - 0.02);
    this.aguaCanal.position.set(xm, PISO_CANAL, Z_CANAL);
    this.inundacion = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0x5a8ea3, roughness: 0.3, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.inundacion.rotation.x = -Math.PI / 2;
    this.inundacion.visible = false;
    g.add(this.aguaCanal, this.inundacion);
    this.indexar(g);
    this.canalGeo = { b, yD, L, xm };
  }

  construirFosa() {
    const g = this.grupos.canal;
    const fosa = new THREE.Group();
    fosa.userData.fijo = true;
    const ancho = FOSA.x1 - FOSA.x0;
    const largo = FOSA.z1 - FOSA.z0;
    const alto = PISO_CANAL + 0.3 - FOSA.fondo;
    const xc = (FOSA.x0 + FOSA.x1) / 2;
    const zc = (FOSA.z0 + FOSA.z1) / 2;
    const yc = FOSA.fondo + alto / 2;
    const muros = [
      [ancho + 0.6, alto, 0.3, xc, yc, FOSA.z0 - 0.15],
      [ancho + 0.6, alto, 0.3, xc, yc, FOSA.z1 + 0.15],
      [0.3, alto, largo, FOSA.x1 + 0.15, yc, zc],
    ];
    for (const [w, h, d, x, y, z] of muros) {
      const m = caja(w, h, d, COLOR.concreto);
      m.position.set(x, y, z);
      fosa.add(m);
    }
    this.aguaFosa = new THREE.Mesh(
      new THREE.PlaneGeometry(ancho, largo),
      new THREE.MeshStandardMaterial({ color: COLOR.agua, roughness: 0.25, transparent: true, opacity: 0.85 }),
    );
    this.aguaFosa.rotation.x = -Math.PI / 2;
    this.aguaFosa.position.set(xc, PISO_CANAL - 1.5, zc);
    fosa.add(this.aguaFosa);
    // La fosa vive fuera del grupo del canal para no reconstruirse con él
    this.scene.add(fosa);
    fosa.userData.tab = 'arroyo';
    this.indexar(fosa);
    void g;
  }

  particulasCanal() {
    this.nCanal = 260;
    this.canalPart = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 5),
      new THREE.MeshBasicMaterial({ color: COLOR.aguaClara }),
      this.nCanal,
    );
    this.canalPart.frustumCulled = false;
    this.cpX = new Float32Array(this.nCanal).map(() => Math.random());
    this.cpY = new Float32Array(this.nCanal).map(() => Math.random());
    this.cpZ = new Float32Array(this.nCanal).map(() => Math.random() - 0.5);
    this.scene.add(this.canalPart);
  }

  // ── Línea piezométrica (energía disponible a lo largo del sistema) ─────
  lineaPiezometrica() {
    this.maxGuiones = 260;
    this.guiones = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.07, 0.07, 1, 6),
      new THREE.MeshBasicMaterial({ color: COLOR.piezo }),
      this.maxGuiones,
    );
    this.guiones.frustumCulled = false;
    this.guiones.count = 0;
    this.scene.add(this.guiones);
    this.clavePiezo = '';
  }

  dibujarPiezometrica(tramos) {
    const aux = new THREE.Object3D();
    const arriba = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (const [a, b] of tramos) {
      const dir = new THREE.Vector3().subVectors(b, a);
      const largo = dir.length();
      if (largo < 0.01) continue;
      dir.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(arriba, dir);
      const paso = 1.4;
      const guion = 0.8;
      for (let s = 0; s < largo && n < this.maxGuiones; s += paso) {
        const l = Math.min(guion, largo - s);
        aux.position.copy(a).addScaledVector(dir, s + l / 2);
        aux.quaternion.copy(q);
        aux.scale.set(1, l, 1);
        aux.updateMatrix();
        this.guiones.setMatrixAt(n++, aux.matrix);
      }
    }
    this.guiones.count = n;
    this.guiones.instanceMatrix.needsUpdate = true;
  }

  // ── Etiquetas ─────────────────────────────────────────────────────────
  crearEtiquetas() {
    const defs = [
      ['rio', 'captacion', 'Río (captación)'],
      ['bomba', 'captacion', 'Estación de bombeo'],
      ['aduccion', 'tuberias', 'Aducción'],
      ['tanque', 'tanque', 'Tanque de almacenamiento'],
      ['distribucion', 'tuberias', 'Distribución'],
      ['casa', 'vivienda', 'Vivienda'],
      ['canal', 'arroyo', 'Arroyo canalizado'],
      ['piezo', null, 'Línea piezométrica'],
    ];
    for (const [id, tab, titulo] of defs) {
      const el = document.createElement('div');
      const secundaria = ['rio', 'aduccion', 'distribucion', 'piezo'].includes(id);
      el.className = 'etiqueta3d' + (tab ? '' : ' piezo') + (secundaria ? ' secundaria' : '');
      el.innerHTML = `<b>${titulo}</b><span></span>`;
      if (tab) {
        el.dataset.tab = tab;
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.addEventListener('click', () => this.onSeleccion(tab));
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onSeleccion(tab); }
        });
      }
      const obj = new CSS2DObject(el);
      this.scene.add(obj);
      this.etiquetas[id] = { obj, el, valor: el.querySelector('span') };
    }
  }

  etiqueta(id, texto, nivel = 'ok', pos) {
    const e = this.etiquetas[id];
    if (!e) return;
    if (e.valor.textContent !== texto) e.valor.textContent = texto;
    if (e.el.dataset.nivel !== nivel) e.el.dataset.nivel = nivel;
    if (pos) e.obj.position.copy(pos);
  }

  seleccionar(tab) {
    this.tabActiva = tab;
    for (const { el } of Object.values(this.etiquetas)) {
      el.classList.toggle('activa', el.dataset.tab === tab);
    }
  }

  indexar(grupo) {
    this.seleccionables = this.seleccionables.filter((o) => {
      let p = o;
      while (p) { if (p === grupo) return false; p = p.parent; }
      return true;
    });
    grupo.traverse((o) => { if (o.isMesh) this.seleccionables.push(o); });
  }

  eventosSeleccion() {
    const ray = new THREE.Raycaster();
    const v = new THREE.Vector2();
    let inicio = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { inicio = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!inicio || Math.hypot(e.clientX - inicio[0], e.clientY - inicio[1]) > 5) return;
      const rect = el.getBoundingClientRect();
      v.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(v, this.camara);
      const hit = ray.intersectObjects(this.seleccionables, false)[0];
      if (!hit) return;
      let o = hit.object;
      while (o && !o.userData.tab) o = o.parent;
      if (o) this.onSeleccion(o.userData.tab);
    });
  }

  // ── Cámara y tamaño ───────────────────────────────────────────────────
  encuadrar() {
    this.controles.target.set(2, 9, 7);
    this.camara.position.set(-36, 52, 86);
    this.controles.update();
  }

  redimensionar() {
    const w = this.contenedor.clientWidth;
    const h = this.contenedor.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.etiquetador.setSize(w, h);
    this.camara.aspect = w / h;
    // En pantallas angostas se aleja la cámara para que quepa todo el sistema
    const lejos = this.camara.aspect < 1.3 ? 1.3 / this.camara.aspect : 1;
    if (this.lejosPrevio !== lejos) {
      const dir = new THREE.Vector3().subVectors(this.camara.position, this.controles.target);
      dir.multiplyScalar(lejos / (this.lejosPrevio || 1));
      this.camara.position.copy(this.controles.target).add(dir);
      this.lejosPrevio = lejos;
    }
    this.camara.updateProjectionMatrix();
  }

  // ── Actualización con los resultados del modelo ───────────────────────
  actualizar(p, r, nivel) {
    this.p = p;
    this.r = r;
    this.nivel = nivel;
    if (!this.listo) return;
    const k = (...a) => a.map((x) => Number(x).toFixed(4)).join('|');

    const kT = k(p.Dtanque, p.hMax);
    if (kT !== this.claves.tanque) { this.construirTanque(); this.claves.tanque = kT; }
    const kA = k(p.Daduccion, p.Dtanque, p.hMax);
    if (kA !== this.claves.aduccion) { this.construirAduccion(); this.claves.aduccion = kA; }
    const kC = k(p.alturaGrifo);
    if (kC !== this.claves.casa) { this.construirCasa(); this.claves.casa = kC; }
    const kD = k(p.Ddistribucion, p.Dtanque, p.alturaGrifo);
    if (kD !== this.claves.distribucion) { this.construirDistribucion(); this.claves.distribucion = kD; }
    const kK = k(p.perimetro, p.anchoCanal);
    if (kK !== this.claves.canal) { this.construirCanal(); this.claves.canal = kK; }

    // Tanque
    const base = 38 * VS;
    const hN = Math.max(0.001, nivel * VS);
    this.aguaTanque.scale.y = hN;
    this.aguaTanque.position.y = base + hN / 2;
    this.aguaTanque.visible = nivel > 0.005;

    // Arroyo
    const c = r.canal;
    const { b, yD, L, xm } = this.canalGeo;
    const yAgua = c.desborde ? yD : c.yFlujo;
    this.aguaCanal.scale.set(L - 0.3, Math.max(0.01, yAgua), b - 0.02);
    this.aguaCanal.position.y = PISO_CANAL + Math.max(0.01, yAgua) / 2;
    this.placa.position.set(X_CANAL_FIN - 0.05, PISO_CANAL + yAgua + (yD + 0.6) / 2, Z_CANAL);
    if (c.desborde) {
      const exceso = Math.min(3, (p.Qcrecida - c.Qcap) / Math.max(c.Qcap, 0.1));
      const ext = 2.5 + exceso * 6;
      this.inundacion.visible = true;
      this.inundacion.scale.set(L * 0.92, b + 0.6 + 2 * ext, 1);
      this.inundacion.position.set(xm - L * 0.03, PISO_CANAL + 0.5 + Math.min(0.35, exceso * 0.15), Z_CANAL);
    } else {
      this.inundacion.visible = false;
    }
    this.aguaFosa.position.y = PISO_CANAL - p.alturaCaida;

    // Chorros
    this.chorroGrifo.configurar({
      origen: this.salidaGrifo, dir: 'z', v: r.vGrifo, h: p.alturaGrifo, esc: 1,
      cantidad: Math.round(20 + 50 * Math.min(1, r.qGrifo * 1000 / 0.6)),
    });
    this.rejilla.position.set(X_GRIFO, 7.2 + 0.02, this.salidaGrifo.z + r.alcance);
    this.rejilla.visible = r.vGrifo > 0.01;
    this.llave.rotation.z = (1 - p.apertura) * 1.2;
    this.chorroCompuerta.configurar({
      origen: new THREE.Vector3(X_CANAL_FIN + 0.1, PISO_CANAL, Z_CANAL),
      dir: 'x', v: c.vCanal, h: p.alturaCaida, esc: 1, ancho: b * 0.95, espesor: yAgua,
      cantidad: Math.round(120 + 300 * Math.min(1, c.Qsale / 20)),
    });

    // Línea piezométrica: bombeo → superficie del tanque → vivienda
    const rT = this.radioTanque();
    const tope = Math.min(70, (p.cotaRio + r.alturaBombeo) * VS);
    const sup = (p.cotaTanque + nivel) * VS;
    const hCasa = Math.max(7.2, (p.cotaCasa + p.alturaGrifo + r.Hcasa) * VS);
    const clave = k(tope, sup, hCasa, rT);
    const yB = alturaTerreno(X_BOMBA, 0) + 1.0;
    if (clave !== this.clavePiezo) {
      const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
      this.dibujarPiezometrica([
        [V3(X_BOMBA + 2.6, yB, -0.01), V3(X_BOMBA + 2.6, tope, -0.01)],
        [V3(X_BOMBA + 2.6, tope, -0.01), V3(-rT - 0.6, sup, -0.01)],
        [V3(-rT - 0.6, sup, -0.01), V3(rT + 0.8, sup, 0.6)],
        [V3(rT + 0.8, sup, 0.6), V3(X_GRIFO, hCasa, Z_FRENTE_CASA + 0.45)],
        [V3(X_GRIFO, hCasa, Z_FRENTE_CASA + 0.45), V3(X_GRIFO, 7.2, Z_FRENTE_CASA + 0.45)],
      ]);
      this.clavePiezo = clave;
    }

    // Etiquetas
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const nivelCasa = r.estado === 'normal' ? 'ok' : (r.estado === 'baja-presion' ? 'aviso' : 'alerta');
    this.etiqueta('rio', `Cota ${fmt(p.cotaRio)} m`, 'ok', V(X_RIO, 4.6, -34));
    this.etiqueta('bomba', `${fmt(p.Qbombeo)} L/s, H = ${fmt(r.alturaBombeo)} m`, 'ok', V(X_BOMBA, alturaTerreno(X_BOMBA, 0) + 5.2, 0));
    this.etiqueta('aduccion', `V = ${fmt(r.aduccion.V)} m/s`, 'ok', V(-16, alturaTerreno(-16, 0) + 2.8, 0));
    const pct = (nivel / p.hMax) * 100;
    this.etiqueta('tanque', `${fmt(nivel)} m, ${fmt(r.volumen)} m³ (${fmt(pct, 0)} %)`, r.vacio ? 'alerta' : 'ok', V(0, base + p.hMax * VS + 2.6, 0));
    this.etiqueta('distribucion', `V = ${fmt(r.distribucion.V)} m/s`, 'ok', V(18, alturaTerreno(18, 0.6) + 2.6, 0.6));
    const textoCasa = r.Hcasa > 0 ? `${fmt(r.Hcasa)} m.c.a., ${fmt(r.qGrifo * 1000)} L/s` : 'Sin agua en el grifo';
    this.etiqueta('casa', textoCasa, nivelCasa, V(X_CASA, 7.2 + Math.max(3.0, p.alturaGrifo + 1.4) + 3.4, Z_CASA));
    const textoCanal = c.desborde ? `Desborde: ${fmt(p.Qcrecida)} > ${fmt(c.Qcap)} m³/s` : `${fmt(p.Qcrecida)} de ${fmt(c.Qcap)} m³/s`;
    this.etiqueta('canal', textoCanal, c.desborde ? 'alerta' : 'ok', V(12, PISO_CANAL + yD + 2.2, Z_CANAL));
    this.etiqueta('piezo', '', 'ok', V((rT + X_GRIFO) / 2 + 3, (sup + hCasa) / 2 + 1.6, 0.6));
  }

  // ── Bucle de animación ────────────────────────────────────────────────
  animar() {
    const dt = Math.min(0.05, this.reloj.getDelta());
    this.controles.update();
    if (this.r && this.p) {
      const r = this.r;
      this.texRio.offset.y -= dt * 0.08;
      this.texMar.offset.x += dt * 0.006;
      this.volante.rotation.x += dt * Math.min(30, r.Qin * 1000 * 0.9);
      this.flujoAduccion.paso(dt, r.Qin > 0 ? r.aduccion.V : 0);
      const vDist = r.Hcasa > 0 ? r.distribucion.V : 0;
      this.flujoDistribucion.paso(dt, vDist);
      this.chorroGrifo.paso(dt);
      this.chorroCompuerta.paso(dt);
      this.pasoCanal(dt);
    }
    this.renderer.render(this.scene, this.camara);
    this.etiquetador.render(this.scene, this.camara);
  }

  pasoCanal(dt) {
    const c = this.r.canal;
    const { b, yD, L } = this.canalGeo;
    const yAgua = c.desborde ? yD : c.yFlujo;
    const aux = new THREE.Object3D();
    const avance = (c.vCanal * VIS_FLUJO * 0.5 * dt) / L;
    const n = Math.round(this.nCanal * Math.min(1, 0.25 + c.Qsale / 15));
    this.canalPart.count = n;
    this.canalPart.visible = c.vCanal > 0.01;
    for (let i = 0; i < n; i++) {
      this.cpX[i] = (this.cpX[i] + avance * (0.8 + 0.4 * this.cpY[i])) % 1;
      aux.position.set(
        X_CANAL_INI + 0.3 + this.cpX[i] * (L - 0.6),
        PISO_CANAL + 0.05 + this.cpY[i] * Math.max(0.02, yAgua - 0.1),
        Z_CANAL + this.cpZ[i] * (b - 0.25),
      );
      aux.scale.setScalar(0.09);
      aux.updateMatrix();
      this.canalPart.setMatrixAt(i, aux.matrix);
    }
    this.canalPart.instanceMatrix.needsUpdate = true;
  }
}
