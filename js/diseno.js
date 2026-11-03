/**
 * diseno.js — Criterios de diseño del acueducto (funciones puras, sin DOM)
 * -----------------------------------------------------------------------
 *  1. Catálogo de tuberías por material, clase de presión y diámetro comercial
 *     (diámetro interno, presión de trabajo, rugosidad y coeficiente C de
 *     Hazen-Williams).
 *  2. Pérdidas por fricción con Darcy-Weisbach o con Hazen-Williams.
 *  3. Demanda: caudal medio diario (Qmd), máximo diario (QMD = k1·Qmd) y
 *     máximo horario (QMH = k2·QMD); curva de consumo a lo largo del día y
 *     volumen de regulación del tanque.
 *  4. Control de la bomba por niveles (arranque y parada) con histéresis.
 *  5. Golpe de ariete al apagar la bomba (Joukowsky).
 *  6. Red de distribución ramificada: tubería principal, ramales, acometidas,
 *     medidor y llave de paso; presiones en cada nodo y cantidades de obra.
 *
 * Los valores de los catálogos son aproximados y de referencia: antes de un
 * diseño real se verifican con el catálogo del fabricante y con el RAS
 * (Resolución 0330 de 2017).
 */
import * as M from './modelo.js';
import { captaAgua } from './rio.js';

// ═══════════════════════════════════════════════════════════════════════════
// 1. CATÁLOGO DE TUBERÍAS
// ═══════════════════════════════════════════════════════════════════════════

const IPS = [ // diámetros externos de la serie IPS (pulgadas → mm)
  ['1/2"', 21.34], ['3/4"', 26.67], ['1"', 33.4], ['1 1/4"', 42.16], ['1 1/2"', 48.26], ['2"', 60.32],
  ['2 1/2"', 73.02], ['3"', 88.9], ['4"', 114.3], ['6"', 168.28], ['8"', 219.08], ['10"', 273.05], ['12"', 323.85],
];
const ACERO_STD = { '1/2"': 2.77, '3/4"': 2.87, '1"': 3.38, '1 1/4"': 3.56, '1 1/2"': 3.68, '2"': 3.91, '2 1/2"': 5.16, '3"': 5.49, '4"': 6.02, '6"': 7.11, '8"': 8.18, '10"': 9.27, '12"': 9.53 };
const MPA_A_MCA = 1e6 / (M.RHO * M.G);   // 1 MPa ≈ 102.2 m.c.a.

/**
 * Cada material define: rugosidad absoluta ε [m], coeficiente C de Hazen-Williams,
 * módulo de elasticidad E [Pa] (para el golpe de ariete), sus clases de presión y
 * una función que devuelve diámetro externo, interno y espesor [mm] para un diámetro
 * nominal y una clase.
 */
export const MATERIALES = {
  pvc: {
    corto: 'PVC presión',
    nombre: 'PVC presión (blanco)', norma: 'NTC 382', rugosidad: 0.0000015, C: 150, E: 2.8e9, eMin: 1.2,
    nota: 'Muy liso. Clase por RDE = diámetro externo / espesor; presión de trabajo 2·HDS/(RDE − 1), con HDS = 13.8 MPa.',
    clases: ['RDE 9', 'RDE 13.5', 'RDE 21', 'RDE 26', 'RDE 32.5', 'RDE 41'],
    diametros: IPS.map(([dn]) => dn),
    medidas(dn, clase) {
      const de = IPS.find((d) => d[0] === dn)?.[1];
      const rde = parseFloat(clase.split(' ')[1]);
      const e = de / rde;
      return { de, e, di: de - 2 * e, pn: (2 * 13.79) / (rde - 1) };
    },
  },
  pead: {
    corto: 'PEAD PE100',
    nombre: 'PEAD PE100 (negro)', norma: 'NTC 4585 / ISO 4427', rugosidad: 0.000007, C: 145, E: 1.1e9, eMin: 2.0,
    nota: 'Bastante liso y flexible. Clase por SDR; presión 2·σ/(SDR − 1), con σ = 8 MPa (PE100).',
    clases: ['SDR 9', 'SDR 11', 'SDR 17', 'SDR 21'],
    diametros: ['20 mm', '25 mm', '32 mm', '40 mm', '50 mm', '63 mm', '75 mm', '90 mm', '110 mm', '160 mm', '200 mm', '250 mm', '315 mm'],
    medidas(dn, clase) {
      const de = parseFloat(dn);
      const sdr = parseFloat(clase.split(' ')[1]);
      const e = de / sdr;
      return { de, e, di: de - 2 * e, pn: (2 * 8) / (sdr - 1) };
    },
  },
  grp: {
    corto: 'GRP / PRFV',
    nombre: 'GRP / PRFV (poliéster reforzado con fibra de vidrio)', norma: 'NTC 3871 / AWWA C950', rugosidad: 0.00003, C: 135, E: 1.2e10, eMin: 0,
    nota: 'Liso (C de 130 a 135). Se usa en conducciones grandes; clase por presión nominal PN.',
    clases: ['PN 6', 'PN 10', 'PN 16'],
    diametros: ['DN 150', 'DN 200', 'DN 250', 'DN 300', 'DN 400', 'DN 500', 'DN 600', 'DN 800'],
    medidas(dn, clase) {
      const di = parseFloat(dn.split(' ')[1]);
      const pn = parseFloat(clase.split(' ')[1]) / 10;
      const e = Math.max(4, di / 45 * (0.7 + pn / 3.2));
      return { de: di + 2 * e, e, di, pn };
    },
  },
  hd: {
    corto: 'Hierro dúctil',
    nombre: 'Hierro dúctil (HD) con mortero', norma: 'ISO 2531', rugosidad: 0.00005, C: 130, E: 1.7e11, eMin: 0,
    nota: 'Liso (C ≈ 130) y muy durable: vida útil del orden de 100 años. Clase por presión admisible C25, C30 o C40.',
    clases: ['C25', 'C30', 'C40'],
    diametros: ['DN 80', 'DN 100', 'DN 150', 'DN 200', 'DN 250', 'DN 300', 'DN 400'],
    medidas(dn, clase) {
      const d = parseFloat(dn.split(' ')[1]);
      const de = { 80: 98, 100: 118, 150: 170, 200: 222, 250: 274, 300: 326, 400: 429 }[d];
      const pn = parseFloat(clase.slice(1)) / 10;
      return { de, e: Math.max(4.4, (de - d) / 2 - 3), di: d, pn };
    },
  },
  ccp: {
    corto: 'AP / CCP',
    nombre: 'AP / CCP (concreto con cilindro de acero)', norma: 'AWWA C301 / C303', rugosidad: 0.0003, C: 115, E: 3.0e10, eMin: 0,
    nota: 'Menos liso (C de 110 a 120). Para conducciones de gran diámetro.',
    clases: ['PN 10', 'PN 15'],
    diametros: ['DN 300', 'DN 400', 'DN 500', 'DN 600', 'DN 800', 'DN 1000'],
    medidas(dn, clase) {
      const di = parseFloat(dn.split(' ')[1]);
      const e = Math.max(50, di / 10);
      return { de: di + 2 * e, e, di, pn: parseFloat(clase.split(' ')[1]) / 10 };
    },
  },
  acero: {
    corto: 'Acero galvanizado',
    nombre: 'Acero galvanizado, cédula estándar', norma: 'ASTM A53', rugosidad: 0.00015, C: 120, E: 2.0e11, eMin: 0,
    nota: 'Se usa en succiones, pasos aéreos y estaciones de bombeo. Presión de trabajo por Barlow con S = 103 MPa.',
    clases: ['STD'],
    diametros: IPS.map(([dn]) => dn),
    medidas(dn) {
      const de = IPS.find((d) => d[0] === dn)?.[1];
      const e = ACERO_STD[dn];
      return { de, e, di: de - 2 * e, pn: (2 * 103 * e) / de };
    },
  },
};

/** Clases de un material que tienen sentido para un diámetro (espesor mínimo de pared). */
export function clasesValidas(mat, dn) {
  const m = MATERIALES[mat];
  return m.clases.filter((c) => m.medidas(dn, c).e >= m.eMin);
}

/**
 * Especificación de una tubería. Si la clase no es fabricable con ese diámetro, toma
 * la primera clase válida.
 */
export function especTubo(mat, clase, dn) {
  const m = MATERIALES[mat] || MATERIALES.pvc;
  if (!m.diametros.includes(dn)) dn = m.diametros[Math.floor(m.diametros.length / 2)];
  const validas = clasesValidas(mat, dn);
  if (!validas.includes(clase)) clase = validas[0] ?? m.clases[0];
  const { de, e, di, pn } = m.medidas(dn, clase);
  return {
    mat, clase, dn, nombre: m.nombre, norma: m.norma,
    DE: de / 1000, e: e / 1000, DI: di / 1000,
    pnMPa: pn, pnMca: pn * MPA_A_MCA,
    rugosidad: m.rugosidad, C: m.C, E: m.E,
  };
}

/** Diámetro nominal del catálogo cuyo diámetro interno queda más cerca de D [m]. */
export function diametroCercano(mat, clase, D) {
  const m = MATERIALES[mat];
  let mejor = m.diametros[0];
  let dif = Infinity;
  for (const dn of m.diametros) {
    const c = clasesValidas(mat, dn).includes(clase) ? clase : clasesValidas(mat, dn)[0];
    if (!c) continue;
    const d = Math.abs(m.medidas(dn, c).di / 1000 - D);
    if (d < dif) { dif = d; mejor = dn; }
  }
  return mejor;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. PÉRDIDAS POR FRICCIÓN
// ═══════════════════════════════════════════════════════════════════════════

export const perdidaHazen = M.perdidaHazen;

/** Análisis de un tramo con la especificación del tubo y el método elegido. */
export function tramo(Q, L, espec, metodo = 'darcy') {
  const a = M.analisisTuberia(Q, L, espec.DI, espec.rugosidad);
  if (metodo === 'hazen' && a.regimen !== 'laminar') a.hfReal = perdidaHazen(Q, L, espec.DI, espec.C);
  a.metodo = metodo;
  return a;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. DEMANDA: Qmd, QMD, QMH Y CURVA DE CONSUMO
// ═══════════════════════════════════════════════════════════════════════════

/** Caudal medio diario por vivienda Qmd = hab·dotación neta/(1 − pérdidas)/86 400 [m³/s]. */
export function caudalMedioVivienda(hab, dotNeta, perdidas) {
  return (hab * dotNeta) / (1 - perdidas) / 86400 / 1000;
}

/** QMD = k1·Qmd y QMH = k2·QMD. */
export function caudalesDiseno(Qmd, k1, k2) {
  return { Qmd, QMD: k1 * Qmd, QMH: k1 * k2 * Qmd };
}

// Forma típica del consumo en una ciudad cálida: picos en la mañana y al final de la tarde
const FORMA = [0.45, 0.4, 0.38, 0.38, 0.45, 0.7, 1.15, 1.45, 1.4, 1.25, 1.15, 1.1, 1.15, 1.1, 1.0, 0.95, 1.0, 1.15, 1.35, 1.42, 1.25, 1.0, 0.75, 0.55];

/**
 * Factores horarios del consumo frente al QMD (24 valores): promedio 1 y máximo k2,
 * de modo que el pico del día es el QMH.
 */
export function factoresHorarios(k2) {
  const media = FORMA.reduce((a, b) => a + b, 0) / 24;
  const max = Math.max(...FORMA);
  const s = (k2 - 1) / (max - media);
  let f = FORMA.map((b) => Math.max(0.05, 1 + (b - media) * s));
  const m2 = f.reduce((a, b) => a + b, 0) / 24;
  f = f.map((x) => x / m2);
  return f;
}

/** Factor de consumo a una hora del día (interpolación lineal entre horas). */
export function factorConsumo(horaDia, k2) {
  const f = factoresHorarios(k2);
  const h = ((horaDia % 24) + 24) % 24;
  const i = Math.floor(h);
  const t = h - i;
  return f[i] * (1 - t) + f[(i + 1) % 24] * t;
}

/**
 * Volumen de regulación: el tanque recibe el QMD constante y entrega el consumo
 * horario. La curva de masa acumula (QMD − Q(h)); el volumen necesario es la
 * diferencia entre su máximo y su mínimo [m³].
 */
export function volumenRegulacion(QMD, k2) {
  const f = factoresHorarios(k2);
  let s = 0;
  let max = 0;
  let min = 0;
  const masa = [0];
  for (let h = 0; h < 24; h++) {
    s += QMD * (1 - f[h]) * 3600;
    masa.push(s);
    max = Math.max(max, s);
    min = Math.min(min, s);
  }
  return { V: max - min, masa, fraccion: (max - min) / (QMD * 86400) };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. CONTROL DE LA BOMBA POR NIVELES
// ═══════════════════════════════════════════════════════════════════════════

/** Caudal que sale del tanque en un instante [m³/s]. */
export function caudalSalida(p, horaDia) {
  const base = M.lpsAm3s(p.Qdemanda) * (p.curvaDemanda === 'horaria' ? factorConsumo(horaDia, p.k2) : 1);
  return base + (p.incendio && p.hidrante ? M.lpsAm3s(p.Qincendio) : 0);
}

/**
 * Interruptores de nivel con histéresis: apaga en la parada y vuelve a arrancar en el
 * arranque. Si el río baja de la rejilla de la bocatoma no hay agua que bombear y la
 * bomba se detiene (protección contra marcha en seco).
 */
export function controlBomba(p, nivel, encendida) {
  if (Number.isFinite(p.cotaRio) && !captaAgua(p.cotaRio)) return false;
  if (p.controlBomba !== 'automatico') return true;
  if (encendida && nivel >= p.nivelParada - 1e-9) return false;
  if (!encendida && nivel <= p.nivelArranque + 1e-9) return true;
  return encendida;
}

/**
 * Avanza el tanque dt segundos con el control de la bomba y el consumo horario.
 * Integra por tramos: si el nivel cruza un interruptor dentro del paso, avanza hasta
 * él, cambia el estado de la bomba y sigue con el tiempo que falta.
 * Además devuelve cada cambio de la bomba con su instante exacto (eventos), el tiempo
 * con la bomba encendida (tBomba) y el área bajo la recta del nivel en ese tiempo
 * (areaNivel = ∫h·dt, suma de trapecios), con la que se calcula la energía del tramo.
 */
export function avanzarTanque(p, estado, dt) {
  let { nivel, bomba, t } = estado;
  const At = M.areaTanque(p.Dtanque);
  let resta = dt;
  let arranques = 0;
  let tBomba = 0;
  let areaNivel = 0;
  const eventos = [];
  let guard = 0;
  while (resta > 1e-6 && guard++ < 400) {
    const sub = Math.min(resta, 300);
    const previo = bomba;
    bomba = controlBomba(p, nivel, bomba);
    if (bomba !== previo) {
      eventos.push({ t, nivel, bomba });
      if (bomba) arranques++;
    }
    const Qin = bomba ? M.lpsAm3s(p.Qbombeo) : 0;
    const QsalDem = caudalSalida(p, (t / 3600) % 24);
    const Qsal = nivel <= 1e-6 ? Math.min(QsalDem, Qin) : QsalDem;
    const lleno = nivel >= p.hMax - 1e-6;
    const Qent = lleno ? Math.min(Qin, Qsal) : Qin;
    const m = (Qent - Qsal) / At;
    let paso = sub;
    let cambia = false;
    if (p.controlBomba === 'automatico') {
      if (bomba && m > 0 && nivel + m * sub >= p.nivelParada) { paso = Math.max(0, (p.nivelParada - nivel) / m); cambia = true; }
      if (!bomba && m < 0 && nivel + m * sub <= p.nivelArranque) { paso = Math.max(0, (p.nivelArranque - nivel) / m); cambia = true; }
    }
    const nivel0 = nivel;
    nivel = Math.min(p.hMax, Math.max(0, nivel + m * paso));
    if (bomba) { tBomba += paso; areaNivel += ((nivel0 + nivel) / 2) * paso; }
    t += paso;
    resta -= paso;
    if (cambia) {
      const antes = bomba;
      bomba = !bomba;
      if (!antes && bomba) arranques++;
      eventos.push({ t, nivel, bomba });
      if (paso === 0) { // evita lazo sin avance
        nivel = Math.min(p.hMax, Math.max(0, nivel + m * 1e-3));
      }
    }
  }
  return { nivel, bomba, t, arranques, tBomba, areaNivel, eventos };
}

/**
 * Ciclo de la bomba con caudales constantes (consumo igual al QMD):
 * llenado del arranque a la parada, vaciado de la parada al arranque y arranques por hora.
 */
export function cicloBomba(p) {
  const At = M.areaTanque(p.Dtanque);
  const dV = At * Math.max(0, p.nivelParada - p.nivelArranque);
  const Qb = M.lpsAm3s(p.Qbombeo);
  const Qd = M.lpsAm3s(p.Qdemanda);
  const tLlenado = Qb > Qd ? dV / (Qb - Qd) : Infinity;
  const tVaciado = Qd > 0 ? dV / Qd : Infinity;
  const ciclo = tLlenado + tVaciado;
  return {
    dV, tLlenado, tVaciado, ciclo,
    arranquesHora: Number.isFinite(ciclo) && ciclo > 0 ? 3600 / ciclo : 0,
    fraccionEncendida: Number.isFinite(tLlenado) ? tLlenado / ciclo : 1,
    horasDia: Number.isFinite(tLlenado) ? (24 * tLlenado) / ciclo : 24,
  };
}

/**
 * Costo mensual de bombeo con el ciclo completo de la bomba. Es un valor del mes, así
 * que no depende del instante ni de si la bomba está prendida en ese momento.
 * La energía que se paga es la eléctrica: se divide por la eficiencia de la bomba η y
 * por la del motor η_m (etaM; con etaM = 1 queda solo la de la bomba).
 * Si el río está por debajo de la rejilla, la bomba no trabaja (0 horas).
 *   - horas al día: las del ciclo, 24·t_enc/(t_enc + t_apag) (24 h con bombeo continuo);
 *   - volumen: V = Q_b · horas · 3600 · 30;
 *   - altura dinámica media: con control por niveles, mientras la bomba trabaja el nivel
 *     sube en línea recta del arranque a la parada y la altura es lineal en el nivel, así
 *     que su promedio es la altura con el nivel medio (h_a + h_p)/2. Con bombeo continuo
 *     el tanque se mantiene lleno (h_máx); si la bomba no alcanza el consumo, termina vacío (0).
 * hf: pérdidas por fricción de la succión y la aducción con el caudal de la bomba [m].
 */
export function costoMensual(p, hf, etaM = 1) {
  const Qb = M.lpsAm3s(p.Qbombeo);
  const auto = p.controlBomba === 'automatico';
  const ciclo = cicloBomba(p);
  const alcanza = Qb > M.lpsAm3s(p.Qdemanda);
  const capta = !Number.isFinite(p.cotaRio) || captaAgua(p.cotaRio);
  const horasDia = !capta ? 0 : (auto ? ciclo.horasDia : 24);
  const nivelMedio = !alcanza ? 0 : (auto ? (p.nivelArranque + p.nivelParada) / 2 : p.hMax);
  const Hmedia = M.alturaBombeo(p.cotaRio, p.cotaTanque, nivelMedio, hf);
  const Vmes = M.volumenMensual(Qb, horasDia);
  return {
    ciclo, alcanza, capta, horasDia, nivelMedio, Hmedia, Vmes, etaM,
    potencia: M.potenciaBomba(Qb, Hmedia, p.eficiencia),
    potenciaElectrica: M.potenciaBomba(Qb, Hmedia, p.eficiencia * etaM),
    costo: M.costoBombeo(Vmes, Hmedia, p.eficiencia * etaM, p.tarifaKWh, p.cargoFijo),
  };
}

/**
 * Energía eléctrica de un tramo de la simulación [kWh]: E = ρ·g·Q_b·∫H·dt/(η·η_m·3.6×10⁶),
 * con H(t) = z_t + h(t) − z_río + h_f, así que ∫H·dt = (z_t − z_río + h_f)·t_enc + ∫h·dt.
 * tBomba [s] y areaNivel [m·s] los devuelve avanzarTanque(); etaM: eficiencia del motor.
 */
export function energiaTramo(p, tBomba, areaNivel, hf, etaM = 1) {
  if (tBomba <= 0) return 0;
  const integralH = (p.cotaTanque - p.cotaRio + hf) * tBomba + areaNivel;
  return (M.RHO * M.G * M.lpsAm3s(p.Qbombeo) * integralH) / (p.eficiencia * etaM * 3.6e6);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. GOLPE DE ARIETE (JOUKOWSKY)
// ═══════════════════════════════════════════════════════════════════════════

export const K_AGUA = 2.2e9;   // módulo de compresibilidad del agua [Pa]

/** Celeridad de la onda de presión a = √(K/ρ) / √(1 + K·D/(E·e)) [m/s]. */
export function celeridad(espec) {
  return Math.sqrt(K_AGUA / M.RHO) / Math.sqrt(1 + (K_AGUA * espec.DI) / (espec.E * espec.e));
}

/** Sobrepresión por un paro instantáneo ΔH = a·V/g [m]. Es la cota superior (paro brusco). */
export function golpeAriete(V, espec) {
  const a = celeridad(espec);
  return { a, dH: (a * V) / M.G };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. RED DE DISTRIBUCIÓN RAMIFICADA
// ═══════════════════════════════════════════════════════════════════════════

/** Identificador de una vivienda: ramal j y posición k (1, 2, …). */
export const idCasa = (j, k) => `${j}-${k}`;

/**
 * Pérdidas en la acometida de una vivienda y caudal del grifo abierto.
 * Carga en la red frente a la casa: Hn (cota piezométrica). Se busca el caudal q tal que
 *   Hn − z_grifo = h_f,acometida(q) + h_medidor(q) + K_llave·v²/2g + (1 + K)·v_b²/2g
 * (función decreciente en q: se resuelve por bisección).
 */
export function grifoConAcometida(p, Hn, zGrifo, espAc, metodo) {
  const Ab = M.areaCircular(p.dBoquilla);
  const Aac = M.areaCircular(espAc.DI);
  const K = p.K0 / (p.apertura * p.apertura);
  const qMaxMed = p.medidorQmax / 3600;
  const perdidas = (q) => {
    const hf = tramo(q, p.Lacometida, espAc, metodo).hfReal;
    const hm = p.medidorDh * (q / qMaxMed) ** 2;
    const hl = p.Kllave * (q / Aac) ** 2 / (2 * M.G);
    return { hf, hm, hl, total: hf + hm + hl };
  };
  const g = (q) => Hn - zGrifo - perdidas(q).total - (1 + K) * (q / Ab) ** 2 / (2 * M.G);
  if (g(0) <= 0) return { q: 0, H: Math.min(0, Hn - zGrifo), hf: 0, hm: 0, hl: 0 };
  let lo = 0;
  let hi = 0.01;
  while (g(hi) > 0 && hi < 1) hi *= 2;
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) lo = mid; else hi = mid;
  }
  const q = (lo + hi) / 2;
  const per = perdidas(q);
  return { q, H: Hn - zGrifo - per.total, ...per, vAc: q / Aac };
}

/**
 * Calcula la red. Hentrada: cota piezométrica a la entrada del barrio (al final de la
 * conducción) [m]. qCasa: demanda de cada vivienda [m³/s]. extra: { casa, q } para darle
 * a una vivienda un caudal distinto (el grifo abierto de la vivienda de análisis).
 */
export function calcularRed(p, Hentrada, Hestatica, qCasa, extra = null) {
  const eP = especTubo(p.matPrincipal, p.clasePrincipal, p.dnPrincipal);
  const eR = especTubo(p.matRamal, p.claseRamal, p.dnRamal);
  const met = p.metodoPerdidas;
  const N = Math.round(p.nRamales);
  const K = Math.round(p.nViviendas);
  const z0 = p.cotaCasa;
  const xRamal = (j) => p.Lentrada + (j - 1) * p.sepRamales;
  const cotaP = (j) => z0 + p.pendPrincipal * xRamal(j);
  const sCasa = (k) => (k - 0.5) * p.sepViviendas;
  const cotaCasa = (j, k) => cotaP(j) + p.pendRamal * sCasa(k);
  const qIncendio = p.incendio && p.hidrante ? M.lpsAm3s(p.Qincendio) : 0;
  const LhidExt = 20;

  // Demandas
  const demanda = {};
  for (let j = 1; j <= N; j++) for (let k = 1; k <= K; k++) {
    const id = idCasa(j, k);
    demanda[id] = p.ramalCerrado === j ? 0 : (extra && extra.casa === id ? extra.q : qCasa);
  }
  // Caudal de cada ramal en cada tramo (acumulado aguas abajo)
  const tramos = [];
  const nodos = { E: { id: 'E', tipo: 'entrada', cota: z0, H: Hentrada, x: 0, s: 0 } };
  const qRamal = [];
  for (let j = 1; j <= N; j++) {
    let q = 0;
    for (let k = 1; k <= K; k++) q += demanda[idCasa(j, k)];
    qRamal[j] = q;
  }
  // Principal: E → P1 → … → PN (→ hidrante al final)
  let H = Hentrada;
  for (let j = 1; j <= N; j++) {
    let q = qIncendio;
    for (let i = j; i <= N; i++) q += qRamal[i];
    const L = j === 1 ? p.Lentrada : p.sepRamales;
    const a = tramo(q, L, eP, met);
    H -= a.hfReal;
    tramos.push({ id: `P${j}`, desde: j === 1 ? 'E' : `P${j - 1}`, hasta: `P${j}`, tipo: 'principal', L, Q: q, espec: eP, ...a });
    nodos[`P${j}`] = { id: `P${j}`, tipo: 'principal', cota: cotaP(j), H, x: xRamal(j), s: 0 };
  }
  if (p.hidrante) {
    const a = tramo(qIncendio, LhidExt, eP, met);
    tramos.push({ id: 'HI', desde: `P${N}`, hasta: 'HI', tipo: 'principal', L: LhidExt, Q: qIncendio, espec: eP, ...a });
    nodos.HI = { id: 'HI', tipo: 'hidrante', cota: cotaP(N) + p.pendPrincipal * LhidExt, H: H - a.hfReal, x: xRamal(N) + LhidExt, s: 0 };
  }
  // Ramales
  const casas = [];
  for (let j = 1; j <= N; j++) {
    let Hr = nodos[`P${j}`].H;
    const cerrado = p.ramalCerrado === j;
    for (let k = 1; k <= K; k++) {
      let q = 0;
      for (let i = k; i <= K; i++) q += demanda[idCasa(j, i)];
      const L = k === 1 ? p.sepViviendas / 2 : p.sepViviendas;
      const a = tramo(q, L, eR, met);
      Hr -= a.hfReal;
      const id = idCasa(j, k);
      tramos.push({ id: `R${id}`, desde: k === 1 ? `P${j}` : `R${idCasa(j, k - 1)}`, hasta: `R${id}`, tipo: 'ramal', ramal: j, L, Q: q, espec: eR, ...a });
      const cota = cotaCasa(j, k);
      const presion = cerrado ? 0 : Hr - cota;
      nodos[`R${id}`] = { id: `R${id}`, tipo: 'casa', casa: id, cota, H: cerrado ? cota : Hr, x: xRamal(j), s: sCasa(k) };
      casas.push({ id, j, k, cota, Hn: cerrado ? cota : Hr, presion, estatica: cerrado ? 0 : Hestatica - cota, cerrada: cerrado, q: demanda[id] });
    }
  }
  const abiertas = casas.filter((c) => !c.cerrada);
  const critica = abiertas.length ? abiertas.reduce((a, b) => (b.presion < a.presion ? b : a)) : casas[0];
  const lista = Object.values(nodos);
  const alto = lista.filter((n) => n.tipo !== 'entrada').reduce((a, b) => (b.cota > a.cota ? b : a));
  const bajo = lista.filter((n) => n.tipo !== 'entrada').reduce((a, b) => (b.cota < a.cota ? b : a));
  const Qred = qRamal.slice(1).reduce((a, b) => a + b, 0) + qIncendio;
  return {
    eP, eR, tramos, nodos, casas, critica, Qred, qIncendio, N, K,
    puntoAlto: alto, puntoBajo: bajo,
    presionMin: abiertas.length ? Math.min(...abiertas.map((c) => c.presion)) : 0,
    presionMax: casas.length ? Math.max(...casas.map((c) => c.presion)) : 0,
    estaticaMax: casas.length ? Math.max(...casas.map((c) => c.estatica)) : 0,
    Vmax: Math.max(...tramos.map((t) => t.V)),
    longitudPrincipal: tramos.filter((t) => t.tipo === 'principal').reduce((a, t) => a + t.L, 0),
    longitudRamales: tramos.filter((t) => t.tipo === 'ramal').reduce((a, t) => a + t.L, 0),
  };
}

/** Sección de la zanja para una tubería de diámetro externo DE [m]. */
export function zanja(p, DE) {
  const ancho = Math.max(0.5, DE + 2 * p.holgura);
  const profundidad = p.cama + DE + p.recubrimiento;
  return { ancho, profundidad, area: ancho * profundidad, cinta: p.recubrimiento - 0.3 > 0 ? p.cama + DE + 0.3 : null };
}

/** Cantidades de obra de la red (tuberías, accesorios y excavación). */
export function cantidadesRed(p, red, eAc) {
  const zP = zanja(p, red.eP.DE);
  const zR = zanja(p, red.eR.DE);
  const n = red.N * red.K;
  const nValv = (p.valvulasRamal ? red.N : 0) + 1; // + la de entrada al barrio
  const filas = [
    ['Tubería principal', `${red.eP.nombre} ${red.eP.clase}, ${red.eP.dn}`, red.longitudPrincipal, 'm'],
    ['Tubería de ramales', `${red.eR.nombre} ${red.eR.clase}, ${red.eR.dn}`, red.longitudRamales, 'm'],
    ['Tubería de servicio (acometidas)', `${eAc.nombre} ${eAc.clase}, ${eAc.dn}`, n * p.Lacometida, 'm'],
    ['Abrazaderas de toma', `Sobre ${red.eR.dn}`, n, 'und'],
    ['Medidores de agua con caja portamedidor', `Caudal máximo ${p.medidorQmax} m³/h`, n, 'und'],
    ['Llaves de paso', eAc.dn, n, 'und'],
    ['Válvulas de compuerta con caja', `${red.eP.dn} (entrada) y ${red.eR.dn} (ramales)`, nValv, 'und'],
    ['Válvula de aire (ventosa)', `En el punto alto (${red.puntoAlto.id})`, p.valvulaAire ? 1 : 0, 'und'],
    ['Válvula de purga', `En el punto bajo (${red.puntoBajo.id})`, p.valvulaPurga ? 1 : 0, 'und'],
    ['Hidrante contra incendios', 'Al final de la principal', p.hidrante ? 1 : 0, 'und'],
    ['Excavación de zanjas', `Principal ${zP.ancho.toFixed(2)} × ${zP.profundidad.toFixed(2)} m; ramales ${zR.ancho.toFixed(2)} × ${zR.profundidad.toFixed(2)} m`,
      zP.area * red.longitudPrincipal + zR.area * red.longitudRamales, 'm³'],
    ['Cama de apoyo (arena)', `${(p.cama * 100).toFixed(0)} cm`, p.cama * (zP.ancho * red.longitudPrincipal + zR.ancho * red.longitudRamales), 'm³'],
    ['Cinta de advertencia', '30 cm sobre la tubería', red.longitudPrincipal + red.longitudRamales, 'm'],
  ];
  return { filas, zP, zR };
}
