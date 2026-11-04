/**
 * lluvia.js — La precipitación, el motor del agua en la cuenca, y los desastres que causa.
 * -----------------------------------------------------------------------
 *  1. Clima del año: año normal, El Niño (seco) o La Niña (lluvioso). Cambia la lluvia de
 *     cada mes y el aporte del agua subterránea al río.
 *  2. Lluvia–caudal del río (balance lineal de 30 días en la cuenca de la bocatoma):
 *       Q = f_sub·Q_sub + K·(P30 + a·P_t),   K = c·A/2592
 *     P30: lluvia de los últimos 30 días [mm]; P_t: lluvia de la tormenta de hoy [mm] y a la
 *     parte de la cuenca donde cae; c: coeficiente de escorrentía; A: área [km²].
 *  3. Tormenta (curva IDF): lluvia máxima diaria de Gumbel y duraciones cortas de Dyck y
 *     Peschke:  P24(T) = M + K_T·s,  P(D) = P24·(D/1440)^0.25,  i = P/(D/60)
 *  4. Arroyo urbano: método racional Q = C·i·A/3.6, con el tiempo de concentración de Kirpich.
 *  5. Deslizamientos: umbral de lluvia del trópico húmedo (Larsen y Simon, 1993)
 *       I = 91.46·D^−0.82  [mm/h, D en horas], que baja con la lluvia de los días anteriores.
 *  6. Avenida torrencial: quebrada de montaña con el índice de Melton R = H/√A y lluvia que
 *     dispara deslizamientos en sus laderas: el lodo y las rocas aumentan el caudal.
 *  7. Sequía: el año mes a mes; con El Niño la bocatoma puede quedarse sin agua.
 * Funciones puras, sin DOM.
 */
import * as R from './rio.js';

// ═══════════════════════════════════════════════════════════════════════════
// 1. CLIMA DEL AÑO Y LLUVIA DE CADA MES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * fLluvia: lluvia frente a un año normal; fSub: aporte del agua subterránea al río.
 * Valores de referencia (editables en el código): con El Niño las lluvias del Caribe bajan
 * (en septiembre de 2015 el 77 % de la región quedó por debajo del promedio; IDEAM, 2015) y
 * los acuíferos se agotan; con La Niña suben (en diciembre de 2010 llovió cuatro veces lo
 * normal en las principales ciudades del Caribe; IDEAM, 2011).
 */
export const CLIMAS = {
  normal: { nombre: 'Año normal', corto: 'año normal', fLluvia: 1, fSub: 1 },
  nino: { nombre: 'El Niño (año seco)', corto: 'El Niño', fLluvia: 0.6, fSub: 0.75 },
  nina: { nombre: 'La Niña (año lluvioso)', corto: 'La Niña', fLluvia: 1.5, fSub: 1.1 },
};
export const clima = (id) => CLIMAS[id] ?? CLIMAS.normal;

/**
 * Caudal medio de cada mes frente al del año (régimen bimodal del Caribe: secas de
 * diciembre a abril, lluvias en mayo y de septiembre a noviembre; promedian 1).
 */
export const MESES = [
  { nombre: 'Ene', dias: 31, f: 0.5 }, { nombre: 'Feb', dias: 28, f: 0.4 }, { nombre: 'Mar', dias: 31, f: 0.4 },
  { nombre: 'Abr', dias: 30, f: 0.6 }, { nombre: 'May', dias: 31, f: 1.1 }, { nombre: 'Jun', dias: 30, f: 1.05 },
  { nombre: 'Jul', dias: 31, f: 0.8 }, { nombre: 'Ago', dias: 31, f: 0.95 }, { nombre: 'Sep', dias: 30, f: 1.35 },
  { nombre: 'Oct', dias: 31, f: 1.9 }, { nombre: 'Nov', dias: 30, f: 1.8 }, { nombre: 'Dic', dias: 31, f: 1.15 },
];

/** Nombres de los meses para los textos. */
export const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** «febrero y marzo», «septiembre, octubre y noviembre»; cortos: «feb y mar». */
export const listaMeses = (abreviados, cortos = false) => {
  const n = abreviados.map((a) => (cortos ? a.toLowerCase() : (NOMBRES_MES[MESES.findIndex((m) => m.nombre === a)] ?? a)));
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}` : (n[0] ?? '');
};

/** Lluvia media de cada mes en Santa Marta [mm], 1991–2020 (Climates to Travel, s. f.): unos 545 mm al año. */
export const LLUVIA_CIUDAD = [3, 2, 2, 14, 55, 60, 60, 70, 90, 110, 65, 15];

// ═══════════════════════════════════════════════════════════════════════════
// 2. LLUVIA–CAUDAL DEL RÍO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cuenca del río hasta la bocatoma: 400 km² con 900 mm de lluvia al año (75 mm en 30 días).
 * zonas: parte del área (y de la lluvia) de cada zona, la misma del caudal de cada una.
 */
export const CUENCA = { area: 400, coef: 0.35, P30medio: 75, zonas: { alta: 0.35, media: 0.35, baja: 0.3 } };
/** m³/s por cada mm de lluvia en 30 días: K = c·A/2592 (A en km², 30 días = 2 592 000 s). */
export const K30 = (CUENCA.coef * CUENCA.area) / 2592;
/** Caudal medio del río en la bocatoma (condición normal, cota 2.50 m) [m³/s]. */
export const Q_MEDIO = R.caudalRio(R.LLUVIAS.normal.cota).Q;
/** Aporte del agua subterránea (el río que queda cuando no llueve en un año normal) [m³/s]. */
export const Q_SUB = Q_MEDIO - K30 * CUENCA.P30medio;

/** Lluvia de 30 días en la cuenca a mitad de cada mes de un año normal [mm]. */
export const P30_MES = MESES.map((m) => (m.f * Q_MEDIO - Q_SUB) / K30);

/** Caudal del río en la bocatoma por la lluvia [m³/s]. Pt: lluvia de la tormenta repartida en la cuenca. */
export function caudalDeLluvia(P30, { climaId = 'normal', Pt = 0, fSub = clima(climaId).fSub } = {}) {
  return Math.max(0, fSub * Q_SUB + K30 * (Math.max(0, P30) + Math.max(0, Pt)));
}

/** Cota del río en la bocatoma por la lluvia [m.s.n.m.]. */
export const cotaDeLluvia = (P30, opciones = {}) => R.cotaDeCaudal(caudalDeLluvia(P30, opciones));

/**
 * Lluvia de 30 días que explica el caudal del río (inversa). Si el río está más bajo de lo
 * que da el agua subterránea, la lluvia es cero y el aporte subterráneo baja (sequía).
 */
export function lluviaDeCaudal(Q, { climaId = 'normal', Pt = 0 } = {}) {
  const fSub = clima(climaId).fSub;
  const P30 = (Q - fSub * Q_SUB) / K30 - Math.max(0, Pt);
  if (P30 >= 0) return { P30, fSub };
  return { P30: 0, fSub: Math.max(0, (Q - K30 * Math.max(0, Pt)) / Q_SUB) };
}

/** Caudal de un mes con el clima del año [m³/s]. */
export const caudalMes = (k, climaId = 'normal') => {
  const c = clima(climaId);
  return caudalDeLluvia(P30_MES[k] * c.fLluvia, { fSub: c.fSub });
};

/**
 * Sedimento en suspensión que trae el río con un caudal [mg/L]: curva de sedimento
 * interpolada (log–log) entre los escenarios de época seca, normal, lluvias, aguacero e
 * inundación, y prolongada con la pendiente de sus extremos (de 10 a 5 000 mg/L).
 */
const PUNTOS_SEDIMENTO = ['seca', 'normal', 'lluvias', 'aguacero', 'inundacion']
  .map((k) => [Math.log(R.caudalRio(R.LLUVIAS[k].cota).Q), Math.log(R.LLUVIAS[k].sedimento)]);
export function sedimentoDeCaudal(Q) {
  const x = Math.log(Math.max(1e-3, Q));
  const P = PUNTOS_SEDIMENTO;
  let k = 0;
  while (k < P.length - 2 && x > P[k + 1][0]) k += 1;
  const [x0, y0] = P[k];
  const [x1, y1] = P[k + 1];
  const y = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  return Math.min(5000, Math.max(10, Math.exp(y)));
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. TORMENTAS: CURVA INTENSIDAD–DURACIÓN–FRECUENCIA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * M: lluvia máxima diaria promedio del año [mm]; cv: su coeficiente de variación.
 * Valores de referencia para la llanura costera (editables: se reemplazan por los de la
 * estación del IDEAM).
 */
export const IDF = { M: 75, cv: 0.4 };
export const PERIODOS = [2, 5, 10, 25, 50, 100];

/** Factor de frecuencia de Gumbel: K_T = −(√6/π)·(0.5772 + ln(ln(T/(T−1)))). */
export const kGumbel = (T) => -(Math.sqrt(6) / Math.PI) * (0.5772 + Math.log(Math.log(T / (T - 1))));
/** Lluvia máxima en 24 h para un período de retorno [mm]. */
export const lluvia24 = (T, M = IDF.M, cv = IDF.cv) => M + kGumbel(T) * cv * M;
/** Período de retorno de una lluvia diaria [años] (inversa de Gumbel). */
export function periodoDeLluvia24(P24, M = IDF.M, cv = IDF.cv) {
  const K = (P24 - M) / (cv * M);
  const y = 0.5772 + (Math.PI / Math.sqrt(6)) * K;
  const F = Math.exp(-Math.exp(-y));
  return F >= 1 ? Infinity : 1 / (1 - F);
}
/** Lluvia en D minutos (Dyck y Peschke): P(D) = P24·(D/1440)^0.25 [mm]. */
export const lluviaDuracion = (T, D, M = IDF.M) => lluvia24(T, M) * (Math.min(D, 1440) / 1440) ** 0.25;
/** Intensidad media en D minutos [mm/h]. */
export const intensidad = (T, D, M = IDF.M) => lluviaDuracion(T, D, M) / (D / 60);

/** Dónde cae la tormenta: parte de la cuenca, si toca las laderas de montaña y la ciudad. */
export const ZONAS_TORMENTA = {
  cuenca: { nombre: 'Toda la cuenca', fraccion: 1, laderas: ['alta', 'media'], ciudad: true },
  alta: { nombre: 'Zona alta (montaña)', fraccion: CUENCA.zonas.alta, laderas: ['alta'], ciudad: false },
  media: { nombre: 'Zona media (piedemonte)', fraccion: CUENCA.zonas.media, laderas: ['media'], ciudad: false },
  baja: { nombre: 'Zona baja y la ciudad', fraccion: CUENCA.zonas.baja, laderas: [], ciudad: true },
};

/** Tormenta de hoy: T = 0 es sin tormenta. D en minutos. */
export function tormenta({ T = 0, D = 180, zona = 'cuenca', M = IDF.M } = {}) {
  const z = ZONAS_TORMENTA[zona] ?? ZONAS_TORMENTA.cuenca;
  if (!T) return { activa: false, T: 0, D, zona, z, P: 0, I: 0, Pcuenca: 0, P24: 0 };
  const P = lluviaDuracion(T, D, M);
  return { activa: true, T, D, zona, z, P, I: P / (D / 60), Pcuenca: P * z.fraccion, P24: lluvia24(T, M) };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. ARROYO URBANO: MÉTODO RACIONAL
// ═══════════════════════════════════════════════════════════════════════════

/** Tiempo de concentración de Kirpich [min]: tc = 0.0195·L^0.77·S^−0.385 (L en m). */
export const tcKirpich = (L, S) => 0.0195 * L ** 0.77 * S ** -0.385;

/**
 * Cuenca urbana del arroyo canalizado. El área sale de la crecida de diseño del canal
 * (8 m³/s): la de la tormenta de 2 años.
 */
export const ARROYO = { C: 0.75, L: 1800, S: 0.02, Qdiseno: 8, Tdiseno: 2 };
ARROYO.tc = tcKirpich(ARROYO.L, ARROYO.S);
ARROYO.area = (ARROYO.Qdiseno * 3.6) / (ARROYO.C * intensidad(ARROYO.Tdiseno, ARROYO.tc));

/** Intensidad que llega al arroyo: si la tormenta dura menos que tc, su lluvia se reparte en tc. */
function intensidadEnTc(t, tc, M) {
  return t.D >= tc ? intensidad(t.T, tc, M) : lluviaDuracion(t.T, t.D, M) / (tc / 60);
}

/** Crecida del arroyo por la tormenta (método racional) [m³/s]. */
export function crecidaArroyo(t, M = IDF.M) {
  if (!t.activa || !t.z.ciudad) return { activa: false, tc: ARROYO.tc, i: 0, Q: 0 };
  const i = intensidadEnTc(t, ARROYO.tc, M);
  return { activa: true, tc: ARROYO.tc, i, Q: (ARROYO.C * i * ARROYO.area) / 3.6 };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. DESLIZAMIENTOS Y 6. AVENIDAS TORRENCIALES
// ═══════════════════════════════════════════════════════════════════════════

/** Umbral de deslizamientos del trópico húmedo (Larsen y Simon, 1993) [mm/h], D en horas. */
export const umbralDeslizamiento = (Dh) => 91.46 * Dh ** -0.82;
/** Con el suelo húmedo por la lluvia de los días anteriores el umbral baja (supuesto del modelo). */
export const factorAntecedente = (P30) => Math.min(1.15, Math.max(0.6, 1 - (0.4 * (P30 - CUENCA.P30medio)) / 175));

export function deslizamientos(t, P30) {
  const Dh = t.D / 60;
  const Iu = umbralDeslizamiento(Dh) * factorAntecedente(P30);
  const enLaderas = t.activa && t.z.laderas.length > 0;
  const r = enLaderas ? t.I / Iu : 0;
  const nivel = r >= 1 ? 'alto' : (r >= 0.7 ? 'medio' : 'bajo');
  return { enLaderas, zonas: enLaderas ? t.z.laderas : [], Dh, Iu0: umbralDeslizamiento(Dh), fAnt: factorAntecedente(P30), Iu, r, nivel };
}

/**
 * Quebrada de montaña que llega al río en la zona alta. Índice de Melton R = H/√A
 * (H en km, A en km²): < 0.3 crecida de agua; 0.3 a 0.6 avenida de lodo; > 0.6 flujo de
 * detritos (Wilford y otros, 2004). Cv: fracción de sedimento del flujo.
 */
export const QUEBRADA = { area: 4.5, relieve: 1.45, L: 2600, S: 0.35, C: 0.6, km: 12 };
/** Velocidad con la que baja la onda de la avenida por el río (supuesto) [m/s]. */
export const VELOCIDAD_AVENIDA = 3;
QUEBRADA.melton = QUEBRADA.relieve / Math.sqrt(QUEBRADA.area);
QUEBRADA.tc = tcKirpich(QUEBRADA.L, QUEBRADA.S);
export function tipoTorrente(melton) {
  if (melton > 0.6) return { tipo: 'flujo de detritos', Cv: 0.45 };
  if (melton >= 0.3) return { tipo: 'avenida de lodo', Cv: 0.25 };
  return { tipo: 'crecida de agua', Cv: 0 };
}

export function avenidaTorrencial(t, desl, M = IDF.M) {
  const q = QUEBRADA;
  const tipo = tipoTorrente(q.melton);
  const llueve = t.activa && t.z.laderas.includes('alta');
  const i = llueve ? intensidadEnTc(t, q.tc, M) : 0;
  const Qagua = (q.C * i * q.area) / 3.6;
  const factor = 1 / (1 - tipo.Cv);               // el lodo y las rocas se suman al agua
  const probable = llueve && desl.r >= 1 && q.melton >= 0.3;
  // Horas que tarda en llegar a la bocatoma: el tiempo que hay para avisar a la ciudad
  const tLlegada = ((R.KM_BOCATOMA - q.km) * 1000) / VELOCIDAD_AVENIDA / 3600;
  return { ...q, ...tipo, llueve, i, Qagua, factor, Qlodo: Qagua * factor, probable, tLlegada };
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. EL AÑO MES A MES (SEQUÍA E INUNDACIONES)
// ═══════════════════════════════════════════════════════════════════════════

/** Recarga del acuífero por la lluvia en la llanura: parte de la lluvia que se infiltra (supuesto). */
export const RECARGA = 0.1;
/** Margen para la alerta amarilla: el río a menos de esto de la vega o de la rejilla [m]. */
export const MARGEN_ALERTA = 0.1;

export function anoClima(climaId = 'normal', cotaVega = 3.2) {
  const c = clima(climaId);
  const meses = MESES.map((m, k) => {
    const P30 = P30_MES[k] * c.fLluvia;
    const Q = caudalDeLluvia(P30, { fSub: c.fSub });
    const cota = R.cotaDeCaudal(Q);
    return {
      mes: m.nombre, P30, Pciudad: LLUVIA_CIUDAD[k] * c.fLluvia, Q, cota,
      capta: R.captaAgua(cota), vega: Math.max(0, cota - cotaVega), recarga: RECARGA * LLUVIA_CIUDAD[k] * c.fLluvia,
    };
  });
  return {
    meses,
    lluviaCiudad: meses.reduce((s, x) => s + x.Pciudad, 0),
    lluviaCuenca: meses.reduce((s, x) => s + x.P30, 0),
    recarga: meses.reduce((s, x) => s + x.recarga, 0),
    sinCaptar: meses.filter((x) => !x.capta).map((x) => x.mes),
    conVega: meses.filter((x) => x.vega > 0).map((x) => x.mes),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. TODO JUNTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * La lluvia en este instante. El estado del río es su cota (p.cotaRio): la lluvia de los
 * últimos 30 días se obtiene con la inversa, así siempre coincide con el río.
 * ctx: { Qcap: capacidad del canal del arroyo, Qcrecida: caudal que lleva, cotaVega: cota de la
 * vega del lote, cotaEf: cota del río con la represa (la de la creciente y la de la sequía) }.
 */
export function calcularLluvia(p, { Qcap, Qcrecida, cotaVega = 3.2, cotaEf = p.cotaRio } = {}) {
  const climaId = p.climaAno ?? 'normal';
  const c = clima(climaId);
  const M = p.lluviaM ?? IDF.M;
  const t = tormenta({ T: p.tormentaT ?? 0, D: p.tormentaD ?? 180, zona: p.tormentaZona ?? 'cuenca', M });
  const Qboc = R.caudalRio(p.cotaRio).Q;
  const inv = lluviaDeCaudal(Qboc, { climaId, Pt: t.Pcuenca });
  const P30 = inv.P30;
  const arroyo = crecidaArroyo(t, M);
  const desl = deslizamientos(t, P30);
  const avenida = avenidaTorrencial(t, desl, M);
  const ano = anoClima(climaId, cotaVega);
  const deficit = 1 - c.fLluvia;
  const capta = R.captaAgua(cotaEf);
  const sequia = !capta || ano.sinCaptar.length > 0;
  const vega = Math.max(0, cotaEf - cotaVega);
  const desborde = arroyo.activa && Number.isFinite(Qcap) && arroyo.Q > Qcap;
  // Nivel de alerta (como los del IDEAM): roja si la amenaza ya ocurre; naranja si es
  // probable pronto; amarilla si hay que estar atentos; verde si no hay amenazas
  const amenazas = [];
  if (vega > 0) amenazas.push('creciente del río');
  if (desborde || (Number.isFinite(Qcap) && Qcrecida > Qcap)) amenazas.push('desborde del arroyo');
  if (desl.nivel === 'alto') amenazas.push('deslizamientos');
  if (avenida.probable) amenazas.push('avenida torrencial');
  if (!capta) amenazas.push('sequía');
  const avisos = [];
  if (desl.nivel === 'medio') avisos.push('laderas cerca del umbral de deslizamientos');
  if (t.activa && t.T >= 10) avisos.push(`tormenta de ${t.T} años`);
  if (climaId === 'nino') avisos.push(ano.sinCaptar.length ? `El Niño: sin captar en ${listaMeses(ano.sinCaptar)}` : 'El Niño: año seco');
  if (climaId === 'nina') avisos.push(`La Niña: el río se sale a la vega en ${listaMeses(ano.conVega)}`);
  const atentos = [];
  if (t.activa && t.T < 10) atentos.push(`tormenta de ${t.T} años`);
  if (vega <= 0 && cotaEf > cotaVega - MARGEN_ALERTA) atentos.push('el río casi llega a la vega');
  if (capta && cotaEf < R.COTA_MIN_CAPTACION + MARGEN_ALERTA) atentos.push('el río casi queda bajo la rejilla');
  const alerta = amenazas.length ? 'roja' : (avisos.length ? 'naranja' : (atentos.length ? 'amarilla' : 'verde'));
  const motivos = amenazas.length ? amenazas : (avisos.length ? avisos : atentos);

  const checks = [];
  const f2 = (x) => x.toFixed(2);
  R.revisar(checks, arroyo.activa
    ? `Arroyo: la crecida de la tormenta ${f2(arroyo.Q)} m³/s ≤ capacidad del canal ${Number.isFinite(Qcap) ? f2(Qcap) : '—'} m³/s`
    : 'Arroyo: sin tormenta sobre la ciudad (el canal se revisa con la crecida de diseño)',
  !desborde, 'Si la tormenta da más caudal que el canal, el agua se sale a la calle y a la vega del cultivo: se agranda la sección o se retiene el agua aguas arriba.');
  R.revisar(checks, desl.enLaderas
    ? `Laderas: lluvia de ${t.I.toFixed(1)} mm/h en ${desl.Dh.toFixed(1)} h frente al umbral de deslizamientos de ${desl.Iu.toFixed(1)} mm/h`
    : 'Laderas: sin tormenta en la montaña ni en el piedemonte',
  desl.nivel === 'bajo', 'Por encima del umbral se esperan deslizamientos: se alerta a la población de las laderas y se vigilan las vías.', desl.nivel === 'alto' ? 'alerta' : 'aviso');
  R.revisar(checks, avenida.probable ? `Quebradas: avenida torrencial probable (${avenida.tipo}, ${f2(avenida.Qlodo)} m³/s)` : 'Quebradas de montaña: sin avenida torrencial',
    !avenida.probable, 'El lodo, las rocas y los troncos bajan de golpe por la quebrada: hay que evacuar sus orillas y el cauce del río aguas abajo.');
  R.revisar(checks, ano.sinCaptar.length ? `${c.nombre}: la bocatoma no capta en ${listaMeses(ano.sinCaptar)}` : `${c.nombre}: la bocatoma capta los 12 meses`,
    ano.sinCaptar.length === 0, 'En esos meses el río no alcanza la rejilla: hacen falta reservas (tanque, embalse o pozos) o soltar agua de la represa.');

  return {
    climaId, c, M, t, Qboc, P30, fSub: inv.fSub, K: K30, Qsub: Q_SUB, cotaEf, capta,
    arroyo, desborde, desl, avenida, ano, deficit, sequia, vega, amenazas, motivos, alerta, checks,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. LO QUE LA LLUVIA CAMBIA EN LOS CONTROLES DEL PANEL
// ═══════════════════════════════════════════════════════════════════════════

/** El río con una lluvia de 30 días, el clima y la tormenta de hoy: caudal, cota y sedimento. */
export function rioDeLluvia(P30, { climaId = 'normal', t = tormenta(), fSub } = {}) {
  const Q = caudalDeLluvia(P30, { climaId, Pt: t.Pcuenca, ...(fSub !== undefined ? { fSub } : {}) });
  return { P30, Q, cota: R.cotaDeCaudal(Q), sedimento: sedimentoDeCaudal(Q) };
}

/** Caudal con el que se revisa el canal del arroyo: el de la tormenta sobre la ciudad o el de diseño. */
export const crecidaParaCanal = (t, M = IDF.M) => {
  const a = crecidaArroyo(t, M);
  return a.activa ? a.Q : ARROYO.Qdiseno;
};

/** Parámetros que fija un escenario de lluvia de rio.js (null si no existe). */
export function parametrosEscenario(id, M = IDF.M) {
  const l = R.LLUVIAS[id];
  if (!l) return null;
  const tt = l.tormenta ?? { T: 0, D: 180, zona: 'cuenca' };
  return {
    cotaRio: l.cota, sedimento: l.sedimento, climaAno: l.clima ?? 'normal',
    tormentaT: tt.T, tormentaD: tt.D, tormentaZona: tt.zona,
    Qcrecida: crecidaParaCanal(tormenta({ ...tt, M }), M),
  };
}

