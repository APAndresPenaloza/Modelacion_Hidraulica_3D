/**
 * bombas.js — Diseño de las estaciones de bombeo (acueducto y riego).
 * -----------------------------------------------------------------------
 *  1. Potencias: hidráulica o útil P_h = ρ·g·Q·H, al freno (en el eje)
 *     P_b = P_h/η_b y eléctrica, la real que se paga, P_e = P_b/η_m.
 *  2. Motor comercial, la capacidad instalada: el tamaño en HP que cubre la
 *     potencia al freno más un margen de seguridad, con su eficiencia.
 *  3. Tipos de bomba y su campo de aplicación: caudal, altura, número de etapas
 *     y velocidad específica n_q = n·√Q / H^0.75.
 *  4. Curva de N bombas en paralelo H = H₀ − a·(Q/N)² y curva del sistema
 *     H = H_est + K·Q²: el punto de operación es su intersección (cuadrática).
 *  5. Succión: NPSH disponible y requerido (cavitación).
 * Funciones puras, sin DOM. Los valores de los catálogos son de referencia:
 * en un diseño real se toman las curvas del fabricante.
 */
import * as M from './modelo.js';
import * as R from './rio.js';

// ═══════════════════════════════════════════════════════════════════════════
// 1. TIPOS DE BOMBA Y SU CAMPO DE APLICACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Q: caudal por bomba [L/s]; H: altura total [m]; nq: velocidad específica por
 * etapa y por ojo del rodete; eta: eficiencias típicas en el punto óptimo; ojos: 2
 * en la de doble succión; sumergida: trabaja bajo el agua (sin succión);
 * hEtapa: altura por etapa a 3500 rpm en las de varias etapas [m];
 * rH0: altura a válvula cerrada / altura de diseño (forma de la curva).
 */
export const TIPOS_BOMBA = {
  centrifuga: {
    nombre: 'Centrífuga horizontal de succión axial', corto: 'Centrífuga horizontal',
    Q: [0.3, 250], H: [5, 140], nq: [10, 60], eta: [0.55, 0.85], ojos: 1, sumergida: false, hEtapa: null, rH0: 1.25,
    uso: 'La más usada en acueductos pequeños y en riego: económica y fácil de mantener. Trabaja por encima del agua, así que hay que cebarla.',
  },
  partida: {
    nombre: 'Carcasa partida de doble succión', corto: 'Carcasa partida',
    Q: [25, 3000], H: [10, 200], nq: [12, 70], eta: [0.75, 0.91], ojos: 2, sumergida: false, hEtapa: null, rH0: 1.2,
    uso: 'Para caudales grandes: el agua entra al rodete por los dos lados, lo que baja el NPSH requerido. Muy eficiente y de larga vida.',
  },
  multietapa: {
    nombre: 'Multietapa horizontal', corto: 'Multietapa',
    Q: [0.3, 120], H: [30, 600], nq: [8, 35], eta: [0.5, 0.8], ojos: 1, sumergida: false, hEtapa: 45, rH0: 1.3,
    uso: 'Varios rodetes en serie sobre un mismo eje: cada etapa suma altura. Para alturas grandes con caudales pequeños o medianos.',
  },
  turbina: {
    nombre: 'Turbina vertical de pozo húmedo', corto: 'Turbina vertical',
    Q: [5, 2000], H: [5, 300], nq: [25, 160], eta: [0.7, 0.88], ojos: 1, sumergida: true, hEtapa: 20, rH0: 1.45,
    uso: 'Los tazones con los rodetes quedan sumergidos en el pozo y el motor arriba, en seco: buena para tomas de río con nivel variable.',
  },
  sumergible: {
    nombre: 'Electrobomba sumergible (pozo o cárcamo)', corto: 'Sumergible',
    Q: [0.2, 150], H: [5, 400], nq: [15, 70], eta: [0.5, 0.78], ojos: 1, sumergida: true, hEtapa: 25, rH0: 1.35,
    uso: 'Motor y bomba van bajo el agua: no se ceba ni cavita por succión. Es la de los pozos profundos; para revisarla hay que sacarla.',
  },
  axial: {
    nombre: 'Flujo axial (hélice)', corto: 'Flujo axial',
    Q: [200, 20000], H: [0.5, 15], nq: [140, 400], eta: [0.7, 0.88], ojos: 1, sumergida: true, hEtapa: null, rH0: 2.2,
    uso: 'Mucho caudal con poca altura: drenaje, distritos de riego y control de inundaciones.',
  },
};
/** Orden de preferencia para recomendar un tipo (de lo más sencillo a lo más especial). */
export const ORDEN_TIPOS = ['centrifuga', 'partida', 'multietapa', 'turbina', 'sumergible', 'axial'];

/** Velocidades de los motores de inducción a 60 Hz. */
export const VELOCIDADES = [
  { valor: 3500, nombre: '3500 rpm (motor de 2 polos)' },
  { valor: 1750, nombre: '1750 rpm (motor de 4 polos)' },
  { valor: 1160, nombre: '1160 rpm (motor de 6 polos)' },
];
export const polosDe = (rpm) => (rpm >= 3000 ? 2 : (rpm >= 1500 ? 4 : 6));

/** Sumergencia de las bombas que trabajan bajo el agua [m]. */
export const SUMERGENCIA = 1.5;

// ═══════════════════════════════════════════════════════════════════════════
// 2. MOTOR COMERCIAL: CAPACIDAD INSTALADA Y EFICIENCIA
// ═══════════════════════════════════════════════════════════════════════════

export const W_POR_HP = 745.7;
export const HP_COMERCIALES = [0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300];
/**
 * Eficiencia a plena carga de motores de alta eficiencia (referencia NEMA Premium,
 * motor cerrado con ventilador) por número de polos; los de menos de 1 HP son
 * aproximados.
 */
const ETA_MOTOR = {
  2: [0.68, 0.72, 0.77, 0.84, 0.855, 0.865, 0.885, 0.895, 0.902, 0.91, 0.91, 0.917, 0.917, 0.924, 0.93, 0.936, 0.936, 0.941, 0.95, 0.95, 0.954, 0.958, 0.958],
  4: [0.72, 0.75, 0.855, 0.865, 0.865, 0.895, 0.895, 0.917, 0.917, 0.924, 0.93, 0.936, 0.936, 0.941, 0.945, 0.95, 0.954, 0.954, 0.954, 0.958, 0.962, 0.962, 0.962],
  6: [0.7, 0.74, 0.825, 0.875, 0.885, 0.895, 0.895, 0.91, 0.91, 0.917, 0.917, 0.93, 0.93, 0.941, 0.941, 0.945, 0.945, 0.95, 0.95, 0.958, 0.958, 0.958, 0.958],
};

/** Margen de seguridad del motor sobre la potencia al freno (regla práctica usual). */
export function margenMotor(hpFreno) {
  if (hpFreno <= 2) return 0.5;
  if (hpFreno <= 5) return 0.3;
  if (hpFreno <= 10) return 0.2;
  if (hpFreno <= 20) return 0.15;
  return 0.1;
}

/** Motor comercial para una potencia al freno PbW [W]: el primero que cubre P_b·(1 + margen). */
export function motorComercial(PbW, rpm) {
  const polos = polosDe(rpm);
  const hpFreno = PbW / W_POR_HP;
  const margen = margenMotor(hpFreno);
  const hpMin = hpFreno * (1 + margen);
  let k = HP_COMERCIALES.findIndex((h) => h >= hpMin - 1e-9);
  const fuera = k < 0;
  if (fuera) k = HP_COMERCIALES.length - 1;
  const hp = HP_COMERCIALES[k];
  return { polos, hpFreno, margen, hpMin, hp, kW: (hp * W_POR_HP) / 1000, W: hp * W_POR_HP, eta: ETA_MOTOR[polos][k], fuera };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. SUCCIÓN: NPSH Y VELOCIDAD ESPECÍFICA
// ═══════════════════════════════════════════════════════════════════════════

/** Presión de vapor del agua [kPa] a T [°C] (ecuación de Tetens). */
export const presionVapor = (T) => 0.61078 * Math.exp((17.27 * T) / (T + 237.3));

/** Carga de la atmósfera menos la de vapor (P_atm − P_v)/(ρg) [m] en un sitio. */
export function cargaAtmosferica(elevacion, T) {
  const Patm = R.presionAtm(elevacion);
  const Pv = presionVapor(T);
  return { Patm, Pv, carga: ((Patm - Pv) * 1000) / (M.RHO * M.G) };
}

/** Velocidad específica de succión de referencia S = n·√Q/NPSH_r^0.75 (n en rpm, Q en m³/s). */
export const S_SUCCION = 180;

/** NPSH requerido [m] = (n·√(q/ojos)/S)^(4/3). */
export function npshRequerido(rpm, q, ojos = 1) {
  return ((rpm * Math.sqrt(Math.max(0, q) / ojos)) / S_SUCCION) ** (4 / 3);
}

/** Velocidad específica n_q = n·√q / H^0.75 (n en rpm, q en m³/s por ojo, H en m por etapa). */
export const velocidadEspecifica = (rpm, q, H) => (H > 0 ? (rpm * Math.sqrt(Math.max(0, q))) / H ** 0.75 : Infinity);

/** Forma del rodete según la velocidad específica. */
export const claseRodete = (nq) => (nq < 40 ? 'radial' : (nq < 160 ? 'de flujo mixto' : 'axial'));

/** Etapas necesarias: la altura por etapa crece con el cuadrado de la velocidad. */
export function numeroEtapas(tipo, rpm, H) {
  if (!tipo.hEtapa) return 1;
  const hEtapa = tipo.hEtapa * (rpm / 3500) ** 2;
  return Math.max(1, Math.ceil(H / hEtapa - 1e-9));
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. CURVAS Y PUNTO DE OPERACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/** Altura de N bombas iguales en paralelo con el caudal total Q: H = H₀ − a·(Q/N)². */
export const alturaBomba = (c, Q) => c.H0 - c.a * (Q / c.N) ** 2;
/** Curva del sistema: H = H_est + K·Q². */
export const alturaSistema = (c, Q, Hest) => Hest + c.K * Q * Q;
/** Eficiencia fuera del punto óptimo: η = η_d·x·(2 − x), con x = q/q_d. */
export function eficienciaEn(c, Q) {
  const x = Q / c.N / c.qd;
  return Math.max(0, c.etaD * x * (2 - x));
}
/** Potencia al freno de una bomba [W] con el caudal total Q: P = ρ·g·H(Q)·q_d/(η_d·(2 − x)). */
export function potenciaFrenoEn(c, Q) {
  const x = Q / c.N / c.qd;
  return x >= 2 ? Infinity : (M.RHO * M.G * alturaBomba(c, Q) * c.qd) / (c.etaD * (2 - x));
}
/**
 * Punto de operación: H₀ − a·(Q/N)² = H_est + K·Q²  ⇒  Q = √((H₀ − H_est)/(a/N² + K)).
 * Si la bomba no supera la altura estática, no entrega agua.
 */
export function puntoOperacion(c, Hest) {
  if (c.H0 <= Hest) return { Q: 0, H: Hest, x: 0 };
  const Q = Math.sqrt((c.H0 - Hest) / (c.a / c.N ** 2 + c.K));
  return { Q, H: alturaSistema(c, Q, Hest), x: Q / c.N / c.qd };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. DISEÑO DE UNA ESTACIÓN DE BOMBEO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * cfg: {
 *   Q: caudal de diseño total [m³/s]; Hest: altura estática de diseño [m];
 *   HestMin, HestMax: rango de la altura estática al operar [m] (opcional);
 *   hf: pérdidas por fricción con Q [m]; tipo; rpm; N: bombas en paralelo;
 *   reserva: hay una bomba de reserva; etaB: eficiencia de la bomba;
 *   succion: { elevacion [m.s.n.m.], T [°C], zs: eje sobre el agua [m], hfs: pérdida en la succión [m] }
 * }
 * La bomba se elige para que su punto óptimo coincida con el de diseño.
 */
export function disenarBomba(cfg) {
  const tipoId = TIPOS_BOMBA[cfg.tipo] ? cfg.tipo : 'centrifuga';
  const tipo = TIPOS_BOMBA[tipoId];
  const N = Math.max(1, Math.round(cfg.N ?? 1));
  const Q = Math.max(1e-6, cfg.Q);
  const qd = Q / N;
  const H = cfg.Hest + cfg.hf;
  const etapas = numeroEtapas(tipo, cfg.rpm, H);
  const nq = velocidadEspecifica(cfg.rpm, qd / tipo.ojos, H / etapas);
  const c = { N, qd, etaD: cfg.etaB, H0: tipo.rH0 * H, a: ((tipo.rH0 - 1) * H) / (qd * qd), K: cfg.hf / (Q * Q) };
  const HestMin = cfg.HestMin ?? cfg.Hest;
  const HestMax = cfg.HestMax ?? cfg.Hest;
  const opDis = puntoOperacion(c, cfg.Hest);
  const opMax = puntoOperacion(c, HestMin);      // menos altura estática: más caudal
  const opMin = puntoOperacion(c, HestMax);
  // Potencias (W): hidráulica, al freno y eléctrica
  const Ph = M.RHO * M.G * Q * H;
  const Pb = Ph / cfg.etaB;
  const Pb1 = Pb / N;
  const Pb1max = Math.max(Pb1, potenciaFrenoEn(c, opMax.Q), potenciaFrenoEn(c, opMin.Q));
  const motor = motorComercial(Pb1max, cfg.rpm);
  const Pe1 = Pb1 / motor.eta;
  const unidades = N + (cfg.reserva ? 1 : 0);
  // Succión
  const at = cargaAtmosferica(cfg.succion.elevacion, cfg.succion.T);
  const zs = tipo.sumergida ? -SUMERGENCIA : cfg.succion.zs;
  const hfs = tipo.sumergida ? 0 : cfg.succion.hfs;
  const NPSHd = at.carga - zs - hfs;
  const NPSHr = npshRequerido(cfg.rpm, qd, tipo.ojos);
  return {
    tipoId, tipo, rpm: cfg.rpm, N, reserva: Boolean(cfg.reserva), unidades,
    Q, qd, Hest: cfg.Hest, HestMin, HestMax, hf: cfg.hf, H, etaB: cfg.etaB,
    etapas, nq, clase: claseRodete(nq), curva: c, opDis, opMin, opMax,
    Ph, Pb, Pb1, Pb1max, Pe: Pe1 * N, Pe1, motor,
    factorCarga: Pb1 / motor.W,
    instaladaW: unidades * motor.W,
    etaGlobal: cfg.etaB * motor.eta,
    succion: { ...at, zs, hfs, NPSHd, NPSHr, margen: NPSHr > 0 ? NPSHd / NPSHr : Infinity, sumergida: tipo.sumergida },
  };
}

/** Qué tipos de bomba sirven para el punto de diseño (mismo cfg que disenarBomba). */
export function aptitudTipos(cfg) {
  const N = Math.max(1, Math.round(cfg.N ?? 1));
  const qd = Math.max(1e-6, cfg.Q) / N;
  const H = cfg.Hest + cfg.hf;
  const at = cargaAtmosferica(cfg.succion.elevacion, cfg.succion.T);
  return ORDEN_TIPOS.map((id) => {
    const t = TIPOS_BOMBA[id];
    const etapas = numeroEtapas(t, cfg.rpm, H);
    const nq = velocidadEspecifica(cfg.rpm, qd / t.ojos, H / etapas);
    const qL = M.m3sAlps(qd);
    const motivos = [];
    if (qL < t.Q[0]) motivos.push(`poco caudal (desde ${t.Q[0]} L/s)`);
    if (qL > t.Q[1]) motivos.push(`mucho caudal (hasta ${R.miles(t.Q[1])} L/s)`);
    if (H < t.H[0]) motivos.push(`poca altura (desde ${t.H[0]} m)`);
    if (H > t.H[1]) motivos.push(`mucha altura (hasta ${t.H[1]} m)`);
    if (nq < t.nq[0] || nq > t.nq[1]) motivos.push(`n<sub>q</sub> fuera de ${t.nq[0]} a ${t.nq[1]}`);
    if (id === 'multietapa' && etapas < 2) motivos.push('basta una etapa: sirve una centrífuga');
    if (!t.sumergida && at.carga - cfg.succion.zs - cfg.succion.hfs < 1.3 * npshRequerido(cfg.rpm, qd, t.ojos)) {
      motivos.push('cavitaría por la succión');
    }
    return { id, tipo: t, etapas, nq, apta: motivos.length === 0, motivos };
  });
}

/** Primer tipo que sirve en el orden de preferencia (o null). */
export const tipoRecomendado = (aptitud) => aptitud.find((a) => a.apta) ?? null;

/** Puntos de las curvas para las gráficas: Q en L/s, H en m, potencias en kW (por bomba). */
export function curvas(d, n = 49) {
  const c = d.curva;
  const Qmax = Math.max(d.opMax.Q, d.Q) * 1.45;
  const xs = Array.from({ length: n }, (_, k) => (Qmax * k) / (n - 1));
  const enL = (Q) => M.m3sAlps(Q);
  return {
    QmaxL: enL(Qmax),
    bomba: xs.map((Q) => ({ x: enL(Q), y: alturaBomba(c, Q) })).filter((p) => p.y >= 0),
    sistemaMin: xs.map((Q) => ({ x: enL(Q), y: alturaSistema(c, Q, d.HestMin) })),
    sistemaMax: xs.map((Q) => ({ x: enL(Q), y: alturaSistema(c, Q, d.HestMax) })),
    freno: xs.filter((Q) => Q / c.N / c.qd < 1.95 && alturaBomba(c, Q) > 0)
      .map((Q) => ({ x: enL(Q), y: potenciaFrenoEn(c, Q) / 1000 })),
    electrica: xs.filter((Q) => Q / c.N / c.qd < 1.95 && alturaBomba(c, Q) > 0)
      .map((Q) => ({ x: enL(Q), y: potenciaFrenoEn(c, Q) / d.motor.eta / 1000 })),
    eficiencia: xs.map((Q) => ({ x: enL(Q), y: eficienciaEn(c, Q) * 100 })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. REVISIÓN DEL DISEÑO DE LA BOMBA
// ═══════════════════════════════════════════════════════════════════════════

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1).replace('-', '−') : '—');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2).replace('-', '−') : '—');
const pct = (x) => (x * 100).toFixed(0);

/** Criterios de diseño de una estación de bombeo. nombre: 'Bomba del acueducto', etc. */
export function revisarBomba(d, nombre, { exigirReserva = true } = {}) {
  const checks = [];
  const t = d.tipo;
  const qL = M.m3sAlps(d.qd);
  const s = d.succion;
  R.revisar(checks, `${nombre}: altura a válvula cerrada ${f1(d.curva.H0)} m > altura estática máxima ${f1(d.HestMax)} m`,
    d.curva.H0 > d.HestMax, 'Si no la supera, la bomba gira pero no entrega agua.');
  const enCampo = qL >= t.Q[0] && qL <= t.Q[1] && d.H >= t.H[0] && d.H <= t.H[1];
  R.revisar(checks, `${nombre}: ${f2(qL)} L/s por bomba y ${f1(d.H)} m dentro del campo de la ${t.corto.toLowerCase()} (${t.Q[0]} a ${R.miles(t.Q[1])} L/s, ${t.H[0]} a ${t.H[1]} m)`,
    enCampo, 'Fuera de ese campo conviene otro tipo de bomba: ver la tabla de tipos.', 'aviso');
  R.revisar(checks, `${nombre}: velocidad específica n<sub>q</sub> = ${f1(d.nq)} entre ${t.nq[0]} y ${t.nq[1]}`,
    d.nq >= t.nq[0] && d.nq <= t.nq[1], `Con n<sub>q</sub> = ${f1(d.nq)} conviene un rodete ${d.clase}.`, 'aviso');
  R.revisar(checks, `${nombre}: eficiencia ${pct(d.etaB)} % ≤ ${pct(t.eta[1])} % (la mayor típica del tipo)`,
    d.etaB <= t.eta[1] + 1e-9, 'Una eficiencia mayor que la típica es optimista: la energía real sería mayor.', 'aviso');
  if (!s.sumergida) {
    R.revisar(checks, `${nombre}: NPSH disponible ${f2(s.NPSHd)} m ≥ 1.3 × NPSH requerido = ${f2(1.3 * s.NPSHr)} m`,
      s.NPSHd >= 1.3 * s.NPSHr, 'Si no se cumple, el agua hierve a la entrada del rodete (cavitación): ruido, vibración y desgaste. Se baja la bomba, se reduce la velocidad o se agranda la succión.');
    R.revisar(checks, `${nombre}: altura de succión ${f2(s.zs)} m ≤ 6 m`, s.zs <= 6,
      'Con más altura es difícil cebar la bomba y se descarga al arrancar.', 'aviso');
  }
  const xMin = d.opMin.x;
  const xMax = d.opMax.x;
  R.revisar(checks, `${nombre}: trabaja entre el ${pct(xMin)} % y el ${pct(xMax)} % de su caudal óptimo (70 % a 120 %)`,
    xMin >= 0.7 - 1e-9 && xMax <= 1.2 + 1e-9, 'Lejos del punto óptimo la bomba vibra, se calienta y gasta más energía.', 'aviso');
  R.revisar(checks, `${nombre}: motor de ${d.motor.hp} HP cargado al ${pct(d.factorCarga)} % (60 % a 100 %)`,
    d.factorCarga >= 0.6 - 1e-9 && d.factorCarga <= 1 + 1e-9 && !d.motor.fuera,
    d.motor.fuera ? 'Ningún motor del catálogo alcanza: se reparte el caudal entre más bombas.' : 'Un motor muy grande trabaja con baja eficiencia; uno muy justo se recalienta.', 'aviso');
  if (exigirReserva) {
    R.revisar(checks, `${nombre}: bomba de reserva instalada`, d.reserva,
      'Práctica usual de diseño: una unidad de reserva igual a la mayor, para el mantenimiento y las fallas.', 'aviso');
  }
  return checks;
}
