/**
 * modelo.js — Núcleo matemático del Simulador Hídrico 3D de Santa Marta
 * -----------------------------------------------------------------------
 * Solo funciones puras (sin DOM ni gráficos) para poder probarlas por
 * separado. Todas trabajan en unidades del SI internamente:
 *   caudal Q [m³/s], longitudes [m], presión [Pa], tiempo [s].
 * La interfaz convierte a L/s, kPa, horas, etc. con números decimales.
 *
 * Objetos matemáticos exigidos por la guía:
 *   1. Decimales  → redondear(), conversiones, cotas, áreas y volúmenes.
 *   2. Lineales   → perdidaLaminar() (Hagen-Poiseuille), nivelTanque(),
 *                   costoBombeo().
 *   3. Cuadráticas→ areaCanal() / seccionOptima() del canal trapezoidal
 *                   (vértice de la parábola),
 *                   trayectoriaChorro() / alcanceChorro(),
 *                   velocidadGrifo() (energía: H = (1+K)·v²/2g),
 *                   velocidadSedimentacion() (Stokes: vs = K·d²) y
 *                   velocidadLaminar() (perfil u(r) = 2V(1 − r²/R²)).
 */

// ── Constantes físicas: agua a 25 °C (clima cálido de Santa Marta) ──────────
export const G = 9.81;            // gravedad [m/s²]
export const RHO = 997.05;        // densidad del agua [kg/m³]
export const MU = 0.00089;        // viscosidad dinámica [Pa·s]
export const RE_LAMINAR = 2000;   // límite superior del régimen laminar
export const RE_TURBULENTO = 4000;// límite inferior del régimen turbulento
export const RUGOSIDAD_PVC = 0.0000015; // rugosidad absoluta del PVC [m]

// ═══════════════════════════════════════════════════════════════════════════
// 1. OPERACIONES CON DECIMALES
// ═══════════════════════════════════════════════════════════════════════════

/** Redondea a n decimales evitando errores de coma flotante (p. ej. 1.005). */
export function redondear(valor, decimales = 2) {
  const factor = 10 ** decimales;
  const signo = valor < 0 ? -1 : 1;
  return (signo * Math.round(Math.abs(valor) * factor + Number.EPSILON * factor)) / factor;
}

export const lpsAm3s = (q) => q / 1000;     // L/s  → m³/s
export const m3sAlps = (q) => q * 1000;     // m³/s → L/s
export const paAkPa = (p) => p / 1000;      // Pa   → kPa
export const mcaAkPa = (h) => (RHO * G * h) / 1000; // m.c.a. → kPa

/** Área de una sección circular A = π·D²/4 [m²]. */
export function areaCircular(D) {
  return (Math.PI * D * D) / 4;
}

/** Ecuación de continuidad V = Q / A [m/s]. */
export function velocidadMedia(Q, D) {
  return Q / areaCircular(D);
}

/** Despeje inverso de la continuidad Q = V·A [m³/s]. */
export function caudalDesdeVelocidad(V, D) {
  return V * areaCircular(D);
}

/** Número de Reynolds Re = ρ·V·D / μ (adimensional). */
export function reynolds(Q, D) {
  return (RHO * velocidadMedia(Q, D) * D) / MU;
}

export function regimen(Re) {
  if (Re < RE_LAMINAR) return 'laminar';
  if (Re < RE_TURBULENTO) return 'transición';
  return 'turbulento';
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. ECUACIONES LINEALES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pendiente de la recta de Hagen-Poiseuille: h_f = k·Q, con
 * k = 128·μ·L / (π·ρ·g·D⁴)   [s/m²]
 */
export function pendientePoiseuille(L, D) {
  return (128 * MU * L) / (Math.PI * RHO * G * D ** 4);
}

/** Pérdida de carga laminar h_f(Q) = k·Q (función lineal que pasa por el origen) [m]. */
export function perdidaLaminar(Q, L, D) {
  return pendientePoiseuille(L, D) * Q;
}

/**
 * Factor de fricción de Darcy. En laminar f = 64/Re (equivale exactamente a
 * Hagen-Poiseuille). En transición y turbulento se usa Swamee-Jain.
 */
export function factorFriccion(Re, D, rugosidad = RUGOSIDAD_PVC) {
  if (Re <= 0) return 0;
  if (Re < RE_LAMINAR) return 64 / Re;
  const t = Math.log10(rugosidad / (3.7 * D) + 5.74 / Re ** 0.9);
  return 0.25 / (t * t);
}

/** Pérdida por fricción de Darcy-Weisbach h_f = f·(L/D)·V²/2g [m]. */
export function perdidaDarcy(Q, L, D, rugosidad = RUGOSIDAD_PVC) {
  if (Q <= 0) return 0;
  const Re = reynolds(Q, D);
  const f = factorFriccion(Re, D, rugosidad);
  const V = velocidadMedia(Q, D);
  return (f * (L / D) * V * V) / (2 * G);
}

/**
 * Pérdida de fricción según el régimen real del flujo.
 * Devuelve ambas: la proyección lineal (laminar) y la usada en el balance.
 */
export function analisisTuberia(Q, L, D, rugosidad = RUGOSIDAD_PVC) {
  const V = Q > 0 ? velocidadMedia(Q, D) : 0;
  const Re = Q > 0 ? reynolds(Q, D) : 0;
  const tipo = regimen(Re);
  const hfLineal = perdidaLaminar(Q, L, D);
  const hfReal = tipo === 'laminar' ? hfLineal : perdidaDarcy(Q, L, D, rugosidad);
  return {
    V, Re, regimen: tipo,
    f: factorFriccion(Re, D, rugosidad),
    k: pendientePoiseuille(L, D),
    hfLineal, hfReal,
  };
}

/** Área de la base de un tanque cilíndrico [m²]. */
export function areaTanque(Dt) {
  return areaCircular(Dt);
}

/** Volumen exacto almacenado V = A·h [m³]. */
export function volumenTanque(Dt, h) {
  return areaTanque(Dt) * h;
}

/**
 * Balance de masa del tanque (lineal en t):
 *   h(t) = h₀ + ((Q_ent − Q_sal) / A)·t
 * pendiente m = (Q_ent − Q_sal)/A  [m/s], intercepto = h₀.
 */
export function nivelTanque(h0, Qent, Qsal, At, t) {
  return h0 + ((Qent - Qsal) / At) * t;
}

/** Tiempo para llegar a hObjetivo despejando la recta: t = (h − h₀)·A/(Q_ent − Q_sal). */
export function tiempoHastaNivel(h0, hObjetivo, Qent, Qsal, At) {
  const dQ = Qent - Qsal;
  if (dQ === 0) return Infinity;
  const t = ((hObjetivo - h0) * At) / dQ;
  return t >= 0 ? t : Infinity;
}

/** Volumen bombeado en un mes V = Q·horas·3600·días [m³]. */
export function volumenMensual(Q, horasDia, dias = 30) {
  return Q * horasDia * 3600 * dias;
}

/** Altura dinámica de bombeo: desnivel geométrico + pérdidas [m]. */
export function alturaBombeo(cotaRio, cotaFondoTanque, nivel, hf) {
  return cotaFondoTanque + nivel - cotaRio + hf;
}

/** Potencia hidráulica entregada al eje P = ρ·g·Q·H/η [W]. */
export function potenciaBomba(Q, H, eficiencia) {
  return (RHO * G * Q * H) / eficiencia;
}

/** Energía para elevar un volumen V a una altura H: E = ρ·g·H·V/(η·3.6×10⁶) [kWh]. */
export function energiaBombeo(V, H, eficiencia) {
  return (RHO * G * H * V) / (eficiencia * 3.6e6);
}

/**
 * Costo mensual de bombeo como función lineal del volumen:
 *   C(V) = m·V + b
 *   m = tarifa·ρ·g·H/(η·3.6×10⁶)  [COP/m³]   b = cargo fijo [COP]
 */
export function costoBombeo(V, H, eficiencia, tarifaKWh, cargoFijo) {
  const m = (tarifaKWh * RHO * G * H) / (eficiencia * 3.6e6);
  return { m, b: cargoFijo, costo: m * V + cargoFijo, energia: energiaBombeo(V, H, eficiencia) };
}

/** Carga de presión disponible en un nodo: cota de la lámina − cota del nodo − pérdidas [m.c.a.]. */
export function cargaDisponible(cotaFondoTanque, nivel, cotaNodo, hf) {
  return cotaFondoTanque + nivel - cotaNodo - hf;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. ECUACIONES CUADRÁTICAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resuelve a·x² + b·x + c = 0. Devuelve las raíces reales ordenadas y el
 * discriminante (Δ = b² − 4ac).
 */
export function resolverCuadratica(a, b, c) {
  if (a === 0) {
    if (b === 0) return { raices: [], discriminante: NaN };
    return { raices: [-c / b], discriminante: NaN };
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return { raices: [], discriminante: disc };
  if (disc === 0) return { raices: [-b / (2 * a)], discriminante: 0 };
  const r = Math.sqrt(disc);
  const x1 = (-b - r) / (2 * a);
  const x2 = (-b + r) / (2 * a);
  return { raices: [Math.min(x1, x2), Math.max(x1, x2)], discriminante: disc };
}

/** Vértice de y = a·x² + b·x + c. */
export function vertice(a, b, c) {
  const x = -b / (2 * a);
  return { x, y: a * x * x + b * x + c };
}

// ── Canal trapezoidal con perímetro mojado fijo ────────────────────────────
// Sección: fondo de ancho b, paredes inclinadas con talud z (z metros en
// horizontal por cada metro en vertical). z = 0 es el canal rectangular.
//   Perímetro mojado  P = b + 2y·√(1 + z²)
//   Área de flujo     A = (b + z·y)·y
//   Ancho superficial T = b + 2z·y

/** Factor de las paredes k = 2·√(1 + z²) (longitud de pared mojada por metro de tirante). */
export function factorParedes(z = 0) {
  return 2 * Math.sqrt(1 + z * z);
}

/** Tirante (profundidad) que deja un ancho b: y = (P − b) / (2√(1 + z²)) [m]. */
export function tiranteDesdePerimetro(P, b, z = 0) {
  return (P - b) / factorParedes(z);
}

/** Área de flujo de la sección trapezoidal A = (b + z·y)·y [m²]. */
export function areaTrapecio(b, y, z = 0) {
  return (b + z * y) * y;
}

/** Perímetro mojado P = b + 2y·√(1 + z²) [m]. */
export function perimetroTrapecio(b, y, z = 0) {
  return b + factorParedes(z) * y;
}

/** Ancho de la lámina de agua T = b + 2z·y [m]. */
export function anchoSuperficial(b, y, z = 0) {
  return b + 2 * z * y;
}

/**
 * Coeficientes de A(b) = a·b² + β·b + c con P y z fijos. Sustituyendo
 * y = (P − b)/k en A = b·y + z·y²  (k = 2√(1 + z²)):
 *   a = (z − k)/k²   β = P·(k − 2z)/k²   c = z·P²/k²
 * Como k > z, a < 0: la parábola abre hacia abajo y tiene un máximo.
 * Con z = 0 queda A(b) = −½b² + (P/2)b (canal rectangular).
 */
export function coeficientesAreaCanal(P, z = 0) {
  const k = factorParedes(z);
  return { a: (z - k) / (k * k), b: (P * (k - 2 * z)) / (k * k), c: (z * P * P) / (k * k) };
}

/** Área de flujo A(b) con perímetro P y talud z fijos [m²]. */
export function areaCanal(P, b, z = 0) {
  const k = coeficientesAreaCanal(P, z);
  return k.a * b * b + k.b * b + k.c;
}

/**
 * Sección óptima: vértice de la parábola A(b).
 *   b* = P·(k − 2z) / (2(k − z)),  y* = P / (2(k − z))  →  b*÷y* = 2(√(1+z²) − z)
 * Con z = 0: b = P/2, y = P/4, A_máx = P²/8.
 */
export function seccionOptima(P, z = 0) {
  const k = coeficientesAreaCanal(P, z);
  const v = vertice(k.a, k.b, k.c);
  return { b: v.x, y: tiranteDesdePerimetro(P, v.x, z), A: v.y };
}

/** Anchos que dan un área objetivo: raíces de a·b² + β·b + (c − A) = 0. */
export function anchosParaArea(P, Aobjetivo, z = 0) {
  const k = coeficientesAreaCanal(P, z);
  return resolverCuadratica(k.a, k.b, k.c - Aobjetivo).raices.filter((b) => b > 0 && b < P);
}

/** Ecuación de Manning Q = (1/n)·A·R^(2/3)·S^(1/2), con R = A/P [m³/s]. */
export function manning(A, Pm, S, n) {
  if (A <= 0 || Pm <= 0) return 0;
  return (1 / n) * A * Math.pow(A / Pm, 2 / 3) * Math.sqrt(S);
}

/** Caudal de un canal trapezoidal (fondo b, talud z) con tirante y. */
export function caudalCanal(b, y, S, n, z = 0) {
  return manning(areaTrapecio(b, y, z), perimetroTrapecio(b, y, z), S, n);
}

/** Tirante normal para un caudal dado (bisección sobre Manning, que crece con y). */
export function tiranteNormal(Q, b, S, n, z = 0, yMax = 50) {
  if (Q <= 0) return 0;
  let lo = 0;
  let hi = yMax;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (caudalCanal(b, mid, S, n, z) < Q) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── Chorro parabólico (lanzamiento horizontal) ─────────────────────────────

/** Coeficientes de y(x) = a·x² + 0·x + h₀, con a = −g/(2v²). */
export function coeficientesChorro(h0, v) {
  return { a: -G / (2 * v * v), b: 0, c: h0 };
}

/** Altura del chorro a la distancia horizontal x [m]. */
export function trayectoriaChorro(x, h0, v) {
  const k = coeficientesChorro(h0, v);
  return k.a * x * x + k.b * x + k.c;
}

/** Alcance: raíz positiva de −g/(2v²)·x² + h₀ = 0 → x = v·√(2h₀/g) [m]. */
export function alcanceChorro(h0, v) {
  if (v <= 0 || h0 <= 0) return 0;
  const k = coeficientesChorro(h0, v);
  const { raices } = resolverCuadratica(k.a, k.b, k.c);
  return Math.max(...raices);
}

// ── Velocidad de salida en el grifo (energía) ──────────────────────────────

/**
 * La carga disponible se reparte entre la energía cinética y la pérdida en la
 * llave:  H = (1 + K)·v²/(2g)  →  ((1+K)/2g)·v² − H = 0  (cuadrática en v).
 * K = K₀ / apertura²  (la llave más cerrada pierde más).
 */
export function velocidadGrifo(H, apertura, K0 = 10) {
  if (H <= 0 || apertura <= 0) return 0;
  const K = K0 / (apertura * apertura);
  const { raices } = resolverCuadratica((1 + K) / (2 * G), 0, -H);
  return Math.max(0, ...raices);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3b. CAPTACIÓN: DESARENADOR (ley de Stokes)
// ═══════════════════════════════════════════════════════════════════════════

export const RHO_ARENA = 2650;    // densidad de la arena (cuarzo) [kg/m³]

/** Velocidad horizontal en el desarenador Vh = Q/(B·h) [m/s]. */
export function velocidadHorizontal(Q, B, h) {
  return Q / (B * h);
}

/** Tiempo que tarda el agua en recorrer el desarenador t = L/Vh [s]. */
export function tiempoRetencion(L, Vh) {
  return Vh > 0 ? L / Vh : Infinity;
}

/**
 * Carga superficial q = Q/(B·L) [m/s]. Un grano se queda en el desarenador si cae
 * la profundidad h antes de recorrer la longitud L: vs ≥ h·Vh/L = Q/(B·L).
 * La profundidad se cancela: lo que retiene un desarenador depende de su área en planta.
 */
export function cargaSuperficial(Q, B, L) {
  return Q / (B * L);
}

/** Coeficiente de la ley de Stokes K = g(ρs − ρ)/(18μ) [1/(m·s)]. */
export function coeficienteStokes(rhoS = RHO_ARENA) {
  return (G * (rhoS - RHO)) / (18 * MU);
}

/** Ley de Stokes: velocidad de caída de un grano vs = K·d² (cuadrática en el diámetro) [m/s]. */
export function velocidadSedimentacion(d, rhoS = RHO_ARENA) {
  return coeficienteStokes(rhoS) * d * d;
}

/** Diámetro del grano más fino que se queda: raíz positiva de K·d² − q = 0 [m]. */
export function diametroMinimoRetenido(Q, B, L, rhoS = RHO_ARENA) {
  if (Q <= 0) return 0;
  const { raices } = resolverCuadratica(coeficienteStokes(rhoS), 0, -cargaSuperficial(Q, B, L));
  return Math.max(...raices);
}

/** Reynolds de la partícula Re_p = ρ·vs·d/μ; la ley de Stokes vale si Re_p < 1. */
export function reynoldsParticula(d, vs) {
  return (RHO * vs * d) / MU;
}

/** Clase del grano según la escala de Wentworth (d en metros). */
export function claseGrano(d) {
  const mm = d * 1000;
  if (mm < 0.0039) return 'arcilla';
  if (mm < 0.0625) return 'limo';
  if (mm < 0.125) return 'arena muy fina';
  if (mm < 0.25) return 'arena fina';
  if (mm < 0.5) return 'arena media';
  if (mm < 1) return 'arena gruesa';
  if (mm < 2) return 'arena muy gruesa';
  return 'grava';
}

// ═══════════════════════════════════════════════════════════════════════════
// 3c. RÉGIMEN DEL FLUJO: PERFILES LAMINAR Y TURBULENTO
// ═══════════════════════════════════════════════════════════════════════════

/** Reynolds con la velocidad media Re = ρ·V·D/μ. */
export function reynoldsVelocidad(V, D) {
  return (RHO * V * D) / MU;
}

/**
 * Perfil laminar de Hagen-Poiseuille: u(r) = 2V·(1 − r²/R²) = −(2V/R²)·r² + 2V.
 * Parábola que abre hacia abajo: vértice en el eje (u = 2V) y raíces en la pared (r = ±R).
 */
export function velocidadLaminar(r, R, V) {
  return 2 * V * (1 - (r / R) ** 2);
}

/** Velocidad en el eje de un perfil turbulento de potencia 1/n: umáx = V·(n+1)(2n+1)/(2n²). */
export function velocidadMaximaTurbulenta(V, n = 7) {
  return (V * (n + 1) * (2 * n + 1)) / (2 * n * n);
}

/** Perfil turbulento (ley de potencia 1/7): u(r) = umáx·(1 − |r|/R)^(1/n). Es casi plano en el centro. */
export function velocidadTurbulenta(r, R, V, n = 7) {
  return velocidadMaximaTurbulenta(V, n) * Math.pow(Math.max(0, 1 - Math.abs(r) / R), 1 / n);
}

// En canales abiertos el Reynolds se calcula con el radio hidráulico (Chow, 1994)
export const RE_CANAL_LAMINAR = 500;
export const RE_CANAL_TURBULENTO = 2000;

/** Reynolds de un canal abierto Re = ρ·V·R/μ, con R el radio hidráulico. */
export function reynoldsCanal(V, Rh) {
  return (RHO * V * Rh) / MU;
}

export function regimenCanal(Re) {
  if (Re < RE_CANAL_LAMINAR) return 'laminar';
  if (Re < RE_CANAL_TURBULENTO) return 'transición';
  return 'turbulento';
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. MODELO INTEGRADO DEL SISTEMA (río → bombeo → tanque → casa; arroyo)
// ═══════════════════════════════════════════════════════════════════════════

export const PARAMETROS_INICIALES = Object.freeze({
  // Cotas topográficas [m.s.n.m.]
  cotaRio: 2.5,
  cotaTanque: 38.0,
  cotaCasa: 12.0,
  alturaGrifo: 0.9,
  // Captación y aducción (río → tanque)
  Qbombeo: 12.5,          // L/s
  Daduccion: 0.15,        // m
  Laduccion: 850.0,       // m
  eficiencia: 0.7,
  horasDia: 18.0,
  tarifaKWh: 950.0,       // COP/kWh (valor de referencia editable)
  cargoFijo: 150000.0,    // COP/mes (valor de referencia editable)
  // Desarenador de la bocatoma
  desLongitud: 6.0,       // m
  desAncho: 1.0,          // m
  desProfundidad: 0.8,    // m (profundidad útil)
  // Tubo de vidrio del experimento de Reynolds (pestaña Tuberías)
  expTubo: 'vidrio',      // 'vidrio' | 'aduccion' | 'distribucion'
  expDiametro: 0.01,      // m
  expVelocidad: 0.1,      // m/s
  // Tanque
  Dtanque: 12.0,          // m
  hMax: 5.0,              // m
  // Distribución (tanque → casa)
  Qdemanda: 10.85,        // L/s del sector
  Ddistribucion: 0.1,     // m
  Ldistribucion: 620.0,   // m
  // Grifo
  apertura: 0.6,
  K0: 10.0,
  dBoquilla: 0.0127,      // m (½")
  presionMinima: 15.0,    // m.c.a. de referencia
  // Arroyo canalizado (sección trapezoidal)
  perimetro: 6.0,         // m
  anchoCanal: 2.4,        // m (ancho del fondo)
  taludCanal: 1.0,        // z: m horizontales por m vertical (1:1 → paredes a 45°)
  pendiente: 0.005,
  nManning: 0.015,
  Qcrecida: 8.0,          // m³/s
  alturaCaida: 1.5,       // m
});

/**
 * Calcula todas las métricas para un instante, dado el nivel actual del tanque.
 * p: parámetros (unidades de la interfaz: Q en L/s). nivel en m.
 */
export function calcularSistema(p, nivel) {
  const Qin = lpsAm3s(p.Qbombeo);
  const Qdem = lpsAm3s(p.Qdemanda);
  const At = areaTanque(p.Dtanque);

  // Si el tanque está vacío, solo sale lo que entra (déficit)
  const vacio = nivel <= 1e-6;
  const lleno = nivel >= p.hMax - 1e-6;
  const Qsal = vacio ? Math.min(Qdem, Qin) : Qdem;
  const Qent = lleno ? Math.min(Qin, Qsal) : Qin; // rebose
  const rebose = lleno && Qin > Qsal ? Qin - Qsal : 0;

  // Aducción
  const adu = analisisTuberia(Qin, p.Laduccion, p.Daduccion);
  const Hb = alturaBombeo(p.cotaRio, p.cotaTanque, nivel, adu.hfReal);
  const Vmes = volumenMensual(Qin, p.horasDia);
  const costo = costoBombeo(Vmes, Hb, p.eficiencia, p.tarifaKWh, p.cargoFijo);
  const potencia = potenciaBomba(Qin, Hb, p.eficiencia);

  // Distribución y grifo
  const dis = analisisTuberia(Qsal, p.Ldistribucion, p.Ddistribucion);
  const Hcasa = cargaDisponible(p.cotaTanque, nivel, p.cotaCasa + p.alturaGrifo, dis.hfReal);
  const vGrifo = velocidadGrifo(Hcasa, p.apertura, p.K0);
  const qGrifo = vGrifo * areaCircular(p.dBoquilla);
  const alcance = alcanceChorro(p.alturaGrifo, vGrifo);

  // Tanque (recta del nivel)
  const pendienteNivel = (Qent - Qsal) / At; // m/s
  const tLleno = tiempoHastaNivel(nivel, p.hMax, Qent, Qsal, At);
  const tVacio = tiempoHastaNivel(nivel, 0, Qent, Qsal, At);

  // Arroyo (canal trapezoidal)
  const zt = p.taludCanal ?? 0;
  const yDiseno = tiranteDesdePerimetro(p.perimetro, p.anchoCanal, zt);
  const Acanal = areaCanal(p.perimetro, p.anchoCanal, zt);
  const optimo = seccionOptima(p.perimetro, zt);
  const Tdiseno = anchoSuperficial(p.anchoCanal, yDiseno, zt);
  const Qcap = caudalCanal(p.anchoCanal, yDiseno, p.pendiente, p.nManning, zt);
  const QcapOptimo = caudalCanal(optimo.b, optimo.y, p.pendiente, p.nManning, zt);
  const yNormal = tiranteNormal(p.Qcrecida, p.anchoCanal, p.pendiente, p.nManning, zt);
  const desborde = p.Qcrecida > Qcap;
  const Qsale = Math.min(p.Qcrecida, Qcap);
  const yFlujo = Math.min(yNormal, yDiseno);
  const Aflujo = areaTrapecio(p.anchoCanal, yFlujo, zt);
  const vCanal = Aflujo > 0 ? Qsale / Aflujo : 0;
  const alcanceCompuerta = alcanceChorro(p.alturaCaida, vCanal);
  const Rflujo = yFlujo > 0 ? Aflujo / perimetroTrapecio(p.anchoCanal, yFlujo, zt) : 0;
  const ReCanal = reynoldsCanal(vCanal, Rflujo);

  // Desarenador: por él pasa todo el caudal bombeado
  const Vh = velocidadHorizontal(Qin, p.desAncho, p.desProfundidad);
  const qSup = cargaSuperficial(Qin, p.desAncho, p.desLongitud);
  const dMin = diametroMinimoRetenido(Qin, p.desAncho, p.desLongitud);
  const desarenador = {
    Vh, q: qSup, dMin,
    t: tiempoRetencion(p.desLongitud, Vh),
    K: coeficienteStokes(),
    Rep: reynoldsParticula(dMin, qSup),
    clase: claseGrano(dMin),
  };

  let estado = 'normal';
  if (Hcasa <= 0) estado = 'sin-agua';
  else if (vacio && Qdem > Qin) estado = 'deficit';
  else if (Hcasa < p.presionMinima) estado = 'baja-presion';

  return {
    Qin, Qsal, Qent, rebose, vacio, lleno, At,
    volumen: volumenTanque(p.Dtanque, nivel),
    volumenMax: volumenTanque(p.Dtanque, p.hMax),
    aduccion: adu, alturaBombeo: Hb, potencia, Vmes, costo,
    distribucion: dis, Hcasa, presionCasa: mcaAkPa(Math.max(0, Hcasa)),
    vGrifo, qGrifo, alcance, pendienteNivel, tLleno, tVacio,
    canal: {
      talud: zt, yDiseno, A: Acanal, Tdiseno, optimo, Qcap, QcapOptimo, yNormal, desborde,
      Qsale, yFlujo, Aflujo, vCanal, alcanceCompuerta, Rflujo, Re: ReCanal,
      regimen: regimenCanal(ReCanal),
      coef: coeficientesAreaCanal(p.perimetro, zt),
    },
    desarenador,
    estado,
  };
}

/** Avanza el nivel del tanque dt segundos usando la recta del balance, con límites físicos. */
export function avanzarNivel(p, nivel, dt) {
  const r = calcularSistema(p, nivel);
  const h = nivelTanque(nivel, r.Qent, r.Qsal, r.At, dt);
  return Math.min(p.hMax, Math.max(0, h));
}
