/**
 * rio.js — El río y su cuenca.
 * -----------------------------------------------------------------------
 * Nivel y caudal en la bocatoma (ecuación de Manning), sedimentos que traen las
 * lluvias, calidad del agua aguas abajo de un vertimiento a lo largo de las zonas
 * alta, media y baja (mezcla, decaimiento de primer orden y oxígeno disuelto de
 * Streeter-Phelps) y paso de la contaminación al acuífero (Darcy y método GOD).
 * Funciones puras: no tocan el DOM.
 *
 * Unidades: caudales en m³/s, DBO y oxígeno en mg/L, coliformes fecales en
 * NMP/100 mL, nitratos en mg/L de N, distancias a lo largo del río en km.
 */
import * as M from './modelo.js';

// ═══════════════════════════════════════════════════════════════════════════
// 1. EL CAUCE EN LA BOCATOMA: NIVEL → CAUDAL (MANNING)
// ═══════════════════════════════════════════════════════════════════════════

/** Sección del río en la bocatoma (rectangular, zona baja). Cotas en m.s.n.m. */
export const CAUCE = { ancho: 10, n: 0.045, pendiente: 0.0003, fondo: 1.0 };

/** Fondo de la rejilla de la bocatoma y lámina mínima de agua sobre él para captar [m]. */
export const REJILLA = { fondo: 1.6, laminaMin: 0.15 };
/** Cota mínima del río para que la bocatoma capte [m.s.n.m.]. */
export const COTA_MIN_CAPTACION = REJILLA.fondo + REJILLA.laminaMin;

/** ¿Alcanza el río a entrar por la rejilla? */
export const captaAgua = (cotaRio) => cotaRio >= COTA_MIN_CAPTACION - 1e-9;

/**
 * Caudal del río para una cota de la lámina (curva de descarga):
 *   y = cota − fondo,  A = B·y,  R = A/(B + 2y),  Q = (1/n)·A·R^(2/3)·S^(1/2)
 */
export function caudalRio(cota, cauce = CAUCE) {
  const y = Math.max(0, cota - cauce.fondo);
  if (y <= 0) return { y: 0, A: 0, P: cauce.ancho, R: 0, V: 0, Q: 0 };
  const A = cauce.ancho * y;
  const P = cauce.ancho + 2 * y;
  const R = A / P;
  const V = (1 / cauce.n) * R ** (2 / 3) * Math.sqrt(cauce.pendiente);
  return { y, A, P, R, V, Q: V * A };
}

/** Escenarios de lluvia: cada uno fija la cota del río y el sedimento en suspensión. */
export const LLUVIAS = {
  seca: { nombre: 'Época seca', cota: 1.9, sedimento: 40 },
  normal: { nombre: 'Condición normal', cota: 2.5, sedimento: 150 },
  lluvias: { nombre: 'Temporada de lluvias', cota: 2.9, sedimento: 800 },
  aguacero: { nombre: 'Aguacero fuerte (creciente)', cota: 3.3, sedimento: 3000 },
  inundacion: { nombre: 'Creciente extraordinaria (inundación)', cota: 3.7, sedimento: 5000 },
};


/** Cota de la lámina en la bocatoma para un caudal (curva de descarga inversa). */
export function cotaDeCaudal(Q, cauce = CAUCE) {
  if (Q <= 0) return cauce.fondo;
  return cauce.fondo + M.tiranteNormal(Q, cauce.ancho, cauce.pendiente, cauce.n, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. ZONAS DE LA CUENCA (ALTA, MEDIA Y BAJA)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cada zona tiene su tramo de río (km desde el nacimiento), altitud, clima,
 * fracción del caudal que pasa por la bocatoma (los afluentes lo aumentan aguas
 * abajo) y la sección típica del cauce. lluvia: lluvia efectiva [mm/día].
 * desnivelCampo: altura de los cultivos sobre el río [m]; kmToma: toma de riego.
 */
export const ZONAS = {
  alta: {
    nombre: 'Zona alta', lugar: 'montaña de la Sierra Nevada', km: [0, 15], elevacion: 1200,
    Tagua: 18, Tmed: 18, dT: 9, fraccionQ: 0.35, cauce: { ancho: 5, n: 0.05, pendiente: 0.04 },
    lluvia: { seca: 1.0, lluviosa: 4.5 }, pendienteTerreno: 0.15, desnivelCampo: 25, kmToma: 12,
  },
  media: {
    nombre: 'Zona media', lugar: 'piedemonte', km: [15, 35], elevacion: 400,
    Tagua: 23, Tmed: 24, dT: 10, fraccionQ: 0.7, cauce: { ancho: 8, n: 0.045, pendiente: 0.012 },
    lluvia: { seca: 0.5, lluviosa: 3.5 }, pendienteTerreno: 0.06, desnivelCampo: 15, kmToma: 30,
  },
  baja: {
    nombre: 'Zona baja', lugar: 'llanura costera y ciudad', km: [35, 50], elevacion: 20,
    Tagua: 27, Tmed: 28, dT: 9, fraccionQ: 1, cauce: CAUCE,
    lluvia: { seca: 0.2, lluviosa: 2.5 }, pendienteTerreno: 0.005, desnivelCampo: 6, kmToma: 48,
  },
};
export const KM_BOCATOMA = 44;
export const KM_DESEMBOCADURA = 50;
/** Dónde entra el vertimiento según la zona elegida [km]. */
export const KM_VERTIMIENTO = { alta: 10, media: 25, baja: 40, abajo: 46.5 };
/** Nombres de los puntos de vertimiento para el panel. */
export const PUNTOS_VERTIMIENTO = {
  alta: 'Zona alta, km 10 (montaña)',
  media: 'Zona media, km 25 (piedemonte)',
  baja: 'Zona baja, km 40 (antes de la bocatoma)',
  abajo: 'Zona baja, km 46.5 (después de la ciudad)',
};
export const zonaDeKm = (km) => (km < 15 ? 'alta' : (km < 35 ? 'media' : 'baja'));

// ═══════════════════════════════════════════════════════════════════════════
// 3. CALIDAD DEL AGUA: MEZCLA, DECAIMIENTO Y OXÍGENO DISUELTO
// ═══════════════════════════════════════════════════════════════════════════

/** Tipos de vertimiento con sus concentraciones típicas y un caudal de referencia [L/s]. */
export const VERTIMIENTOS = {
  ninguno: { nombre: 'Sin vertimiento', DBO: 0, OD: 0, CF: 0, NO3: 0, Qtipico: 0 },
  tratada: { nombre: 'Aguas domésticas tratadas (PTAR con desinfección)', DBO: 30, OD: 3, CF: 1000, NO3: 20, Qtipico: 20 },
  domestica: { nombre: 'Aguas residuales domésticas sin tratar', DBO: 250, OD: 0, CF: 1e7, NO3: 30, Qtipico: 20 },
  cafe: { nombre: 'Aguas mieles del beneficio del café', DBO: 15000, OD: 0, CF: 1000, NO3: 5, Qtipico: 1.5 },
  agricola: { nombre: 'Escorrentía agrícola (fertilizantes y estiércol)', DBO: 15, OD: 6, CF: 20000, NO3: 25, Qtipico: 50 },
};

/** Calidad natural del río al nacer y de los afluentes que llegan limpios. */
export const FONDO = { DBO: 2, CF: 100, NO3: 0.3 };

/** Constantes a 20 °C [1/día] y factores de temperatura θ (k_T = k₂₀·θ^(T−20)). */
export const K20 = { kd: 0.35, kb: 1.2, kaMax: 30 };
export const THETA = { kd: 1.047, ka: 1.024, kb: 1.07 };
export const corregirT = (k20, theta, T) => k20 * theta ** (T - 20);

/** Presión atmosférica relativa a la del nivel del mar a una altitud z [m]. */
export const presionRelativa = (z) => (1 - 2.25577e-5 * z) ** 5.25588;
/** Presión atmosférica [kPa] a una altitud z [m]. */
export const presionAtm = (z) => 101.325 * presionRelativa(z);

/**
 * Oxígeno disuelto de saturación [mg/L] en agua dulce a T [°C] (Benson y Krause,
 * APHA 4500-O), corregido por la presión atmosférica de la altitud z [m].
 */
export function odSaturacion(T, z = 0) {
  const K = T + 273.15;
  const c = Math.exp(-139.34411 + 1.575701e5 / K - 6.642308e7 / K ** 2 + 1.2438e10 / K ** 3 - 8.621949e11 / K ** 4);
  return c * presionRelativa(z);
}

/** Reaireación de O'Connor y Dobbins a 20 °C [1/día]: k_a = 3.93·u^0.5 / H^1.5 (u en m/s, H en m). */
export function reaireacion(u, H) {
  return Math.min(K20.kaMax, (3.93 * Math.sqrt(u)) / H ** 1.5);
}

/**
 * Hidráulica y constantes de cada zona con un caudal natural Qboc en la bocatoma [m³/s].
 * dQ: lo que la represa (zona alta) suelta de más (o guarda, si es negativo) frente al
 * caudal que le entra; cambia el caudal de todo el río aguas abajo de la presa.
 */
export function hidraulicaZonas(Qboc, dQ = 0) {
  const out = {};
  for (const [id, z] of Object.entries(ZONAS)) {
    const Q = Math.max(1e-4, z.fraccionQ * Qboc + dQ);
    const y = M.tiranteNormal(Q, z.cauce.ancho, z.cauce.pendiente, z.cauce.n, 0);
    const u = Q / (z.cauce.ancho * y);
    const T = z.Tagua;
    out[id] = {
      Q, y, u, T,
      ka20: reaireacion(u, y),
      ka: corregirT(reaireacion(u, y), THETA.ka, T),
      kd: corregirT(K20.kd, THETA.kd, T),
      kb: corregirT(K20.kb, THETA.kb, T),
      ODsat: odSaturacion(T, z.elevacion),
    };
  }
  return out;
}

/** Mezcla de dos caudales: C = (Q₁·C₁ + Q₂·C₂)/(Q₁ + Q₂). */
export const mezcla = (Q1, C1, Q2, C2) => (Q1 * C1 + Q2 * C2) / (Q1 + Q2);

/**
 * Punto crítico de Streeter-Phelps en un tramo homogéneo:
 *   t_c = ln[(k_a/k_d)·(1 − D₀(k_a − k_d)/(k_d·L₀))] / (k_a − k_d),   D_c = (k_d/k_a)·L₀·e^(−k_d·t_c)
 */
export function puntoCritico(L0, D0, kd, ka) {
  if (L0 <= 0 || kd <= 0) return { tc: 0, Dc: D0 };
  const arg = (ka / kd) * (1 - (D0 * (ka - kd)) / (kd * L0));
  const tc = arg > 1 && Math.abs(ka - kd) > 1e-9 ? Math.log(arg) / (ka - kd) : 0;
  return { tc, Dc: tc > 0 ? (kd / ka) * L0 * Math.exp(-kd * tc) : D0 };
}

/**
 * Perfil de calidad a lo largo del río (paso de 0.1 km). El agua nace limpia y
 * saturada; en cada cambio de zona entra un afluente limpio; en el vertimiento se
 * mezcla; entre esos puntos la DBO y los coliformes decaen y el déficit de oxígeno
 * sigue la ecuación de Streeter-Phelps:
 *   L = L₀·e^(−k_d·t),  N = N₀·e^(−k_b·t),  D = k_d·L₀/(k_a − k_d)·(e^(−k_d·t) − e^(−k_a·t)) + D₀·e^(−k_a·t)
 */
export function perfilCalidad(p, Qboc, dQ = 0) {
  const tipo = VERTIMIENTOS[p.vertTipo] ?? VERTIMIENTOS.ninguno;
  const Qv = tipo === VERTIMIENTOS.ninguno ? 0 : M.lpsAm3s(Math.max(0, p.Qvert));
  const kmV = KM_VERTIMIENTO[p.vertZona] ?? KM_VERTIMIENTO.media;
  const hid = hidraulicaZonas(Qboc, dQ);
  let zona = 'alta';
  let h = hid.alta;
  let Q = h.Q;
  let L = FONDO.DBO;
  let D = 0;
  let N = FONDO.CF;
  let NO3 = FONDO.NO3;
  let mezclado = Qv === 0;
  let tDesde = 0;                 // tiempo de viaje desde el vertimiento [días]
  let inicio = null;              // estado justo después de la mezcla
  let bocatoma = null;
  const zonas = { alta: { odMin: Infinity, kmOdMin: 0 }, media: { odMin: Infinity, kmOdMin: 0 }, baja: { odMin: Infinity, kmOdMin: 0 } };
  const puntos = [];
  const dx = 0.1;
  const pasos = Math.round(KM_DESEMBOCADURA / dx);
  let odMin = { od: Infinity, km: 0 };
  for (let i = 0; i <= pasos; i++) {
    const km = i * dx;
    const zId = zonaDeKm(Math.min(km, KM_DESEMBOCADURA - 1e-6));
    if (zId !== zona) {
      // Afluente limpio y saturado: aumenta el caudal y diluye
      const h2 = hid[zId];
      const Qn = Math.max(Q, h2.Q + (mezclado ? Qv : 0));
      const dQ = Qn - Q;
      const OD = Math.max(0, h.ODsat - D);
      L = mezcla(Q, L, dQ, FONDO.DBO);
      N = mezcla(Q, N, dQ, FONDO.CF);
      NO3 = mezcla(Q, NO3, dQ, FONDO.NO3);
      D = Math.max(0, h2.ODsat - mezcla(Q, OD, dQ, h2.ODsat));
      Q = Qn;
      zona = zId;
      h = h2;
    }
    if (!mezclado && km >= kmV - 1e-9) {
      const OD = Math.max(0, h.ODsat - D);
      const antes = { L, N, NO3, OD, Q };
      L = mezcla(Q, L, Qv, tipo.DBO);
      N = mezcla(Q, N, Qv, tipo.CF);
      NO3 = mezcla(Q, NO3, Qv, tipo.NO3);
      const ODm = mezcla(Q, OD, Qv, tipo.OD);
      D = Math.max(0, h.ODsat - ODm);
      inicio = { km, zona: zId, Qrio: Q, Qv, antes, L0: L, D0: D, N0: N, NO30: NO3, OD0: ODm, ...h };
      Q += Qv;
      mezclado = true;
      tDesde = 0;
    }
    const OD = Math.max(0, h.ODsat - D);
    if (i % 5 === 0) puntos.push({ km, DBO: L, OD, ODsat: h.ODsat, CF: N, NO3, zona: zId });
    if (OD < odMin.od - 1e-12) odMin = { od: OD, km };
    if (OD < zonas[zId].odMin) Object.assign(zonas[zId], { odMin: OD, kmOdMin: km });
    for (const [id, z] of Object.entries(ZONAS)) {
      if (Math.abs(km - z.kmToma) < dx / 2) zonas[id].toma = { km, DBO: L, OD, CF: N, NO3 };
    }
    if (!bocatoma && km >= KM_BOCATOMA - 1e-9) {
      bocatoma = { km, DBO: L, OD, ODsat: h.ODsat, CF: N, NO3, tViaje: inicio && kmV <= KM_BOCATOMA ? tDesde : null };
    }
    if (i === pasos) break;
    // Avance de un paso dx con la velocidad de la zona
    const dt = (dx * 1000) / h.u / 86400;
    const eD = Math.exp(-h.kd * dt);
    const eA = Math.exp(-h.ka * dt);
    const Dn = Math.abs(h.ka - h.kd) > 1e-9
      ? ((h.kd * L) / (h.ka - h.kd)) * (eD - eA) + D * eA
      : (h.kd * L * dt + D) * eA;
    L *= eD;
    D = Dn;
    N *= Math.exp(-h.kb * dt);
    if (mezclado) tDesde += dt;
  }
  const desembocadura = puntos[puntos.length - 1];
  const critico = inicio ? puntoCritico(inicio.L0, inicio.D0, inicio.kd, inicio.ka) : { tc: 0, Dc: 0 };
  if (inicio) {
    critico.km = inicio.km + (critico.tc * 86400 * inicio.u) / 1000;
    critico.OD = Math.max(0, inicio.ODsat - critico.Dc);
  }
  return { tipo, Qv, kmV, hid, puntos, bocatoma, desembocadura, odMin, zonas, inicio, critico };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. SEDIMENTOS DE LAS LLUVIAS EN EL DESARENADOR
// ═══════════════════════════════════════════════════════════════════════════

/** Granulometría típica del sedimento en suspensión: fracción en peso por clase (d en mm, límite superior). */
export const GRANULOMETRIA = [
  { d: 0.002, f: 0.20, nombre: 'arcilla' },
  { d: 0.05, f: 0.45, nombre: 'limo' },
  { d: 0.1, f: 0.15, nombre: 'arena muy fina' },
  { d: 0.25, f: 0.12, nombre: 'arena fina' },
  { d: 2.0, f: 0.08, nombre: 'arena media y gruesa' },
];
export const SEDIMENTO = { rhoS: 2650, porosidad: 0.45, alturaTolva: 0.3 };

/** Fracción en peso del sedimento más grueso que dMin [mm] (interpolación logarítmica en la clase). */
export function fraccionMayorQue(dMin) {
  let f = 0;
  let d0 = 0.0002;
  for (const c of GRANULOMETRIA) {
    if (dMin <= d0) f += c.f;
    else if (dMin < c.d) f += (c.f * (Math.log(c.d) - Math.log(dMin))) / (Math.log(c.d) - Math.log(d0));
    d0 = c.d;
  }
  return Math.min(1, f);
}

/**
 * Sedimento que entra con el bombeo y lo que retiene el desarenador:
 *   M = C·Q_b·horas·3600 [g/día],  M_ret = f·M,  V = M_ret/(ρ_s·(1 − n)),  días = V_tolva/V
 * C [mg/L = g/m³], Qb [m³/s], dMin [m]: grano más fino que se queda (Stokes).
 */
export function sedimentos(p, Qb, horasDia, dMin) {
  const C = Math.max(0, p.sedimento);
  const Mentra = (C * Qb * horasDia * 3600) / 1000;   // kg/día
  const f = Qb > 0 ? fraccionMayorQue(dMin * 1000) : 0;
  const Mret = f * Mentra;
  const Vret = Mret / (SEDIMENTO.rhoS * (1 - SEDIMENTO.porosidad));
  const Vtolva = p.desAncho * p.desLongitud * SEDIMENTO.alturaTolva;
  return { C, Mentra, f, Mret, Cpasa: (1 - f) * C, Vret, Vtolva, dias: Vret > 0 ? Vtolva / Vret : Infinity };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. EL ACUÍFERO: TIEMPO DE LLEGADA (DARCY) Y VULNERABILIDAD (GOD)
// ═══════════════════════════════════════════════════════════════════════════

/** Suelo sobre el acuífero: conductividad K [m/día], porosidad efectiva, factor O del GOD y remoción de bacterias [log₁₀/m]. */
export const SUELOS = {
  grava: { nombre: 'Grava y arena gruesa', K: 50, ne: 0.25, O: 0.9, remocion: 0.05 },
  arena: { nombre: 'Arena', K: 5, ne: 0.25, O: 0.7, remocion: 0.3 },
  limo: { nombre: 'Limo', K: 0.2, ne: 0.1, O: 0.5, remocion: 0.6 },
  arcilla: { nombre: 'Arcilla', K: 0.005, ne: 0.05, O: 0.4, remocion: 1.0 },
};
/** Tipo de acuífero: factor G del GOD y capa de arcilla que lo cubre (semiconfinado y confinado). */
export const ACUIFEROS = {
  libre: { nombre: 'Libre (no confinado)', G: 1.0, capa: null },
  semiconfinado: { nombre: 'Semiconfinado', G: 0.4, capa: { espesor: 2, K: 0.005, ne: 0.05, remocion: 1.0 } },
  confinado: { nombre: 'Confinado', G: 0.2, capa: { espesor: 10, K: 0.0005, ne: 0.05, remocion: 1.0 } },
};
export const factorProfundidad = (d) => (d <= 5 ? 0.9 : (d <= 20 ? 0.8 : (d <= 50 ? 0.7 : 0.6)));
export const claseGOD = (i) => (i < 0.1 ? 'despreciable' : (i < 0.3 ? 'baja' : (i < 0.5 ? 'moderada' : (i < 0.7 ? 'alta' : 'extrema'))));
export const K_SUELO = { coliformes: 0.5, dbo: 0.2 };   // decaimiento en el suelo [1/día]

/**
 * Agua del río de la zona baja que se infiltra hasta el nivel freático (gradiente unitario):
 *   v = K/n_e,  t = d/v (más la capa confinante),  N = N₀·e^(−k·t)·10^(−r·d),  nitratos sin cambio
 *   GOD = G·O·D (0 a 1)
 */
export function acuifero(p, agua) {
  const s = SUELOS[p.sueloAcuifero] ?? SUELOS.arena;
  const a = ACUIFEROS[p.tipoAcuifero] ?? ACUIFEROS.libre;
  const d = Math.max(0.1, p.profFreatico);
  const v = s.K / s.ne;
  let t = d / v;
  let log10 = s.remocion * d;
  if (a.capa) {
    t += a.capa.espesor / (a.capa.K / a.capa.ne);
    log10 += a.capa.remocion * a.capa.espesor;
  }
  const CF = agua.CF * Math.exp(-K_SUELO.coliformes * t) * 10 ** -log10;
  const Dfac = factorProfundidad(d);
  const god = a.G * s.O * Dfac;
  return {
    suelo: s, tipo: a, d, v, t, log10,
    CF, NO3: agua.NO3, DBO: agua.DBO * Math.exp(-K_SUELO.dbo * t),
    G: a.G, O: s.O, D: Dfac, god, clase: claseGOD(god),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. TODO EL RÍO
// ═══════════════════════════════════════════════════════════════════════════

/** Entero con espacio fino para los miles (igual que el panel): 12345 → '12 345'. */
export const miles = (x) => (Number.isFinite(x) ? String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') : '—');

export function revisar(lista, texto, cumple, detalle, nivelFalla = 'alerta') {
  lista.push({ texto, nivel: cumple ? 'ok' : nivelFalla, detalle });
}

/**
 * Río completo: caudal en la bocatoma, calidad por zonas, acuífero y (si se dan)
 * los sedimentos del desarenador. sed: resultado de sedimentos().
 */
/**
 * El acuífero aluvial de la zona baja se recarga con el río entre el km 35 y la
 * desembocadura: se toma la peor calidad de ese tramo (caso conservador).
 */
export function aguaRecarga(puntos, zona = 'baja') {
  const [k0, k1] = (ZONAS[zona] ?? ZONAS.baja).km;
  const tramo = puntos.filter((x) => x.km >= k0 - 1e-9 && x.km <= k1 + 1e-9);
  return {
    DBO: Math.max(...tramo.map((x) => x.DBO)),
    CF: Math.max(...tramo.map((x) => x.CF)),
    NO3: Math.max(...tramo.map((x) => x.NO3)),
  };
}

export function calcularRio(p, sed = null) {
  // p.cotaRio ya incluye el efecto de la represa; dQ es lo que ella suelta de más (o guarda)
  const dQ = p.dQrepresa ?? 0;
  const boc = caudalRio(p.cotaRio);
  const capta = captaAgua(p.cotaRio);
  const calidad = perfilCalidad(p, Math.max(0, boc.Q - dQ), dQ);
  const recarga = aguaRecarga(calidad.puntos);
  const acu = acuifero(p, recarga);
  const lamina = p.cotaRio - REJILLA.fondo;
  const checks = [];
  const f1 = (x) => x.toFixed(1).replace('-', '−');
  const f2 = (x) => x.toFixed(2).replace('-', '−');
  const entero = miles;
  revisar(checks, `Bocatoma: lámina sobre la rejilla ${f2(lamina)} m ≥ ${REJILLA.laminaMin} m`, capta,
    capta ? 'El río entra por la rejilla.' : 'El río bajó de la rejilla: la bocatoma no capta y la bomba se detiene.');
  revisar(checks, `Río: oxígeno disuelto mínimo ${f1(calidad.odMin.od)} mg/L ≥ ${p.odMin} mg/L (km ${f1(calidad.odMin.km)})`,
    calidad.odMin.od >= p.odMin, 'Por debajo de ese valor los peces y la fauna del río no sobreviven.');
  revisar(checks, `Bocatoma: coliformes fecales ${entero(calidad.bocatoma.CF)} ≤ ${entero(p.cfMax)} NMP/100 mL`,
    calidad.bocatoma.CF <= p.cfMax, 'Límite de referencia del agua cruda para potabilizar con tratamiento convencional.');
  revisar(checks, `Bocatoma: nitratos ${f2(calidad.bocatoma.NO3)} ≤ 10 mg/L de N`, calidad.bocatoma.NO3 <= 10,
    'Los nitratos no se quitan con el tratamiento convencional.');
  if (sed) {
    revisar(checks, `Desarenador: limpieza cada ${Number.isFinite(sed.dias) ? f1(sed.dias) : '—'} días ≥ 7 días`, sed.dias >= 7,
      'Con aguaceros fuertes la tolva se llena en pocos días; hay que limpiar más seguido o agrandar el desarenador.', 'aviso');
    revisar(checks, `Sedimento que pasa al tanque ${entero(sed.Cpasa)} ≤ 500 mg/L`, sed.Cpasa <= 500,
      'El limo y la arcilla no se asientan en el desarenador; durante un aguacero conviene suspender la captación.', 'aviso');
  }
  // La revisión del acuífero (infiltración, GOD y pozo) está en acuifero.js
  return { boc, capta, lamina, calidad, recarga, acu, sed, checks };
}
