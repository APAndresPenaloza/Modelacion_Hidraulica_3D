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
// Red de distribución: entrada del barrio, calle de la principal (z = zP) y zona de los ramales
const RED = { xE: 21.5, zP: 4.3, x1: 23.5, x2: 45, zFin: -11.5 };
const Z_CANAL = 21;
const X_CANAL_INI = -22;
const X_CANAL_FIN = 44;
// El arroyo va excavado bajo la llanura urbana: el borde del canal queda a ras
// de la calle y el agua corre por debajo del nivel del terreno. La llanura queda
// a cota 4 m, apenas por encima del río (cota 2.50 m): el río corre casi lleno
// entre sus orillas y su lámina queda más alta que el fondo del canal.
const NIVEL_CALLE = 4.0 * VS;         // cota del terreno a lo largo del arroyo (escena)
const CORONA = NIVEL_CALLE + 0.1;     // borde superior del canal (bordillo del andén)
const BORDO_LIBRE = 0.3;              // altura libre sobre el tirante de diseño [m]
const ESPESOR = 0.35;                 // espesor del revestimiento de concreto [m]
const ANDEN = 2.2;                    // andén de concreto a cada lado del canal [m]
const MURO_FOSA = 1.3;                // espesor de los muros del pozo de disipación
const FOSA_X0 = X_CANAL_FIN;          // el canal descarga en el pozo
const FOSA_X1 = 55;
const X_COMPUERTA = X_CANAL_FIN - 1.4;

// ── Captación: bocatoma lateral → desarenador → pozo de succión ─────────────
// El interior está alineado con la malla del terreno (vértices en enteros) para
// que el borde del recorte quede escondido dentro de los muros de 1.1 de espesor.
const Y_RIO = 2.5 * VS;               // lámina del río (cota 2.50 m)
const CAP = {
  xi0: -35, xi1: -32,                 // interior (oeste → este)
  zi0: -12, zi1: -4,                  // interior (aguas arriba → aguas abajo)
  muro: 1.1,
  tope: 2.3,                          // corona de los muros (0.8 sobre el río: se ve el interior)
  base: -1.2,
  zRej0: -11.7, zRej1: -10.7,         // vano de la rejilla en el muro del río
  yRej0: 0.95, yRej1: 1.95,
  zDes0: -10.4, zDes1: -5.4,          // tramo del desarenador
  zVert: -5.4, eVert: 0.25,           // vertedero de salida
  pisoDes: -0.3, pisoPozo: -0.8,
  aguaDes: Y_RIO - 0.05,              // lámina en la entrada y el desarenador
  aguaPozo: Y_RIO - 0.25,             // lámina en el pozo de succión
  xSuc: -33.5, zSuc: -4.55,           // tubería de succión dentro del pozo
};
CAP.x0 = CAP.xi0 - CAP.muro; CAP.x1 = CAP.xi1 + CAP.muro;
CAP.z0 = CAP.zi0 - CAP.muro; CAP.z1 = CAP.zi1 + CAP.muro;
CAP.crestaVert = CAP.aguaDes - 0.12;

// Franja del río donde se mueven los trazadores de la corriente
const RIO = { x0: -46.0, x1: CAP.x0 - 0.4, z0: -55, z1: 72 };

function cortarCaptacion(x, z, y) {
  const e = 1e-6;
  if (x >= CAP.xi0 - e && x <= CAP.xi1 + e && z >= CAP.zi0 - e && z <= CAP.zi1 + e) return Math.min(y, CAP.base - 0.3);
  // Explanación alrededor de la estructura, un poco por debajo de la corona de los muros
  const m = 1.6;
  if (x > CAP.x0 - m && x < CAP.x1 + m && z > CAP.z0 - m && z < CAP.z1 + m) return Math.min(y, CAP.tope - 0.12);
  return y;
}

function dentroDeCaptacion(x, z) {
  return x > CAP.x0 && x < CAP.x1 && z > CAP.z0 && z < CAP.z1;
}

// Excavación vigente (la define construirCanal según la sección)
let CORTE = null;

/** Recorta el terreno donde va el canal, su cabezal y el pozo de disipación. */
function aplicarCorte(x, z, y) {
  const c = CORTE;
  const dz = Math.abs(z - Z_CANAL);
  if (x < X_CANAL_INI - 4 || x > FOSA_X1 + MURO_FOSA + 2 || dz > c.W + 1.5) return y;
  y = Math.min(y, NIVEL_CALLE);                       // explanación a nivel de la calle
  if (dz < c.W - 1.05) {
    if (x > X_CANAL_INI - 1.1 && x < FOSA_X0) y = Math.min(y, c.piso - ESPESOR - 0.4);
    if (x > FOSA_X0 - 2.4 && x < FOSA_X1 + 0.25) y = Math.min(y, c.fondo - 0.6);
  }
  return y;
}

function dentroDelCanal(x, z) {
  return CORTE && x > X_CANAL_INI - 2.4 && x < FOSA_X1 + MURO_FOSA && Math.abs(z - Z_CANAL) < CORTE.W;
}

/**
 * Perfil en U: bloque de concreto de semiancho W con un hueco trapezoidal
 * (fondo b en la cota piso, ancho Tc en la corona). u = coordenada transversal.
 */
function perfilCanal({ W, b, Tc, piso, base }) {
  const s = new THREE.Shape();
  s.moveTo(-W, CORONA);
  s.lineTo(-Tc / 2, CORONA);
  s.lineTo(-b / 2, piso);
  s.lineTo(b / 2, piso);
  s.lineTo(Tc / 2, CORONA);
  s.lineTo(W, CORONA);
  s.lineTo(W, base);
  s.lineTo(-W, base);
  s.closePath();
  return s;
}

/** Extruye un perfil transversal a lo largo del eje x, desde x0 con longitud L. */
function extruirEnX(forma, x0, L) {
  const geo = new THREE.ExtrudeGeometry(forma, { depth: L, bevelEnabled: false });
  geo.rotateY(Math.PI / 2); // z local (extrusión) → x del mundo; u → −z (perfil simétrico)
  geo.translate(x0, 0, Z_CANAL);
  return geo;
}

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
// La llanura queda a nivel de la calle, con orillas bajas a lado y lado del río
const LLANURA = [[-110, 3.6], [-54, 2.6], [-46.5, 2.0], [-44, 0.3], [-36, 0.3], [-33.5, 2.0], [-30, NIVEL_CALLE], [57, NIVEL_CALLE], [63, -1.5], [120, -1.5]];

export function alturaTerreno(x, z) {
  const a = interp(PERFIL, x);
  const b = interp(LLANURA, x);
  let y = a + (b - a) * suave((z - 5) / 11);
  // Estribaciones de la Sierra al fondo (sin tapar el cauce del río)
  const lejos = suave((-z - 14) / 34);
  const cauce = Math.exp(-(((x - X_RIO) / 7) ** 2));
  y += lejos * (1 - cauce) * (14 + 7 * Math.sin(x * 0.06 + 1.3) + 5 * Math.cos(x * 0.11 - z * 0.05));
  // Ondulación suave lejos de las estructuras
  const banda = Math.max(suave(1 - Math.max(0, Math.abs(z - Z_CANAL) - 8) / 6), 0.85 * suave(1 - Math.abs(z) / 6));
  y += (1 - banda) * 0.45 * Math.sin(x * 0.31 + z * 0.17) * Math.cos(z * 0.23 - x * 0.05);
  // Excavación del arroyo canalizado, del pozo de disipación y de la captación
  if (CORTE) y = aplicarCorte(x, z, y);
  return cortarCaptacion(x, z, y);
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

function caja2(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
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

/**
 * Intensidad visual de la turbulencia: 0 en laminar, sube suavemente en la
 * transición y vale 1 en régimen turbulento pleno.
 */
export function mezclaTurbulenta(Re, desde = M.RE_LAMINAR, hasta = M.RE_TURBULENTO) {
  return suave((Re - desde) / (hasta - desde));
}

/** Número aleatorio con media 0 y desviación ≈ 1 (suma de uniformes). */
function azar() {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 2;
}

const COLOR_TINTA = 0xe2572f;

// ── Partículas que recorren una curva (flujo dentro de una tubería) ────────
// Cada partícula ocupa un punto de la sección (radio relativo ρ y ángulo θ) y
// avanza con el perfil de velocidad del régimen: parábola en laminar
// (u = 2V(1 − ρ²)) y perfil plano 1/7 en turbulento, donde además se mezcla
// por la sección. Un hilo de tinta inyectado en el eje lo hace visible: sigue
// recto en laminar y se dispersa en turbulento, como en el experimento de Reynolds.
class FlujoTubo {
  constructor(padre, max = 560) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      max,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.aux = new THREE.Object3D();
    this.desv = new THREE.Vector3();
    this.beta = 1;
    padre.add(this.mesh);
  }

  setCurva(curva, radioTubo, radioParticula) {
    this.curva = curva;
    this.largo = curva.getLength();
    this.segmentos = 400;
    this.marcos = curva.computeFrenetFrames(this.segmentos, false);
    const n = (this.n = Math.min(this.max, Math.floor(this.largo / 0.3)));
    this.u = new Float32Array(n).map(() => Math.random());
    this.rho = new Float32Array(n).map(() => Math.sqrt(Math.random()) * 0.97);
    this.th = new Float32Array(n).map(() => Math.random() * Math.PI * 2);
    this.tinta = new Uint8Array(n).map(() => (Math.random() < 0.3 ? 1 : 0));
    const agua = new THREE.Color(COLOR.aguaClara);
    const tinta = new THREE.Color(COLOR_TINTA);
    for (let i = 0; i < n; i++) {
      if (this.tinta[i]) this.rho[i] = Math.random() * 0.08;
      this.mesh.setColorAt(i, this.tinta[i] ? tinta : agua);
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.radioUtil = Math.max(0, radioTubo - radioParticula);
    this.radio = radioParticula;
    this.mesh.count = n;
    this.paso(0, 1);
  }

  /** beta: 0 laminar → 1 turbulento (ver mezclaTurbulenta). */
  setRegimen(beta) {
    // Al pasar a laminar se inyecta tinta nueva en el eje, como al abrir la aguja
    if (beta < 0.05 && this.beta >= 0.05 && this.tinta) {
      for (let i = 0; i < this.n; i++) if (this.tinta[i]) this.rho[i] = Math.random() * 0.08;
    }
    this.beta = beta;
  }

  paso(dt, velocidad) {
    if (!this.curva) return;
    const visible = velocidad > 1e-5;
    this.mesh.visible = visible;
    if (!visible) return;
    const b = this.beta;
    // Velocidad de dibujo: proporcional a V, con un mínimo visible para flujos muy lentos
    const v = Math.min(velocidad, 4);
    const vVis = (v >= 0.25 ? v : 0.25 * Math.pow(v / 0.25, 0.35)) * VIS_FLUJO;
    const ruido = b * 1.7 * Math.sqrt(Math.max(dt, 0));   // caminata aleatoria en la sección
    const { tangents: T, normals: N, binormals: B } = this.marcos;
    const p = this.aux.position;
    for (let i = 0; i < this.n; i++) {
      let r = this.rho[i];
      const lam = 2 * (1 - r * r);
      const tur = 1.2245 * Math.pow(1 - Math.min(r, 0.999), 1 / 7);
      this.u[i] += (vVis * (lam * (1 - b) + tur * b) * dt) / this.largo;
      if (this.u[i] >= 1) {
        this.u[i] -= 1;
        if (this.tinta[i]) this.rho[i] = r = Math.random() * 0.08;  // la tinta se vuelve a inyectar en el eje
      }
      if (ruido > 0) {
        let a = r * Math.cos(this.th[i]) + ruido * azar();
        let c = r * Math.sin(this.th[i]) + ruido * azar();
        let rr = Math.hypot(a, c);
        if (rr > 0.97) { const k = (1.94 - rr) / rr; a *= k; c *= k; rr = Math.hypot(a, c); }
        this.rho[i] = r = rr;
        this.th[i] = Math.atan2(c, a);
      }
      this.curva.getPointAt(this.u[i], p);
      const k = Math.min(this.segmentos, Math.round(this.u[i] * this.segmentos));
      const off = r * this.radioUtil;
      this.desv.copy(N[k]).multiplyScalar(Math.cos(this.th[i]) * off).addScaledVector(B[k], Math.sin(this.th[i]) * off);
      p.add(this.desv);
      void T;
      this.aux.scale.setScalar(this.radio * (this.tinta[i] ? 1.15 : 1));
      this.aux.updateMatrix();
      this.mesh.setMatrixAt(i, this.aux.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ── Captación: agua y granos de arena que entran por la rejilla ─────────────
// El agua cruza la cámara de entrada, recorre el desarenador, rebosa por el
// vertedero al pozo de succión y entra a la coladera. Cada grano cae con su
// velocidad de Stokes: se queda si toca el fondo antes del vertedero.
const DIAMETROS_ARENA = [0.00003, 0.00006, 0.00012, 0.00025];   // m: limo, limo grueso, arena muy fina, arena fina
const COLORES_ARENA = [0x6e5a3c, 0x93703f, 0xbf8a3f, 0xe3b155];

class FlujoCaptacion {
  constructor(padre, nAgua = 90, porClase = 16) {
    this.nAgua = nAgua;
    this.nArena = porClase * DIAMETROS_ARENA.length;
    this.agua = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), new THREE.MeshBasicMaterial({ color: COLOR.aguaClara }), nAgua);
    this.arena = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.nArena);
    for (const m of [this.agua, this.arena]) { m.frustumCulled = false; padre.add(m); }
    this.clase = new Uint8Array(this.nArena).map((_, i) => i % DIAMETROS_ARENA.length);
    const col = new THREE.Color();
    for (let i = 0; i < this.nArena; i++) this.arena.setColorAt(i, col.setHex(COLORES_ARENA[this.clase[i]]));
    this.arena.instanceColor.needsUpdate = true;
    const n = nAgua + this.nArena;
    // Estado: fase (0 entrada, 1 desarenador, 2 vertedero, 3 pozo, 4 asentado), avance, posición
    this.fase = new Uint8Array(n);
    this.t = new Float32Array(n);
    this.s = new Float32Array(n);
    this.f = new Float32Array(n);
    this.x = new Float32Array(n);
    this.z0 = new Float32Array(n);
    this.prof = new Float32Array(n);
    for (let i = 0; i < n; i++) this.reiniciar(i, Math.random() * 3);
    this.aux = new THREE.Object3D();
    this.tPaso = 7;
    this.q = 1;
    this.activosAgua = nAgua;
  }

  reiniciar(i, retraso = 0) {
    this.fase[i] = 0;
    this.t[i] = -retraso;
    this.s[i] = 0;
    this.f[i] = Math.random() * 0.15;
    this.x[i] = CAP.xi0 + 0.25 + Math.random() * (CAP.xi1 - CAP.xi0 - 0.5);
    this.z0[i] = CAP.zRej0 + 0.1 + Math.random() * (CAP.zRej1 - CAP.zRej0 - 0.2);
    this.prof[i] = 0.05 + Math.random() * 0.5;
  }

  /** tPasoReal: tiempo de retención [s]; q: carga superficial [m/s]; Q: caudal [m³/s]. */
  configurar(tPasoReal, q, Q) {
    this.tPaso = Math.min(16, Math.max(2.2, 0.02 * tPasoReal));
    this.q = q;
    this.Q = Q;
    this.activosAgua = Math.round(this.nAgua * Math.min(1, 0.3 + Q / 0.03));
  }

  paso(dt) {
    const activo = this.Q > 0;
    this.agua.visible = this.arena.visible = activo;
    if (!activo) return;
    const p = this.aux.position;
    const lecho = CAP.pisoDes + 0.12;
    const total = this.nAgua + this.nArena;
    this.agua.count = this.activosAgua;
    for (let i = 0; i < total; i++) {
      const esArena = i >= this.nAgua;
      if (!esArena && i >= this.activosAgua) continue;
      this.t[i] += dt;
      if (this.t[i] < 0) { p.set(0, -50, 0); this.fijar(i, esArena, p); continue; }
      const ySup = CAP.aguaDes - 0.04;
      switch (this.fase[i]) {
        case 0: { // de la rejilla hacia el inicio del desarenador
          const a = Math.min(1, this.t[i] / 1.0);
          p.set(CAP.xi0 + (this.x[i] - CAP.xi0) * a, ySup - (esArena ? this.f[i] * 0.4 : this.prof[i]), this.z0[i] + (CAP.zDes0 - this.z0[i]) * a);
          if (a >= 1) { this.fase[i] = 1; this.t[i] = 0; }
          break;
        }
        case 1: { // recorrido del desarenador: avance horizontal y caída de Stokes
          this.s[i] += dt / this.tPaso;
          let y = ySup - this.prof[i];
          if (esArena) {
            const vs = M.velocidadSedimentacion(DIAMETROS_ARENA[this.clase[i - this.nAgua]]);
            this.f[i] += (dt / this.tPaso) * (vs / this.q);
            y = ySup - Math.min(1, this.f[i]) * (ySup - lecho);
            if (this.f[i] >= 1 && this.s[i] < 1) { this.fase[i] = 4; this.t[i] = 0; }
          }
          p.set(this.x[i], y, CAP.zDes0 + Math.min(1, this.s[i]) * (CAP.zVert - CAP.zDes0));
          if (this.fase[i] === 1 && this.s[i] >= 1) { this.fase[i] = 2; this.t[i] = 0; }
          break;
        }
        case 2: { // rebose sobre el vertedero
          const a = Math.min(1, this.t[i] / 0.5);
          p.set(this.x[i], CAP.crestaVert + 0.06 - a * a * 0.35, CAP.zVert + a * (CAP.eVert + 0.25));
          if (a >= 1) { this.fase[i] = 3; this.t[i] = 0; }
          break;
        }
        case 3: { // dentro del pozo, hacia la coladera
          const a = Math.min(1, this.t[i] / 1.3);
          const zA = CAP.zVert + CAP.eVert + 0.25;
          p.set(this.x[i] + (CAP.xSuc - this.x[i]) * a, CAP.aguaPozo - 0.25 - a * (CAP.aguaPozo - CAP.pisoPozo - 0.75), zA + (CAP.zSuc - zA) * a);
          if (a >= 1) this.reiniciar(i);
          break;
        }
        default: { // grano asentado en el lecho
          p.set(this.x[i], lecho, CAP.zDes0 + Math.min(1, this.s[i]) * (CAP.zVert - CAP.zDes0));
          if (this.t[i] > 1.4) this.reiniciar(i, Math.random() * 0.8);
        }
      }
      this.fijar(i, esArena, p);
    }
    this.agua.instanceMatrix.needsUpdate = true;
    this.arena.instanceMatrix.needsUpdate = true;
  }

  fijar(i, esArena, p) {
    if (esArena) {
      const k = i - this.nAgua;
      this.aux.scale.setScalar(0.05 + 0.018 * this.clase[k]);
      this.aux.updateMatrix();
      this.arena.setMatrixAt(k, this.aux.matrix);
    } else {
      this.aux.scale.setScalar(0.075);
      this.aux.updateMatrix();
      this.agua.setMatrixAt(i, this.aux.matrix);
    }
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
  constructor(contenedor, { onSeleccion, onCasa } = {}) {
    this.contenedor = contenedor;
    this.onSeleccion = onSeleccion || (() => {});
    this.onCasa = onCasa || (() => {});
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
      red: this.grupo('red'),
      casa: this.grupo('vivienda'),
      canal: this.grupo('arroyo'),
    };
    this.construirBomba();
    this.construirCaptacion();

    this.flujoAduccion = new FlujoTubo(this.scene);
    this.flujoDistribucion = new FlujoTubo(this.scene);
    this.flujoAcometida = new FlujoTubo(this.scene, 160);
    this.flujoCaptacion = new FlujoCaptacion(this.scene);
    this.particulasRio();
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
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    this.geoTerreno = geo;
    this.pintarTerreno();
    const malla = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
    malla.receiveShadow = true;
    this.scene.add(malla);
  }

  /** Recalcula alturas y colores del terreno (se repite cuando cambia la excavación del canal). */
  pintarTerreno() {
    const geo = this.geoTerreno;
    const pos = geo.attributes.position;
    const colores = geo.attributes.color.array;
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
      if (dentroDelCanal(x, z) || dentroDeCaptacion(x, z)) c.copy(concreto);
      const ruido = 0.94 + 0.06 * Math.sin(x * 1.7 + z * 2.3) * Math.cos(x * 0.9 - z * 1.3);
      colores[i * 3] = c.r * ruido;
      colores[i * 3 + 1] = c.g * ruido;
      colores[i * 3 + 2] = c.b * ruido;
    }
    pos.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
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

  // Corriente del río: trazadores que bajan desde la Sierra (+z), más rápidos en el
  // centro del cauce; los que pasan junto a la rejilla son captados por la bocatoma.
  particulasRio() {
    const n = (this.nRio = 300);
    this.rioPart = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xeaf7fb, transparent: true, opacity: 0.8 }),
      n,
    );
    this.rioPart.frustumCulled = false;
    this.rioX = new Float32Array(n);
    this.rioZ = new Float32Array(n);
    for (let i = 0; i < n; i++) this.nacerEnRio(i, true);
    this.scene.add(this.rioPart);
  }

  nacerEnRio(i, enCualquierParte = false) {
    this.rioX[i] = RIO.x0 + Math.random() * (RIO.x1 - RIO.x0);
    this.rioZ[i] = enCualquierParte ? RIO.z0 + Math.random() * (RIO.z1 - RIO.z0) : RIO.z0 + Math.random() * 6;
  }

  pasoRio(dt) {
    const aux = this.auxRio || (this.auxRio = new THREE.Object3D());
    const xc = (RIO.x0 + RIO.x1) / 2;
    const medio = (RIO.x1 - RIO.x0) / 2;
    const Q = this.r ? this.r.Qin : 0;
    // Franja junto a la orilla que alcanza a entrar por la rejilla (crece con el bombeo)
    const xCapta = CAP.x0 - 0.5 - 2.4 * Math.min(1, Q / 0.03);
    const zRej = (CAP.zRej0 + CAP.zRej1) / 2;
    const ruido = 0.9 * Math.sqrt(dt);
    for (let i = 0; i < this.nRio; i++) {
      let x = this.rioX[i];
      let z = this.rioZ[i];
      const s = (x - xc) / medio;
      const v = 2.4 * (0.35 + 0.65 * Math.max(0, 1 - s * s));
      if (Q > 0 && x > xCapta && z > zRej - 4.5 && z < zRej + 0.3) {
        // Atraída hacia el vano de la rejilla
        const dx = CAP.x0 - 0.12 - x;
        const dz = zRej - z;
        const d = Math.hypot(dx, dz) || 1;
        x += (dx / d) * 1.6 * dt;
        z += (dz / d) * 1.6 * dt + v * 0.25 * dt;
        if (d < 0.35) { this.nacerEnRio(i); continue; }
      } else {
        z += v * dt;
        x += ruido * azar() * 0.5;
        x = Math.min(RIO.x1, Math.max(RIO.x0, x));
      }
      if (z > RIO.z1) { this.nacerEnRio(i); continue; }
      this.rioX[i] = x;
      this.rioZ[i] = z;
      aux.position.set(x, Y_RIO + 0.03, z);
      aux.scale.set(0.09, 0.03, 0.22);
      aux.updateMatrix();
      this.rioPart.setMatrixAt(i, aux.matrix);
    }
    this.rioPart.instanceMatrix.needsUpdate = true;
  }

  // ── Captación y bombeo ────────────────────────────────────────────────
  construirBomba() {
    const g = this.grupos.bomba;
    const y0 = alturaTerreno(X_BOMBA, 0);
    // Plataforma de concreto apoyada en la orilla (su borde oeste baja hasta el terreno)
    const losa = caja(5.2, 2.1, 4.2, COLOR.concreto);
    losa.position.set(X_BOMBA, y0 + 0.35 - 1.05, 0);
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
    // Piloto de estado sobre el techo: verde encendida, rojo apagada
    this.luzBomba = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshStandardMaterial({ color: 0x2f7d5b, emissive: 0x2f7d5b, emissiveIntensity: 0.9 }));
    this.luzBomba.position.set(X_BOMBA, y0 + 4.0, 0);
    g.add(this.luzBomba);
  }

  /**
   * Bocatoma lateral: el agua del río entra por una rejilla, pasa al desarenador
   * (donde se asienta la arena), rebosa por un vertedero al pozo de succión y de
   * ahí la toma la bomba. Es estática; lo que cambia con el caudal son las partículas.
   */
  construirCaptacion() {
    const g = this.grupos.captacion = this.grupo('captacion');
    const concreto = new THREE.MeshStandardMaterial({ color: COLOR.concreto, roughness: 0.88 });
    const bloque = (x0, x1, y0, y1, z0, z1, material = concreto) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const C = CAP;
    // Muro del río con el vano de la rejilla
    bloque(C.x0, C.xi0, C.base, C.tope, C.z0, C.zRej0);
    bloque(C.x0, C.xi0, C.base, C.tope, C.zRej1, C.z1);
    bloque(C.x0, C.xi0, C.base, C.yRej0, C.zRej0, C.zRej1);
    bloque(C.x0, C.xi0, C.yRej1, C.tope, C.zRej0, C.zRej1);
    // Muros de la orilla, aguas arriba y aguas abajo
    bloque(C.xi1, C.x1, C.base, C.tope, C.z0, C.z1);
    bloque(C.xi0, C.xi1, C.base, C.tope, C.z0, C.zi0);
    bloque(C.xi0, C.xi1, C.base, C.tope, C.zi1, C.z1);
    // Fondos: cámara de entrada y desarenador, vertedero y pozo de succión (más hondo)
    bloque(C.xi0, C.xi1, C.base, C.pisoDes, C.zi0, C.zVert);
    bloque(C.xi0, C.xi1, C.base, C.crestaVert, C.zVert, C.zVert + C.eVert);
    bloque(C.xi0, C.xi1, C.base, C.pisoPozo, C.zVert + C.eVert, C.zi1);
    // Lecho de arena acumulada: más grueso al comienzo, donde caen los granos gruesos
    const arena = new THREE.MeshStandardMaterial({ color: 0xc8a46b, roughness: 1 });
    bloque(C.xi0 + 0.02, C.xi1 - 0.02, C.pisoDes, C.pisoDes + 0.16, C.zDes0, C.zDes0 + 1.8, arena);
    bloque(C.xi0 + 0.02, C.xi1 - 0.02, C.pisoDes, C.pisoDes + 0.07, C.zDes0 + 1.8, C.zVert - 0.02, arena);
    // Rejilla: marco y barrotes en la cara del río
    const acero = new THREE.MeshStandardMaterial({ color: COLOR.metal, roughness: 0.45, metalness: 0.55 });
    const xr = C.x0 - 0.03;
    bloque(xr - 0.04, xr + 0.04, C.yRej0 - 0.06, C.yRej0, C.zRej0, C.zRej1, acero);
    bloque(xr - 0.04, xr + 0.04, C.yRej1, C.yRej1 + 0.06, C.zRej0, C.zRej1, acero);
    for (let z = C.zRej0 + 0.06; z < C.zRej1 - 0.03; z += 0.11) {
      bloque(xr - 0.025, xr + 0.025, C.yRej0, C.yRej1, z - 0.018, z + 0.018, acero);
    }
    // Láminas de agua: en el vano, la entrada y el desarenador al nivel casi del río;
    // en el pozo, más abajo después del vertedero
    const agua = new THREE.MeshStandardMaterial({ color: COLOR.agua, roughness: 0.2, transparent: true, opacity: 0.34, depthWrite: false });
    const lamina = (x0, x1, z0, z1, y) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), agua);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      g.add(m);
    };
    lamina(C.x0, C.xi0, C.zRej0, C.zRej1, C.aguaDes);
    lamina(C.xi0, C.xi1, C.zi0, C.zVert, C.aguaDes);
    lamina(C.xi0, C.xi1, C.zVert + C.eVert, C.zi1, C.aguaPozo);
    // Barandas sobre los muros
    const yb = C.tope;
    for (const [x0, x1, z0, z1] of [[C.x0 + 0.3, C.x0 + 0.36, C.z0 + 0.3, C.z1 - 0.3], [C.x1 - 0.36, C.x1 - 0.3, C.z0 + 0.3, C.z1 - 0.3]]) {
      bloque(x0, x1, yb + 0.85, yb + 0.9, z0, z1, acero);
      for (let z = z0; z <= z1 + 1e-6; z += (z1 - z0) / 5) bloque(x0, x1, yb, yb + 0.9, z - 0.03, z + 0.03, acero);
    }
    this.indexar(g);
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
    // Interruptores de nivel: anillo y flotador de parada (rojo) y de arranque (verde)
    const anillo = (color) => {
      const grupo = new THREE.Group();
      const m = new THREE.Mesh(new THREE.TorusGeometry(r + 0.04, 0.06, 6, 48), new THREE.MeshBasicMaterial({ color }));
      m.rotation.x = Math.PI / 2;
      const flot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      flot.position.set(r * 0.75, 0, r * 0.4);
      grupo.add(m, flot);
      g.add(grupo);
      return grupo;
    };
    this.interruptorParada = anillo(0xc0422a);
    this.interruptorArranque = anillo(0x2f7d5b);
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
    // Tubería de succión: nace en la coladera, dentro del pozo, sube y entra a la bomba
    const ySuc = CAP.pisoPozo + 0.55;
    const pts = [
      new THREE.Vector3(CAP.xSuc, ySuc, CAP.zSuc),
      new THREE.Vector3(CAP.xSuc, CAP.aguaPozo, CAP.zSuc),
      new THREE.Vector3(CAP.xSuc, CAP.tope + 0.55, CAP.zSuc),
      new THREE.Vector3(CAP.xSuc + 0.15, yB - 0.12, CAP.zSuc + 0.75),
      new THREE.Vector3(CAP.xSuc + 0.6, yB, -2.0),
      new THREE.Vector3(X_BOMBA - 1.4, yB, -0.35),
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
    const tubo = new THREE.Mesh(new THREE.TubeGeometry(this.curvaAduccion, 360, rad, 14, false), this.materialTubo());
    g.add(tubo);
    // Coladera (válvula de pie) en la boca de la succión
    const coladera = new THREE.Mesh(
      new THREE.CylinderGeometry(rad * 1.7, rad * 1.7, 0.42, 18),
      new THREE.MeshStandardMaterial({ color: 0x3d4a50, roughness: 0.6, metalness: 0.4 }),
    );
    coladera.position.set(CAP.xSuc, ySuc - 0.15, CAP.zSuc);
    g.add(coladera);
    this.flujoAduccion.setCurva(this.curvaAduccion, rad, Math.max(0.045, rad * 0.24));
    this.indexar(g);
  }

  alturaGrifoEscena() {
    return this.cg.y0 + this.p.alturaGrifo;
  }

  // ── Trazado de la red en la escena (esquemático y comprimido) ──────────
  /** Posiciones de la red: principal hacia el este por la calle sur, ramales hacia el norte. */
  trazadoRed() {
    const N = Math.round(this.p.nRamales);
    const K = Math.round(this.p.nViviendas);
    const xR = (j) => RED.x1 + ((j - 0.5) / N) * (RED.x2 - RED.x1);
    const paso = (RED.zP - 1.6 - RED.zFin) / K;
    const zC = (k) => RED.zP - 1.6 - (k - 0.5) * paso;
    return { N, K, xR, zC, paso, ancho: Math.min(4.2, ((RED.x2 - RED.x1) / N) * 0.62), fondo: Math.min(3.4, paso * 0.78) };
  }

  /** Geometría de la vivienda de análisis (se recalcula al cambiar de vivienda o de diseño). */
  geometriaCasa() {
    const t = this.trazadoRed();
    const id = this.r?.casa?.id || '1-1';
    const [j, k] = id.split('-').map(Number);
    const x = t.xR(Math.min(j, t.N)) + 0.9 + t.ancho / 2;
    const z = t.zC(Math.min(k, t.K));
    const y0 = Math.max(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => alturaTerreno(x + (a * t.ancho) / 2, z + (b * t.fondo) / 2)));
    this.cg = { id, j, k, x, z, w: t.ancho, d: t.fondo, y0, frente: z + t.fondo / 2, xGrifo: x - t.ancho * 0.28 };
    return this.cg;
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
    for (let x = r + 3.5; x < RED.xE - 2.5; x += 2) pts.push(new THREE.Vector3(x, alturaTerreno(x, zT) + 0.45, zT));
    const yE = alturaTerreno(RED.xE, RED.zP) + 0.35;
    pts.push(
      new THREE.Vector3(RED.xE - 1.6, alturaTerreno(RED.xE - 1.6, zT + 1) + 0.4, zT + 0.6),
      new THREE.Vector3(RED.xE - 0.6, yE, RED.zP - 0.8),
      new THREE.Vector3(RED.xE, yE, RED.zP),
    );
    this.curvaDistribucion = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const rad = this.p.Ddistribucion * ESC_TUBO;
    g.add(new THREE.Mesh(new THREE.TubeGeometry(this.curvaDistribucion, 320, rad, 14, false), this.materialTubo()));
    this.flujoDistribucion.setCurva(this.curvaDistribucion, rad, Math.max(0.04, rad * 0.24));
    this.indexar(g);
  }

  /** Red de distribución: principal, ramales, válvulas, hidrante, acometidas, medidores y viviendas. */
  construirRed() {
    const g = this.grupos.red;
    g.children.slice().forEach((o) => { g.remove(o); liberar(o); });
    const p = this.p;
    const r = this.r;
    const t = this.trazadoRed();
    const e = r.especs;
    const yT = (x, z) => alturaTerreno(x, z) + 0.3;
    const tuboRecto = (a, b, rad, material) => {
      const curva = new THREE.LineCurve3(a, b);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curva, 8, rad, 10, false), material);
      g.add(m);
      return m;
    };
    const tuboPorTerreno = (x0, z0, x1, z1, rad, material, n = 12) => {
      const pts = Array.from({ length: n + 1 }, (_, i) => {
        const x = x0 + ((x1 - x0) * i) / n;
        const z = z0 + ((z1 - z0) * i) / n;
        return new THREE.Vector3(x, yT(x, z), z);
      });
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 4, rad, 10, false), material);
      g.add(m);
      return m;
    };
    const azul = new THREE.MeshStandardMaterial({ color: 0x2a78d6, roughness: 0.35, transparent: true, opacity: 0.85 });
    const azulApagado = new THREE.MeshStandardMaterial({ color: 0x8aa7b5, roughness: 0.6, transparent: true, opacity: 0.55 });
    const concreto = new THREE.MeshStandardMaterial({ color: COLOR.concreto, roughness: 0.9 });
    const metalAzul = new THREE.MeshStandardMaterial({ color: 0x1f5fb0, roughness: 0.4, metalness: 0.3 });
    const rP = Math.max(0.09, e.Principal.DE * ESC_TUBO);
    const rR = Math.max(0.07, e.Ramal.DE * ESC_TUBO);
    const rA = Math.max(0.035, e.Acometida.DE * ESC_TUBO);
    const xFin = t.xR(t.N) + (p.hidrante ? 3 : 0.5);
    // Principal por la calle
    tuboPorTerreno(RED.xE, RED.zP, xFin, RED.zP, rP, azul, 24);
    // Caja con válvula de compuerta
    const valvula = (x, z, cerrada = false, eje = 'x') => {
      const y = yT(x, z);
      const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 14), metalAzul);
      cuerpo.rotation.z = eje === 'x' ? Math.PI / 2 : 0;
      cuerpo.rotation.x = eje === 'z' ? Math.PI / 2 : 0;
      cuerpo.position.set(x, y, z);
      const vastago = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 8), metalAzul);
      vastago.position.set(x, y + 0.35, z);
      const volante = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 6, 18), new THREE.MeshStandardMaterial({ color: cerrada ? COLOR.alerta : 0x2a78d6, roughness: 0.4 }));
      volante.rotation.x = Math.PI / 2;
      volante.position.set(x, y + 0.62, z);
      g.add(cuerpo, vastago, volante);
      // caja de válvula: cuatro paredes de concreto
      const yb = alturaTerreno(x, z);
      for (const [dx, dz, w, d] of [[-0.5, 0, 0.1, 1.0], [0.5, 0, 0.1, 1.0], [0, -0.5, 1.0, 0.1], [0, 0.5, 1.0, 0.1]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), concreto);
        m.position.set(x + dx, yb + 0.1, z + dz);
        g.add(m);
      }
    };
    valvula(RED.xE + 1.2, RED.zP);
    // Ramales, acometidas, medidores y viviendas
    this.casasRed = [];
    for (let j = 1; j <= t.N; j++) {
      const x = t.xR(j);
      const cerrado = p.ramalCerrado === j;
      const zIni = RED.zP - 0.15;
      const zFin = t.zC(t.K) - t.paso * 0.4;
      tuboPorTerreno(x, zIni, x, zFin, rR, cerrado ? azulApagado : azul, 14);
      if (p.valvulasRamal) valvula(x, RED.zP - 1.0, cerrado, 'z');
      for (let k = 1; k <= t.K; k++) {
        const id = `${j}-${k}`;
        const z = t.zC(k);
        const xc = x + 0.9 + t.ancho / 2;
        const frente = z + t.fondo / 2;
        const yA = yT(x, frente + 0.35);
        // acometida: abrazadera de toma en el ramal → medidor → muro de la casa
        const abrazadera = new THREE.Mesh(new THREE.TorusGeometry(rR * 1.15, 0.03, 6, 14), metalAzul);
        abrazadera.rotation.y = Math.PI / 2;
        abrazadera.position.set(x, yA, frente + 0.35);
        g.add(abrazadera);
        const esAnalisis = this.cg && this.cg.id === id;
        if (!esAnalisis) {
          tuboRecto(new THREE.Vector3(x, yA, frente + 0.35), new THREE.Vector3(xc - t.ancho / 2 + 0.25, yA, frente + 0.35), rA, cerrado ? azulApagado : azul);
        }
        const caja = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.32), concreto);
        caja.position.set(x + 0.55, alturaTerreno(x + 0.55, frente + 0.35) + 0.12, frente + 0.35);
        const tapa = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.27), new THREE.MeshStandardMaterial({ color: 0x2b3236, roughness: 0.6 }));
        tapa.position.set(caja.position.x, caja.position.y + 0.165, caja.position.z);
        g.add(caja, tapa);
        if (esAnalisis) continue; // la vivienda de análisis tiene su propio modelo, con grifo
        const pr = r.redDiseno.casas.find((c) => c.id === id);
        const col = pr.cerrada ? 0x9aa3a6 : (pr.presion < p.presionMinima ? COLOR.alerta : (pr.presion < p.presionMinima + 3 ? 0xd9a43a : 0xeadfca));
        const y0 = alturaTerreno(xc, z);
        const alto = 2.2;
        const muros = caja2(t.ancho, alto, t.fondo, col);
        muros.position.set(xc, y0 + alto / 2, z);
        muros.userData.casa = id;
        const techo = caja2(t.ancho + 0.3, 0.25, t.fondo + 0.3, COLOR.techo);
        techo.position.set(xc, y0 + alto + 0.12, z);
        techo.userData.casa = id;
        const puerta = caja2(0.5, 1.1, 0.05, 0x7a5236);
        puerta.position.set(xc + t.ancho * 0.2, y0 + 0.55, frente + 0.03);
        g.add(muros, techo, puerta);
        this.casasRed.push(muros, techo);
      }
    }
    // Hidrante al final de la principal
    if (p.hidrante) {
      const x = t.xR(t.N) + 3;
      const y = alturaTerreno(x, RED.zP + 1.1);
      const rojo = new THREE.MeshStandardMaterial({ color: p.incendio ? 0xff3b1f : 0xc0322a, roughness: 0.45, emissive: p.incendio ? 0x661100 : 0x000000 });
      const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.1, 16), rojo);
      poste.position.set(x, y + 0.55, RED.zP + 1.1);
      const tapa = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), rojo);
      tapa.position.set(x, y + 1.1, RED.zP + 1.1);
      const boca = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 10), rojo);
      boca.rotation.x = Math.PI / 2;
      boca.position.set(x, y + 0.7, RED.zP + 1.1);
      g.add(poste, tapa, boca);
      tuboRecto(new THREE.Vector3(x, yT(x, RED.zP), RED.zP), new THREE.Vector3(x, yT(x, RED.zP), RED.zP + 1.1), rP * 0.8, azul);
      this.posHidrante = new THREE.Vector3(x, y + 0.7, RED.zP + 1.4);
    } else this.posHidrante = null;
    // Válvulas de aire (punto alto) y de purga (punto bajo)
    const posNodo = (n) => {
      if (!n) return null;
      if (n.tipo === 'casa') { const [j, k] = n.casa.split('-').map(Number); return [t.xR(j), t.zC(k)]; }
      if (n.id === 'HI') return [t.xR(t.N) + 3, RED.zP];
      if (n.id === 'E') return [RED.xE, RED.zP];
      return [t.xR(Number(n.id.slice(1))), RED.zP];
    };
    if (p.valvulaAire) {
      const [x, z] = posNodo(r.redDiseno.puntoAlto);
      const y = yT(x, z);
      const ventosa = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0x1f5fb0, roughness: 0.4 }));
      ventosa.position.set(x, y + 0.35, z);
      const domo = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshStandardMaterial({ color: 0x9fb4bf, roughness: 0.3, metalness: 0.5 }));
      domo.position.set(x, y + 0.65, z);
      g.add(ventosa, domo);
      this.posAire = new THREE.Vector3(x, y + 1.2, z);
    } else this.posAire = null;
    if (p.valvulaPurga) {
      const [x, z] = posNodo(r.redDiseno.puntoBajo);
      const y = yT(x, z);
      valvula(x + 0.6, z + 0.6, false, 'x');
      tuboRecto(new THREE.Vector3(x, y, z), new THREE.Vector3(x + 0.6, y, z + 0.6), rR * 0.7, azul);
      this.posPurga = new THREE.Vector3(x + 0.6, y + 1.0, z + 0.6);
    } else this.posPurga = null;
    this.indexar(g);
  }

  // ── Vivienda de análisis, con acometida, medidor y grifo exterior ──────
  construirCasa() {
    const g = this.grupos.casa;
    g.children.slice().forEach((o) => { g.remove(o); liberar(o); });
    const c = this.geometriaCasa();
    const t = this.trazadoRed();
    const { x: X, z: Z, w, d, y0 } = c;
    const alto = Math.max(2.6, this.p.alturaGrifo + 1.2);
    const pisos = alto > 4.5 ? 2 : 1;
    const losa = caja(w + 0.6, 0.3, d + 0.6, COLOR.concreto);
    losa.position.set(X, y0 + 0.05, Z);
    const muros = caja(w, alto, d, COLOR.muro);
    muros.position.set(X, y0 + 0.2 + alto / 2, Z);
    g.add(losa, muros);
    const forma = new THREE.Shape();
    forma.moveTo(-(w / 2 + 0.3), 0);
    forma.lineTo(w / 2 + 0.3, 0);
    forma.lineTo(0, Math.min(1.7, w * 0.4));
    forma.closePath();
    const techo = new THREE.Mesh(
      new THREE.ExtrudeGeometry(forma, { depth: d + 0.4, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: COLOR.techo, roughness: 0.8 }),
    );
    techo.position.set(X, y0 + 0.2 + alto, Z - (d + 0.4) / 2);
    techo.castShadow = true;
    g.add(techo);
    const tanquito = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.7, 20), new THREE.MeshStandardMaterial({ color: 0x2a2f31, roughness: 0.6 }));
    tanquito.position.set(X + w * 0.25, y0 + 0.2 + alto + 0.9, Z - d * 0.2);
    g.add(tanquito);
    const oscuro = 0x4e5d63;
    const puerta = caja(Math.min(1.0, w * 0.25), 2.0, 0.08, 0x7a5236);
    puerta.position.set(X + w * 0.25, y0 + 0.2 + 1.0, c.frente + 0.02);
    const ventana = caja(Math.min(1.1, w * 0.25), 0.9, 0.08, oscuro);
    ventana.position.set(X - w * 0.05, y0 + 0.2 + 1.5, c.frente + 0.02);
    g.add(puerta, ventana);
    if (pisos === 2) {
      const franja = caja(w + 0.05, 0.12, d + 0.05, 0xd5c7ab);
      franja.position.set(X, y0 + 0.2 + alto / 2, Z);
      g.add(franja);
    }
    // Acometida: ramal → abrazadera → medidor → llave de paso → subida al grifo
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9c2c5, roughness: 0.3, metalness: 0.8 });
    const yG = this.alturaGrifoEscena();
    const zP = c.frente + 0.45;
    const xRam = t.xR(c.j);
    const yA = alturaTerreno(xRam, c.frente + 0.35) + 0.3;
    const radAc = Math.max(0.05, this.r.especs.Acometida.DE * ESC_TUBO);
    const pts = [
      new THREE.Vector3(xRam, yA, c.frente + 0.35),
      new THREE.Vector3(xRam + 0.55, yA + 0.05, c.frente + 0.35),
      new THREE.Vector3(c.xGrifo - 0.5, yA + 0.05, zP),
      new THREE.Vector3(c.xGrifo - 0.05, yA + 0.3, zP),
      new THREE.Vector3(c.xGrifo, yG - 0.35, zP),
      new THREE.Vector3(c.xGrifo, yG, zP),
    ];
    this.curvaAcometida = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    g.add(new THREE.Mesh(new THREE.TubeGeometry(this.curvaAcometida, 120, radAc, 10, false), this.materialTubo()));
    this.flujoAcometida.setCurva(this.curvaAcometida, radAc, Math.max(0.03, radAc * 0.3));
    const medidor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 14), new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.4, metalness: 0.4 }));
    medidor.position.set(xRam + 0.55, yA + 0.12, c.frente + 0.35);
    const llavePaso = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: COLOR.alerta, roughness: 0.5 }));
    llavePaso.position.set(xRam + 1.0, yA + 0.2, (c.frente + 0.35 + zP) / 2);
    g.add(medidor, llavePaso);
    // Grifo: llave y boquilla apuntando hacia +z
    const boquilla = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 12), metal);
    boquilla.rotation.x = Math.PI / 2;
    boquilla.position.set(c.xGrifo, yG, zP + 0.2);
    const llave = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: COLOR.alerta, roughness: 0.5 }));
    llave.position.set(c.xGrifo, yG + 0.18, zP + 0.1);
    this.llave = llave;
    g.add(boquilla, llave);
    this.rejilla = new THREE.Mesh(new THREE.CircleGeometry(0.35, 20), new THREE.MeshStandardMaterial({ color: 0x3f4b50, roughness: 0.7 }));
    this.rejilla.rotation.x = -Math.PI / 2;
    g.add(this.rejilla);
    this.salidaGrifo = new THREE.Vector3(c.xGrifo, yG, zP + 0.42);
    this.indexar(g);
  }

  // ── Arroyo canalizado (sección trapezoidal excavada) ───────────────────
  construirCanal() {
    const g = this.grupos.canal;
    g.children.slice().forEach((o) => { g.remove(o); liberar(o); });
    const b = this.p.anchoCanal;
    const zt = this.p.taludCanal ?? 0;
    const yD = M.tiranteDesdePerimetro(this.p.perimetro, b, zt);
    const H = yD + BORDO_LIBRE;                    // profundidad total del canal
    const piso = CORONA - H;                       // cota del fondo
    const Tc = b + 2 * zt * H;                     // ancho en la corona
    const W = Tc / 2 + ANDEN;                      // semiancho total con andenes
    const hw = W - MURO_FOSA;                      // semiancho interior del pozo
    const fondo = piso - 4.6;                      // fondo del pozo (caída máx. 4 m)
    const L = FOSA_X0 - X_CANAL_INI;
    const xm = (X_CANAL_INI + FOSA_X0) / 2;
    const base = piso - ESPESOR;

    // Excavación del terreno según la nueva sección
    CORTE = { piso, fondo, W };
    this.pintarTerreno();

    const concreto = new THREE.MeshStandardMaterial({ color: COLOR.concreto, roughness: 0.88 });
    const sombra = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

    // Revestimiento de concreto: andenes + paredes inclinadas + losa de fondo
    const canal = sombra(new THREE.Mesh(extruirEnX(perfilCanal({ W, b, Tc, piso, base }), X_CANAL_INI, L), concreto));
    g.add(canal);

    // Cabezal de entrada: el arroyo sale de una alcantarilla bajo la calle
    const cabezal = caja(2.3, CORONA + 0.7 - (base - 0.5), 2 * W, COLOR.concretoOsc);
    cabezal.position.set(X_CANAL_INI - 1.15, (CORONA + 0.7 + base - 0.5) / 2, Z_CANAL);
    const hBoca = Math.max(0.3, Math.min(yD * 0.85, H - 0.1));
    const boca = caja(0.06, hBoca, Math.max(0.2, b * 0.9), 0x1f2a30);
    boca.position.set(X_CANAL_INI + 0.03, piso + hBoca / 2, Z_CANAL);
    g.add(cabezal, boca);

    // Barandas metálicas al borde de los andenes
    const acero = new THREE.MeshStandardMaterial({ color: COLOR.metal, roughness: 0.45, metalness: 0.5 });
    const xb0 = X_CANAL_INI + 0.4;
    const xb1 = X_COMPUERTA - 0.8;
    const nPostes = Math.floor((xb1 - xb0) / 2.5) + 1;
    const postes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), acero, nPostes * 2);
    const aux = new THREE.Object3D();
    let n = 0;
    for (const sgn of [-1, 1]) {
      const zb = Z_CANAL + sgn * (Tc / 2 + 0.3);
      for (let j = 0; j < nPostes; j++) {
        aux.position.set(xb0 + j * 2.5, CORONA + 0.5, zb);
        aux.updateMatrix();
        postes.setMatrixAt(n++, aux.matrix);
      }
      for (const hy of [0.95, 0.5]) {
        const riel = new THREE.Mesh(new THREE.BoxGeometry(xb1 - xb0, 0.05, 0.05), acero);
        riel.position.set((xb0 + xb1) / 2, CORONA + hy, zb);
        g.add(riel);
      }
    }
    postes.castShadow = true;
    g.add(postes);

    // Compuerta: columnas sobre los andenes, viga y placa que se levanta con el tirante
    const alturaMarco = H + 0.6;
    for (const sgn of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.35, alturaMarco + H, 0.35), acero);
      col.position.set(X_COMPUERTA, CORONA + (alturaMarco - H) / 2, Z_CANAL + sgn * (Tc / 2 + 0.2));
      col.castShadow = true;
      g.add(col);
    }
    const viga = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, Tc + 0.8), acero);
    viga.position.set(X_COMPUERTA, CORONA + alturaMarco, Z_CANAL);
    viga.castShadow = true;
    this.placa = new THREE.Mesh(new THREE.BoxGeometry(0.14, H + 0.3, Tc), new THREE.MeshStandardMaterial({ color: 0x6f7f84, roughness: 0.5, metalness: 0.4 }));
    this.placa.castShadow = true;
    g.add(viga, this.placa);

    // Pozo de disipación: muro de caída bajo el fondo del canal, muros laterales, muro final y losa
    const alto = CORONA - (fondo - 0.3);
    const yMuro = (CORONA + fondo - 0.3) / 2;
    const largo = FOSA_X1 - FOSA_X0;
    const piezas = [
      [MURO_FOSA, base + 0.02 - (fondo - 0.3), 2 * W, FOSA_X0 - MURO_FOSA / 2, (base + 0.02 + fondo - 0.3) / 2, Z_CANAL],
      [largo + MURO_FOSA, alto, MURO_FOSA, FOSA_X0 + (largo + MURO_FOSA) / 2, yMuro, Z_CANAL - hw - MURO_FOSA / 2],
      [largo + MURO_FOSA, alto, MURO_FOSA, FOSA_X0 + (largo + MURO_FOSA) / 2, yMuro, Z_CANAL + hw + MURO_FOSA / 2],
      [MURO_FOSA, alto, 2 * hw, FOSA_X1 + MURO_FOSA / 2, yMuro, Z_CANAL],
      [largo, 0.3, 2 * hw, (FOSA_X0 + FOSA_X1) / 2, fondo - 0.15, Z_CANAL],
    ];
    for (const [w, h, d, x, y, z] of piezas) {
      const m = caja(w, h, d, COLOR.concreto);
      m.position.set(x, y, z);
      g.add(m);
    }
    this.aguaFosa = new THREE.Mesh(
      new THREE.PlaneGeometry(largo, 2 * hw),
      new THREE.MeshStandardMaterial({ color: COLOR.agua, roughness: 0.25, transparent: true, opacity: 0.85 }),
    );
    this.aguaFosa.rotation.x = -Math.PI / 2;
    this.aguaFosa.position.set((FOSA_X0 + FOSA_X1) / 2, piso - 1.5, Z_CANAL);
    g.add(this.aguaFosa);

    // Agua dentro del canal (prisma trapezoidal que se rehace según el tirante) y lámina de inundación
    this.aguaCanal = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: COLOR.agua, roughness: 0.25, transparent: true, opacity: 0.8 }),
    );
    this.aguaCanal.receiveShadow = true;
    this.claveAgua = '';
    this.inundacion = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0x5a8ea3, roughness: 0.3, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.inundacion.rotation.x = -Math.PI / 2;
    this.inundacion.visible = false;
    g.add(this.aguaCanal, this.inundacion);
    this.indexar(g);
    this.canalGeo = { b, zt, yD, H, L, xm, piso, Tc, W, hw, fondo };
  }

  /** Prisma de agua con sección trapezoidal de tirante y (ligeramente separado de las paredes). */
  formaAgua(y) {
    const { b, zt, piso, L } = this.canalGeo;
    const h = Math.max(0.01, y);
    const sup = b / 2 + zt * h;
    const s = new THREE.Shape();
    s.moveTo(-b / 2 + 0.03, piso + 0.01);
    s.lineTo(b / 2 - 0.03, piso + 0.01);
    s.lineTo(sup - 0.03, piso + h);
    s.lineTo(-sup + 0.03, piso + h);
    s.closePath();
    this.aguaCanal.geometry.dispose();
    this.aguaCanal.geometry = extruirEnX(s, X_CANAL_INI + 0.1, L - 0.2);
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
      ['bocatoma', 'captacion', 'Bocatoma y desarenador'],
      ['bomba', 'captacion', 'Estación de bombeo'],
      ['aduccion', 'tuberias', 'Aducción'],
      ['tanque', 'tanque', 'Tanque de almacenamiento'],
      ['distribucion', 'tuberias', 'Conducción'],
      ['red', 'red', 'Red de distribución'],
      ['casa', 'vivienda', 'Vivienda de análisis'],
      ['canal', 'arroyo', 'Arroyo canalizado'],
      ['piezo', null, 'Línea piezométrica'],
    ];
    for (const [id, tab, titulo] of defs) {
      const el = document.createElement('div');
      const secundaria = ['rio', 'aduccion', 'distribucion', 'piezo', 'red'].includes(id);
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
      if (hit.object.userData.casa) { this.onCasa(hit.object.userData.casa); return; }
      let o = hit.object;
      while (o && !o.userData.tab) o = o.parent;
      if (o) this.onSeleccion(o.userData.tab);
    });
  }

  // ── Cámara y tamaño ───────────────────────────────────────────────────
  encuadrar() {
    this.controles.target.set(1, 8.5, 6);
    this.camara.position.set(-45, 60, 100);
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
    const kD = k(p.Ddistribucion, p.Dtanque);
    if (kD !== this.claves.distribucion) { this.construirDistribucion(); this.claves.distribucion = kD; }
    const kC = [k(p.alturaGrifo, p.nRamales, p.nViviendas), r.casa.id, r.especs.Acometida.DE].join('|');
    if (kC !== this.claves.casa) { this.construirCasa(); this.claves.casa = kC; this.claves.red = null; }
    const pres = r.redDiseno.casas.map((c) => (c.cerrada ? 'c' : (c.presion < p.presionMinima ? 'a' : (c.presion < p.presionMinima + 3 ? 'v' : 'o')))).join('');
    const kR = [p.nRamales, p.nViviendas, r.especs.Principal.DE, r.especs.Ramal.DE, r.especs.Acometida.DE, p.valvulasRamal, p.valvulaAire, p.valvulaPurga,
      p.hidrante, p.incendio, p.ramalCerrado, r.redDiseno.puntoAlto.id, r.redDiseno.puntoBajo.id, r.casa.id, pres].join('|');
    if (kR !== this.claves.red) { this.construirRed(); this.claves.red = kR; }
    const kK = k(p.perimetro, p.anchoCanal, p.taludCanal ?? 0);
    if (kK !== this.claves.canal) { this.construirCanal(); this.claves.canal = kK; }

    // Tanque
    const base = 38 * VS;
    const hN = Math.max(0.001, nivel * VS);
    this.aguaTanque.scale.y = hN;
    this.aguaTanque.position.y = base + hN / 2;
    this.aguaTanque.visible = nivel > 0.005;
    const auto = p.controlBomba === 'automatico';
    this.interruptorParada.visible = auto;
    this.interruptorArranque.visible = auto;
    this.interruptorParada.position.y = base + p.nivelParada * VS;
    this.interruptorArranque.position.y = base + p.nivelArranque * VS;
    const colorLuz = r.bomba ? 0x2f7d5b : 0xc0422a;
    this.luzBomba.material.color.setHex(colorLuz);
    this.luzBomba.material.emissive.setHex(colorLuz);

    // Arroyo
    const c = r.canal;
    const { b, zt, H, L, xm, piso, W } = this.canalGeo;
    const yAgua = c.desborde ? H : c.yFlujo;       // en desborde el agua llega a la corona
    const kAgua = k(yAgua);
    if (kAgua !== this.claveAgua) { this.formaAgua(yAgua); this.claveAgua = kAgua; }
    this.placa.position.set(X_COMPUERTA - 0.25, piso + yAgua + (H + 0.3) / 2, Z_CANAL);
    if (c.desborde) {
      const exceso = Math.min(3, (p.Qcrecida - c.Qcap) / Math.max(c.Qcap, 0.1));
      const ext = 2.5 + exceso * 6;
      this.inundacion.visible = true;
      this.inundacion.scale.set(L * 0.92, 2 * W + 2 * ext, 1);
      this.inundacion.position.set(xm - L * 0.03, CORONA + 0.06 + Math.min(0.35, exceso * 0.15), Z_CANAL);
    } else {
      this.inundacion.visible = false;
    }
    this.aguaFosa.position.y = piso - p.alturaCaida;

    // Chorros
    this.chorroGrifo.configurar({
      origen: this.salidaGrifo, dir: 'z', v: r.vGrifo, h: p.alturaGrifo, esc: 1,
      cantidad: Math.round(20 + 50 * Math.min(1, r.qGrifo * 1000 / 0.6)),
    });
    this.rejilla.position.set(this.cg.xGrifo, this.cg.y0 + 0.02, this.salidaGrifo.z + r.alcance);
    this.rejilla.visible = r.vGrifo > 0.01;
    this.llave.rotation.z = (1 - p.apertura) * 1.2;
    this.chorroCompuerta.configurar({
      origen: new THREE.Vector3(FOSA_X0 + 0.05, piso, Z_CANAL),
      dir: 'x', v: c.vCanal, h: p.alturaCaida, esc: 1, ancho: (b + zt * yAgua) * 0.95, espesor: yAgua,
      cantidad: Math.round(120 + 300 * Math.min(1, c.Qsale / 20)),
    });

    // Régimen del flujo en cada conducto y comportamiento del desarenador
    this.flujoAduccion.setRegimen(mezclaTurbulenta(r.aduccion.Re));
    this.flujoDistribucion.setRegimen(mezclaTurbulenta(r.distribucion.Re));
    this.flujoAcometida.setRegimen(mezclaTurbulenta(M.reynoldsVelocidad(r.grifo.vAc || 0, r.especs.Acometida.DI)));
    this.betaCanal = mezclaTurbulenta(c.Re, M.RE_CANAL_LAMINAR, M.RE_CANAL_TURBULENTO);
    const des = r.desarenador;
    this.flujoCaptacion.configurar(des.t, des.q, r.Qin);

    // Línea piezométrica: bombeo → superficie del tanque → vivienda
    const rT = this.radioTanque();
    const tope = Math.min(70, (p.cotaRio + r.alturaBombeo) * VS);
    const sup = (p.cotaTanque + nivel) * VS;
    const cg = this.cg;
    const yEnt = Math.max(alturaTerreno(RED.xE, RED.zP), r.Hentrada * VS);
    const yNodo = Math.max(cg.y0, r.casa.Hn * VS);
    const hCasa = Math.max(cg.y0, (r.casa.cota + p.alturaGrifo + r.Hcasa) * VS);
    const clave = k(tope, sup, hCasa, rT, yEnt, yNodo, cg.x, cg.z);
    const yB = alturaTerreno(X_BOMBA, 0) + 1.0;
    if (clave !== this.clavePiezo) {
      const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
      this.dibujarPiezometrica([
        [V3(X_BOMBA + 2.6, yB, -0.01), V3(X_BOMBA + 2.6, tope, -0.01)],
        [V3(X_BOMBA + 2.6, tope, -0.01), V3(-rT - 0.6, sup, -0.01)],
        [V3(-rT - 0.6, sup, -0.01), V3(rT + 0.8, sup, 0.6)],
        [V3(rT + 0.8, sup, 0.6), V3(RED.xE, yEnt, RED.zP)],
        [V3(RED.xE, yEnt, RED.zP), V3(cg.x - cg.w / 2 - 0.9, yNodo, cg.frente + 0.35)],
        [V3(cg.x - cg.w / 2 - 0.9, yNodo, cg.frente + 0.35), V3(cg.xGrifo, hCasa, cg.frente + 0.45)],
        [V3(cg.xGrifo, hCasa, cg.frente + 0.45), V3(cg.xGrifo, cg.y0, cg.frente + 0.45)],
      ]);
      this.clavePiezo = clave;
    }

    // Etiquetas
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const nivelCasa = r.estado === 'normal' ? 'ok' : (r.estado === 'baja-presion' ? 'aviso' : 'alerta');
    this.etiqueta('rio', `Cota ${fmt(p.cotaRio)} m`, 'ok', V(X_RIO - 1, 3.2, 14));
    this.etiqueta('bomba', r.bomba ? `Encendida: ${fmt(p.Qbombeo)} L/s, H = ${fmt(r.alturaBombeo)} m` : `Apagada: tanque lleno (arranca a ${fmt(p.nivelArranque)} m)`, r.bomba ? 'ok' : 'aviso', V(X_BOMBA, alturaTerreno(X_BOMBA, 0) + 5.6, 0));
    const textoBocatoma = r.Qin > 0 ? `Retiene granos ≥ ${fmt(des.dMin * 1000, 3)} mm` : 'Sin caudal';
    this.etiqueta('bocatoma', textoBocatoma, 'ok', V(-34, 8, -19));
    this.etiqueta('aduccion', r.bomba ? `V = ${fmt(r.aduccion.V)} m/s · ${r.aduccion.regimen}` : 'Sin flujo: bomba apagada', r.bomba ? 'ok' : 'aviso', V(-16, alturaTerreno(-16, 0) + 2.8, 0));
    const pct = (nivel / p.hMax) * 100;
    const tendencia = r.pendienteNivel > 1e-7 ? 'subiendo' : (r.pendienteNivel < -1e-7 ? 'bajando' : 'estable');
    this.etiqueta('tanque', `${fmt(nivel)} m, ${fmt(r.volumen)} m³ (${fmt(pct, 0)} %), ${tendencia}`, r.vacio ? 'alerta' : 'ok', V(0, base + p.hMax * VS + 2.6, 0));
    this.etiqueta('distribucion', `V = ${fmt(r.distribucion.V)} m/s · ${r.distribucion.regimen}`, 'ok', V(15, alturaTerreno(15, 0.6) + 2.6, 0.6));
    const rd = r.redDiseno;
    this.etiqueta('red', `${rd.N * rd.K} viviendas · presión mín. ${fmt(r.red.presionMin, 1)} m.c.a.`, rd.presionMin < p.presionMinima ? 'alerta' : 'ok', V((RED.xE + RED.x2) / 2, alturaTerreno(34, RED.zP) + 2.4, RED.zP + 1.5));
    const textoCasa = r.Hcasa > 0 ? `${fmt(r.Hcasa)} m.c.a., ${fmt(r.qGrifo * 1000)} L/s` : 'Sin agua en el grifo';
    this.etiqueta('casa', `${r.casa.id} · ${textoCasa}`, nivelCasa, V(cg.x, cg.y0 + Math.max(2.6, p.alturaGrifo + 1.2) + 2.6, cg.z));
    const textoCanal = c.desborde ? `Desborde: ${fmt(p.Qcrecida)} > ${fmt(c.Qcap)} m³/s` : `${fmt(p.Qcrecida)} de ${fmt(c.Qcap)} m³/s`;
    this.etiqueta('canal', textoCanal, c.desborde ? 'alerta' : 'ok', V(12, CORONA + 2.6, Z_CANAL));
    this.etiqueta('piezo', '', 'ok', V((rT + RED.xE) / 2, (sup + yEnt) / 2 + 1.6, 0.6));
  }

  // ── Bucle de animación ────────────────────────────────────────────────
  animar() {
    const dt = Math.min(0.05, this.reloj.getDelta());
    this.controles.update();
    if (this.r && this.p) {
      const r = this.r;
      this.texRio.offset.y += dt * 0.08;               // el río baja de la Sierra hacia +z
      this.texMar.offset.x += dt * 0.006;
      this.volante.rotation.x += dt * Math.min(30, r.Qin * 1000 * 0.9);
      this.pasoRio(dt);
      this.flujoCaptacion.paso(dt);
      this.flujoAduccion.paso(dt, r.Qin > 0 ? r.aduccion.V : 0);
      this.flujoDistribucion.paso(dt, r.Qsal > 0 ? r.distribucion.V : 0);
      this.flujoAcometida.paso(dt, r.Hcasa > 0 ? r.grifo.vAc || 0 : 0);
      this.chorroGrifo.paso(dt);
      this.chorroCompuerta.paso(dt);
      this.pasoCanal(dt);
    }
    this.renderer.render(this.scene, this.camara);
    this.etiquetador.render(this.scene, this.camara);
  }

  pasoCanal(dt) {
    const c = this.r.canal;
    const { b, zt, H, L, piso } = this.canalGeo;
    const yAgua = c.desborde ? H : c.yFlujo;
    const aux = new THREE.Object3D();
    const avance = (c.vCanal * VIS_FLUJO * 0.5 * dt) / L;
    const n = Math.round(this.nCanal * Math.min(1, 0.25 + c.Qsale / 15));
    this.canalPart.count = n;
    this.canalPart.visible = c.vCanal > 0.01;
    // En régimen turbulento las partículas se mezclan en la vertical y a lo ancho
    const ruido = (this.betaCanal ?? 1) * 0.5 * Math.sqrt(dt);
    for (let i = 0; i < n; i++) {
      this.cpX[i] = (this.cpX[i] + avance * (0.75 + 0.5 * Math.sqrt(this.cpY[i]))) % 1;
      if (ruido > 0) {
        this.cpY[i] = Math.min(1, Math.abs(this.cpY[i] + ruido * azar() * 0.6));
        this.cpZ[i] = Math.max(-0.5, Math.min(0.5, this.cpZ[i] + ruido * azar() * 0.4));
      }
      const h = 0.05 + this.cpY[i] * Math.max(0.02, yAgua - 0.1);
      const ancho = b + 2 * zt * h;                 // ancho del trapecio a esa altura
      aux.position.set(
        X_CANAL_INI + 0.3 + this.cpX[i] * (L - 0.6),
        piso + h,
        Z_CANAL + this.cpZ[i] * Math.max(0.05, ancho - 0.3),
      );
      aux.scale.setScalar(0.09);
      aux.updateMatrix();
      this.canalPart.setMatrixAt(i, aux.matrix);
    }
    this.canalPart.instanceMatrix.needsUpdate = true;
  }
}
