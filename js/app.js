/**
 * app.js — Controlador del simulador: deslizadores, tiempo simulado,
 * métricas, ecuaciones con sustitución numérica, gráficas y registro de datos.
 */
import * as M from './modelo.js';
import * as D from './diseno.js';
import * as S from './sistema.js';
import * as R from './rio.js';
import * as B from './bombas.js';
import * as G from './riego.js';
import * as A from './acuifero.js';
import * as P from './represa.js';
import * as H from './huella.js';
import { Escena } from './escena3d.js';
import { crearGrafica, actualizarGrafica, serieLinea, seriePuntos, paleta } from './graficas.js';
import { ExperimentoReynolds } from './reynolds.js';
import { Registro, INTERVALOS, relojSimulado, crearLibro, nombreArchivo, descargarArchivo, libroRepresa, libroAno, libroHuella, libroCultivos } from './datos.js';

// ── Estado ────────────────────────────────────────────────────────────────
const NIVEL_INICIAL = 4.4;
const HORA_INICIAL = 6 * 3600;
const p = { ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO };
const sim = { nivel: NIVEL_INICIAL, t: HORA_INICIAL, bomba: true, arranques: 0, corriendo: true, factor: 600, nivelEmbalse: p.nivelEmbalse };
let r = S.calcular(p, sim);
/** Cota del río en la bocatoma con la represa (el control del panel es la del río natural). */
const cotaEf = () => r.cotaRioEf ?? p.cotaRio;
let tabActiva = 'captacion';
// Registro de la simulación (serie de tiempo, arranques y paradas, escenarios) para el Excel
const registro = new Registro();
registro.reiniciar(HORA_INICIAL);

// ── Formato numérico (punto decimal, espacio fino para miles) ────────────
function fmt(x, d = 2) {
  if (!Number.isFinite(x)) return '—';
  const s = Math.abs(M.redondear(x, d)).toFixed(d);
  const [ent, dec] = s.split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const signo = x < 0 && M.redondear(x, d) !== 0 ? '−' : '';
  return signo + miles + (dec ? '.' + dec : '');
}

function fmtTiempo(seg) {
  if (!Number.isFinite(seg)) return 'no ocurre con el balance actual';
  if (seg < 3600) return `${fmt(seg / 60, 0)} min`;
  if (seg < 48 * 3600) return `${fmt(seg / 3600, 1)} h`;
  return `${fmt(seg / 86400, 1)} días`;
}

const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

/** Redondea hacia arriba a un valor "redondo" (1, 2 o 5 × 10ⁿ) para los ejes. */
/** «1 día», «3 días». */
const textoDias = (n) => `${fmt(n, 0)} ${Math.abs(n - 1) < 1e-9 ? 'día' : 'días'}`;

function techoRedondo(v) {
  if (v <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * e >= v) return m * e;
  return 10 * e;
}
const lps = M.lpsAm3s;

// ── Definición de pestañas y controles ─────────────────────────────────────
const TABS = [
  { id: 'rio', nombre: 'Río', extra: true, revision: true, tablas: true, perfil: true, intro: 'El río baja de la Sierra Nevada por tres zonas: alta (montaña), media (piedemonte) y baja (llanura y ciudad). Las lluvias suben su nivel y le traen sedimento; con una creciente se sale a la vega e inunda el cultivo de la llanura. Un vertimiento de aguas residuales le quita oxígeno y le agrega bacterias y nitratos, que siguen río abajo y pueden pasar al agua subterránea (pestaña Acuífero). Aquí se fijan el nivel del río natural, el sedimento y el vertimiento; la represa de la zona alta puede subir o bajar el caudal aguas abajo (pestaña Represa). Con la vista Cuenca se recorre el río de la montaña al mar.' },
  { id: 'represa', nombre: 'Represa', extra: true, revision: true, tablas: true, figura: 'Corte de la presa y del embalse', intro: 'En la zona alta, en el km 7, una presa cierra el valle y forma un embalse: guarda el agua de las lluvias y la suelta cuando hace falta. Al pie de la presa una central convierte la caída del agua en energía eléctrica, y una línea la lleva 40 km hasta la ciudad; por una tubería también se puede bajar agua del embalse a la ciudad por gravedad. Lo que la presa guarda o suelta cambia el caudal del río en las zonas alta, media y baja. Aquí se comparan el costo de producir la energía con el de llevarla a la ciudad, y el de bombear el agua del río con el de traerla del embalse. Con la vista Represa se ven la presa, el embalse, la central, la línea y la tubería.' },
  { id: 'captacion', nombre: 'Captación', extra: true, intro: 'El agua del río entra por la rejilla de la bocatoma, deja la arena en el desarenador y pasa al pozo de succión, de donde la bomba la eleva hasta el tanque. Aquí se fija cuánto se bombea, el tamaño del desarenador y cuánto cuesta la energía.' },
  { id: 'bombas', nombre: 'Bombas', extra: true, revision: true, tablas: true, intro: 'Cada estación de bombeo se diseña con su caudal y su altura dinámica. De ahí salen la potencia hidráulica (la útil), la potencia al freno (en el eje), la potencia eléctrica real que se paga y el motor comercial que se instala, que es la capacidad. La tabla compara los tipos de bomba para ese punto de diseño; las curvas muestran dónde trabaja la bomba, y el NPSH, si cavita.' },
  { id: 'tuberias', nombre: 'Tuberías', experimento: true, intro: 'La aducción lleva el agua cruda del río al tanque, impulsada por la bomba; la conducción la baja del tanque hasta la entrada del barrio, donde empieza la red de distribución. Cada tubería se elige del catálogo por material, clase de presión y diámetro comercial: el diámetro interno fija la velocidad y el régimen del flujo, y el material, la rugosidad (o el coeficiente C de Hazen-Williams) y la presión que aguanta.' },
  { id: 'tanque', nombre: 'Tanque', extra: true, intro: 'El tanque compensa la diferencia entre lo que entra por bombeo y lo que consume el sector. Dos interruptores de nivel controlan la bomba: se apaga cuando el agua llega al nivel de parada y vuelve a arrancar cuando baja al nivel de arranque. El consumo cambia a lo largo del día: cuando es menor que el caudal máximo diario el tanque sube, y en las horas pico baja.' },
  { id: 'red', nombre: 'Red', red: true, intro: 'La red de distribución reparte el agua en el barrio: una tubería principal, ramales que salen de ella con su válvula de compuerta, y en cada vivienda una acometida con abrazadera de toma, tubería de servicio, llave de paso y medidor. La conducción abastece todo el sector (QMD del tanque); aquí se diseña un barrio de ese sector. Diseña la red con los controles, mira las presiones en el plano y toca una vivienda para analizarla.' },
  { id: 'vivienda', nombre: 'Vivienda', intro: 'La presión en la casa es la altura del agua en el tanque menos lo que se pierde en la conducción, en la red y en la acometida (tubería de servicio, medidor y llave de paso). Con lo que queda sale el chorro del grifo.' },
  { id: 'riego', nombre: 'Riego', revision: true, tablas: true, intro: 'En la zona que se elija (alta, media o baja) el agua del río se bombea por una tubería hasta el cultivo; en la escena, el lote aparece en esa zona y a su altura sobre el río. Cuánta agua hace falta depende del clima de la zona, del cultivo y del método de riego; con eso se diseñan la tubería y la bomba de riego, y se compara con lo que consume la ciudad.' },
  { id: 'huella', nombre: 'Huella', extra: true, revision: true, tablas: true, intro: 'La huella hídrica es el agua que se usa para producir una tonelada de cosecha. La verde es la lluvia que el cultivo evapotranspira; la azul, el agua de riego que consume; y la gris, el agua que haría falta para diluir el nitrógeno que se lava. Aquí se compara entre cultivos y entre zonas, se calcula el CO₂ de llevar la cosecha a la ciudad en camión y lo que costaría con el impuesto al carbono, y cuánto se pierde cuando la creciente del río o el desborde del arroyo inundan el lote: depende de cuántos días aguanta encharcado cada cultivo.' },
  { id: 'acuifero', nombre: 'Acuífero', extra: true, revision: true, corte: true, intro: 'Bajo el valle hay agua subterránea: llena los poros de una capa de arena o grava (el acuífero) y se mueve muy despacio. En la montaña es un aluvión delgado de grava en el fondo del valle; en el piedemonte, un abanico de arena gruesa y grava; en la llanura, una capa de arena bajo arcilla. Según el nivel del río, el río le entrega agua al acuífero o el acuífero alimenta al río. Un pozo que bombea baja el nivel a su alrededor (cono de abatimiento) y, si el cono alcanza el río, atrae su agua: con ella pueden llegar los contaminantes. Aquí se eligen la zona, las capas del terreno y el pozo; en la escena, la vista Acuífero muestra el corte del terreno de esa zona con el agua subterránea en movimiento.' },
  { id: 'arroyo', nombre: 'Arroyo', intro: 'Con los aguaceros los arroyos de la ciudad crecen de golpe. El canal trapezoidal, excavado por debajo de la calle, tiene que conducir la crecida sin desbordarse.' },
  { id: 'datos', nombre: 'Datos', datos: true, intro: 'Guarda la información de la simulación en un libro de Excel: los parámetros y resultados, la serie de tiempo que se registra mientras corre el reloj, los arranques y paradas de la bomba, la revisión del diseño, las cantidades de obra y los escenarios que guardes para compararlos.' },
];

const ESTADOS_SERVICIO = {
  normal: 'Servicio normal',
  'baja-presion': 'Presión por debajo de la referencia',
  deficit: 'Desabastecimiento: tanque vacío',
  'sin-agua': 'No llega agua',
};

const MATERIALES = [
  { n: 0.013, nombre: 'Concreto liso (n = 0.013)' },
  { n: 0.015, nombre: 'Concreto (n = 0.015)' },
  { n: 0.025, nombre: 'Mampostería de piedra (n = 0.025)' },
  { n: 0.03, nombre: 'Tierra con maleza (n = 0.030)' },
];

const pulgadas = (mm) => `${fmt(mm / 25.4, 2)} in`;

const VISTAS_EXPERIMENTO = [
  { valor: 'lineas', nombre: 'Líneas de corriente' },
  { valor: 'tinta', nombre: 'Hilo de tinta (experimento de Reynolds)' },
];

const TUBOS_EXPERIMENTO = [
  { valor: 'vidrio', nombre: 'Tubo de vidrio (experimento)' },
  { valor: 'aduccion', nombre: 'Tubería de aducción del sistema' },
  { valor: 'distribucion', nombre: 'Tubería de conducción del sistema' },
];

const OPC_LLUVIA = [
  ...Object.entries(R.LLUVIAS).map(([valor, l]) => ({ valor, nombre: `${l.nombre}: cota ${fmt(l.cota)} m, ${R.miles(l.sedimento)} mg/L` })),
  { valor: 'personalizada', nombre: 'Personalizado (con los deslizadores)' },
];
const OPC_TIPOS_BOMBA = B.ORDEN_TIPOS.map((valor) => ({ valor, nombre: B.TIPOS_BOMBA[valor].nombre }));
const esBombaA = () => p.bombaAnalisis !== 'riego';
const esBombaR = () => p.bombaAnalisis === 'riego';
const sinVertimiento = () => p.vertTipo === 'ninguno';
const OPC_ZONAS = Object.entries(R.ZONAS).map(([valor, z]) => ({ valor, nombre: `${z.nombre}: ${z.lugar}, ${R.miles(z.elevacion)} m.s.n.m.` }));
const opcionesCultivo = () => Object.entries(G.CULTIVOS).map(([valor, c]) => ({ valor, nombre: `${c.nombre}${G.cultivoApto(valor, p.zonaRiego) ? '' : ' (no se da en esta zona)'}` }));
const DESCRIPCION_ACUIFERO = {
  alta: 'aluvión de grava en el fondo del valle',
  media: 'abanico de arena gruesa y grava',
  baja: 'arena bajo una capa de arcilla en la llanura',
};
function textoCotaRio(v) {
  const capta = R.captaAgua(cotaEf())
    ? `Lámina sobre la rejilla de la bocatoma: ${fmt(cotaEf() - R.REJILLA.fondo)} m (capta desde la cota ${fmt(R.COTA_MIN_CAPTACION)} m)`
    : `Por debajo de la cota ${fmt(R.COTA_MIN_CAPTACION)} m la bocatoma no capta y la bomba se detiene`;
  const represa = Math.abs(cotaEf() - v) > 0.005 ? `Con la represa el río queda a la cota ${fmt(cotaEf())} m. ` : '';
  const vega = cotaEf() > H.COTA_VEGA ? ` El río se sale a la vega: ${fmt(cotaEf() - H.COTA_VEGA)} m de agua sobre el lote de la zona baja.` : '';
  return `${represa}${capta}.${vega}`;
}

const CONTROLES = [
  { tab: 'rio', grupo: 'Nivel del río y lluvias' },
  { tab: 'rio', id: 'lluvia', clave: 'lluvia', etiqueta: 'Escenario de lluvia', tipo: 'opciones', opciones: OPC_LLUVIA,
    alCambiar: (v) => { const l = R.LLUVIAS[v]; if (l) { p.cotaRio = l.cota; p.sedimento = l.sedimento; } } },
  {
    tab: 'rio', id: 'cotaRio', clave: 'cotaRio', etiqueta: 'Cota de la lámina del río (sin la represa)', unidad: 'm.s.n.m.', min: 1.2, max: 3.8, paso: 0.01, dec: 2,
    escribir: (v) => { p.cotaRio = v; p.lluvia = 'personalizada'; },
    extra: textoCotaRio,
  },
  { tab: 'rio', id: 'sedimento', clave: 'sedimento', etiqueta: 'Sedimento en suspensión', unidad: 'mg/L', min: 10, max: 5000, paso: 10, dec: 0,
    escribir: (v) => { p.sedimento = v; p.lluvia = 'personalizada'; } },
  { tab: 'rio', grupo: 'Vertimiento de aguas residuales' },
  { tab: 'rio', id: 'vertTipo', clave: 'vertTipo', etiqueta: 'Tipo de vertimiento', tipo: 'opciones',
    opciones: Object.entries(R.VERTIMIENTOS).map(([valor, v]) => ({ valor, nombre: v.nombre })),
    alCambiar: (v) => { if (R.VERTIMIENTOS[v]?.Qtipico) p.Qvert = R.VERTIMIENTOS[v].Qtipico; } },
  { tab: 'rio', id: 'vertZona', clave: 'vertZona', etiqueta: 'Dónde entra al río', tipo: 'opciones', visible: () => !sinVertimiento(),
    opciones: Object.entries(R.PUNTOS_VERTIMIENTO).map(([valor, nombre]) => ({ valor, nombre })) },
  {
    tab: 'rio', id: 'Qvert', clave: 'Qvert', etiqueta: 'Caudal del vertimiento', unidad: 'L/s', min: 0.5, max: 500, paso: 0.5, dec: 1, visible: () => !sinVertimiento(),
    extra: () => { const v = R.VERTIMIENTOS[p.vertTipo]; return `DBO ${R.miles(v.DBO)} mg/L · coliformes fecales ${R.miles(v.CF)} NMP/100 mL · nitratos ${fmt(v.NO3, 0)} mg/L de N · oxígeno ${fmt(v.OD, 0)} mg/L`; },
  },
  { tab: 'rio', grupo: 'Criterios de calidad (referencia)' },
  { tab: 'rio', id: 'odMin', clave: 'odMin', etiqueta: 'Oxígeno disuelto mínimo (vida acuática)', unidad: 'mg/L', min: 2, max: 8, paso: 0.1, dec: 1 },
  { tab: 'rio', id: 'cfMax', clave: 'cfMax', etiqueta: 'Coliformes fecales máximos para potabilizar', unidad: 'NMP/100 mL', min: 100, max: 20000, paso: 100, dec: 0 },

  { tab: 'represa', grupo: 'Presa y embalse' },
  { tab: 'represa', id: 'alturaPresa', clave: 'alturaPresa', etiqueta: 'Altura de la presa', unidad: 'm', min: 15, max: 80, paso: 1, dec: 0,
    extra: (v) => `Guarda hasta ${fmt(P.volumen(P.nivelMaximo(v)) / 1e6, 2)} millones de m³ con el agua a ${fmt(P.nivelMaximo(v), 0)} m (deja ${P.PRESA.bordeLibre} m de borde libre)` },
  {
    tab: 'represa', id: 'nivelEmbalse', etiqueta: 'Nivel del agua en el embalse ahora', unidad: 'm', min: 0, max: () => P.nivelMaximo(p.alturaPresa), paso: 0.1, dec: 2,
    leer: () => sim.nivelEmbalse,
    escribir: (v) => { sim.nivelEmbalse = limitar(v, 0, P.nivelMaximo(p.alturaPresa)); },
    extra: () => `Nivel mínimo de operación: ${fmt(P.nivelMinimo(p.alturaPresa), 1)} m (${fmt(P.PRESA.fraccionMinima * 100, 0)} % de la presa); por debajo las turbinas se detienen`,
  },
  { tab: 'represa', grupo: 'Operación' },
  { tab: 'represa', id: 'operacionPresa', clave: 'operacionPresa', etiqueta: 'Qué hace la presa', tipo: 'opciones',
    opciones: Object.entries(P.OPERACIONES).map(([valor, nombre]) => ({ valor, nombre })) },
  { tab: 'represa', id: 'Qpresa', clave: 'Qpresa', etiqueta: 'Caudal fijo que suelta', unidad: 'm³/s', min: 0.1, max: 8, paso: 0.05, dec: 2,
    visible: () => p.operacionPresa === 'fijo', extra: (v) => `Le entran en promedio ${fmt(P.caudalMedioEntrada(), 3)} m³/s: ${v > P.caudalMedioEntrada() ? 'soltando más, el embalse se vacía' : 'soltando menos, el embalse se llena'}` },
  { tab: 'represa', id: 'caudalAmbiental', clave: 'caudalAmbiental', etiqueta: 'Caudal ambiental: lo mínimo que siempre suelta', unidad: '%', min: 10, max: 60, paso: 1, dec: 0,
    extra: (v) => `${fmt((v / 100) * P.caudalMedioEntrada(), 3)} m³/s: el ${fmt(v, 0)} % del caudal medio que entra al embalse` },
  { tab: 'represa', grupo: 'Central hidroeléctrica' },
  { tab: 'represa', id: 'QturbMax', clave: 'QturbMax', etiqueta: 'Caudal máximo de las turbinas (capacidad)', unidad: 'm³/s', min: 0.5, max: 6, paso: 0.1, dec: 2 },
  { tab: 'represa', id: 'etaTurbina', clave: 'etaTurbina', etiqueta: 'Eficiencia de la turbina y el generador', unidad: '%', min: 60, max: 95, paso: 1, dec: 0, aUI: (v) => v * 100, deUI: (v) => v / 100 },
  { tab: 'represa', grupo: 'Llevar la energía y el agua a la ciudad' },
  { tab: 'represa', id: 'tensionLinea', clave: 'tensionLinea', etiqueta: 'Tensión de la línea eléctrica (40 km)', tipo: 'opciones', numero: true,
    opciones: P.TENSIONES.map((v) => ({ valor: v, nombre: `${fmt(v, 1)} kV` })) },
  { tab: 'represa', id: 'costoGeneracion', clave: 'costoGeneracion', etiqueta: 'Costo de producir la energía (operación)', unidad: 'COP/kWh', min: 10, max: 300, paso: 5, dec: 0 },
  { tab: 'represa', id: 'costoLinea', clave: 'costoLinea', etiqueta: 'Costo de operar la línea', unidad: 'COP/kWh', min: 0, max: 100, paso: 1, dec: 0 },
  { tab: 'represa', id: 'costoGravedad', clave: 'costoGravedad', etiqueta: 'Costo de operar la tubería por gravedad', unidad: 'COP/m³', min: 5, max: 300, paso: 5, dec: 0 },
  { tab: 'represa', id: 'tarifa2', clave: 'tarifaKWh', etiqueta: 'Tarifa de la energía de la red', unidad: 'COP/kWh', min: 300, max: 1500, paso: 10, dec: 0 },

  { tab: 'captacion', grupo: 'Bombeo desde el río' },
  { tab: 'captacion', id: 'Qbombeo', clave: 'Qbombeo', etiqueta: 'Caudal bombeado', unidad: 'L/s', min: 0.1, max: 30, paso: 0.05, dec: 2 },
  { tab: 'captacion', id: 'eficiencia', clave: 'eficiencia', etiqueta: 'Eficiencia de la bomba', unidad: '%', min: 40, max: 90, paso: 1, dec: 0, aUI: (v) => v * 100, deUI: (v) => v / 100 },
  { tab: 'captacion', grupo: 'Tubería de succión (pozo → bomba)' },
  { tab: 'captacion', id: 'tuboSuccion', tubo: 'Succion', tipo: 'tubo', etiqueta: 'Tubería de succión' },
  { tab: 'captacion', id: 'Lsuccion', clave: 'Lsuccion', etiqueta: 'Longitud de la succión', unidad: 'm', min: 2, max: 30, paso: 0.5, dec: 1 },
  { tab: 'captacion', grupo: 'Desarenador de la bocatoma' },
  { tab: 'captacion', id: 'desLongitud', clave: 'desLongitud', etiqueta: 'Longitud del desarenador (L)', unidad: 'm', min: 2, max: 15, paso: 0.1, dec: 2 },
  { tab: 'captacion', id: 'desAncho', clave: 'desAncho', etiqueta: 'Ancho del desarenador (B)', unidad: 'm', min: 0.5, max: 3, paso: 0.05, dec: 2 },
  { tab: 'captacion', id: 'desProfundidad', clave: 'desProfundidad', etiqueta: 'Profundidad útil (h)', unidad: 'm', min: 0.4, max: 2, paso: 0.05, dec: 2 },
  { tab: 'captacion', grupo: 'Costo de la energía' },
  { tab: 'captacion', id: 'tarifa', clave: 'tarifaKWh', etiqueta: 'Tarifa de energía', unidad: 'COP/kWh', min: 300, max: 1500, paso: 10, dec: 0 },
  { tab: 'captacion', id: 'cargoFijo', clave: 'cargoFijo', etiqueta: 'Cargo fijo mensual', unidad: 'COP', min: 0, max: 500000, paso: 5000, dec: 0 },

  { tab: 'bombas', grupo: 'Estación de bombeo' },
  { tab: 'bombas', id: 'bombaAnalisis', clave: 'bombaAnalisis', etiqueta: 'Qué estación se diseña', tipo: 'opciones', opciones: [
    { valor: 'acueducto', nombre: 'Acueducto: del río al tanque' }, { valor: 'riego', nombre: 'Riego: del río a los cultivos' }] },
  { tab: 'bombas', grupo: 'Bomba del acueducto', visible: esBombaA },
  { tab: 'bombas', id: 'tipoBombaA', clave: 'tipoBombaA', etiqueta: 'Tipo de bomba', tipo: 'opciones', opciones: OPC_TIPOS_BOMBA, visible: esBombaA },
  { tab: 'bombas', id: 'rpmA', clave: 'rpmA', etiqueta: 'Velocidad de giro', tipo: 'opciones', numero: true, opciones: B.VELOCIDADES, visible: esBombaA },
  { tab: 'bombas', id: 'nBombasA', clave: 'nBombasA', etiqueta: 'Bombas trabajando en paralelo', unidad: '', min: 1, max: 4, paso: 1, dec: 0, visible: esBombaA },
  { tab: 'bombas', id: 'reservaA', clave: 'reservaA', etiqueta: 'Una bomba más, de reserva', tipo: 'casilla', visible: esBombaA },
  {
    tab: 'bombas', id: 'cotaEjeA', clave: 'cotaEjeA', etiqueta: 'Cota del eje de la bomba', unidad: 'm.s.n.m.', min: 2, max: 10, paso: 0.1, dec: 2,
    visible: () => esBombaA() && !B.TIPOS_BOMBA[p.tipoBombaA]?.sumergida,
    extra: (v) => `Altura de succión: ${fmt(v - (cotaEf() - S.DESCENSO_POZO))} m sobre el agua del pozo de succión`,
  },
  { tab: 'bombas', id: 'eficiencia2', clave: 'eficiencia', etiqueta: 'Eficiencia de la bomba', unidad: '%', min: 40, max: 90, paso: 1, dec: 0, aUI: (v) => v * 100, deUI: (v) => v / 100, visible: esBombaA },
  { tab: 'bombas', id: 'Qbombeo4', clave: 'Qbombeo', etiqueta: 'Caudal bombeado', unidad: 'L/s', min: 0.1, max: 30, paso: 0.05, dec: 2, visible: esBombaA },
  { tab: 'bombas', grupo: 'Bomba de riego', visible: esBombaR },
  { tab: 'bombas', id: 'tipoBombaR', clave: 'tipoBombaR', etiqueta: 'Tipo de bomba', tipo: 'opciones', opciones: OPC_TIPOS_BOMBA, visible: esBombaR },
  { tab: 'bombas', id: 'rpmR', clave: 'rpmR', etiqueta: 'Velocidad de giro', tipo: 'opciones', numero: true, opciones: B.VELOCIDADES, visible: esBombaR },
  { tab: 'bombas', id: 'nBombasR', clave: 'nBombasR', etiqueta: 'Bombas trabajando en paralelo', unidad: '', min: 1, max: 4, paso: 1, dec: 0, visible: esBombaR },
  { tab: 'bombas', id: 'reservaR', clave: 'reservaR', etiqueta: 'Una bomba más, de reserva', tipo: 'casilla', visible: esBombaR },
  { tab: 'bombas', id: 'succionR', clave: 'succionR', etiqueta: 'Altura de succión (eje sobre el agua del río)', unidad: 'm', min: 0, max: 8, paso: 0.1, dec: 1,
    visible: () => esBombaR() && !B.TIPOS_BOMBA[p.tipoBombaR]?.sumergida },
  { tab: 'bombas', id: 'eficienciaR', clave: 'eficienciaR', etiqueta: 'Eficiencia de la bomba', unidad: '%', min: 40, max: 90, paso: 1, dec: 0, aUI: (v) => v * 100, deUI: (v) => v / 100, visible: esBombaR },

  { tab: 'tuberias', grupo: 'Cálculo de las pérdidas' },
  { tab: 'tuberias', id: 'metodoPerdidas', clave: 'metodoPerdidas', etiqueta: 'Ecuación de fricción', tipo: 'opciones', opciones: [
    { valor: 'darcy', nombre: 'Darcy-Weisbach con rugosidad ε (Swamee-Jain)' }, { valor: 'hazen', nombre: 'Hazen-Williams con coeficiente C' }] },
  { tab: 'tuberias', grupo: 'Aducción: bombeo del río al tanque' },
  { tab: 'tuberias', id: 'Qbombeo2', clave: 'Qbombeo', etiqueta: 'Caudal', unidad: 'L/s', min: 0.1, max: 30, paso: 0.05, dec: 2 },
  {
    tab: 'tuberias', id: 'Vaduccion', etiqueta: 'Velocidad del flujo', unidad: 'm/s', min: 0.005, max: 5, paso: 0.001, dec: 3,
    leer: () => M.velocidadMedia(lps(p.Qbombeo), p.Daduccion),
    escribir: (v) => { p.Qbombeo = limitar(M.m3sAlps(M.caudalDesdeVelocidad(v, p.Daduccion)), 0.1, 30); },
  },
  { tab: 'tuberias', id: 'tuboAduccion', tubo: 'Aduccion', tipo: 'tubo', etiqueta: 'Tubería de aducción' },
  { tab: 'tuberias', id: 'Laduccion', clave: 'Laduccion', etiqueta: 'Longitud', unidad: 'm', min: 100, max: 2000, paso: 10, dec: 0 },
  { tab: 'tuberias', grupo: 'Conducción: del tanque a la entrada del barrio' },
  { tab: 'tuberias', id: 'Qdemanda', clave: 'Qdemanda', etiqueta: 'Caudal máximo diario del sector (QMD)', unidad: 'L/s', min: 0.1, max: 30, paso: 0.05, dec: 2 },
  {
    tab: 'tuberias', id: 'Vdistribucion', etiqueta: 'Velocidad con el QMD', unidad: 'm/s', min: 0.005, max: 6, paso: 0.001, dec: 3,
    leer: () => M.velocidadMedia(lps(p.Qdemanda), p.Ddistribucion),
    escribir: (v) => { p.Qdemanda = limitar(M.m3sAlps(M.caudalDesdeVelocidad(v, p.Ddistribucion)), 0.1, 30); },
  },
  { tab: 'tuberias', id: 'tuboConduccion', tubo: 'Conduccion', tipo: 'tubo', etiqueta: 'Tubería de conducción' },
  { tab: 'tuberias', id: 'Ldistribucion', clave: 'Ldistribucion', etiqueta: 'Longitud', unidad: 'm', min: 100, max: 2000, paso: 10, dec: 0 },
  { tab: 'tuberias', grupo: 'Criterios de velocidad (referencia)' },
  { tab: 'tuberias', id: 'Vmin', clave: 'Vmin', etiqueta: 'Velocidad mínima', unidad: 'm/s', min: 0.1, max: 1.5, paso: 0.05, dec: 2 },
  { tab: 'tuberias', id: 'Vmax', clave: 'Vmax', etiqueta: 'Velocidad máxima', unidad: 'm/s', min: 1, max: 6, paso: 0.1, dec: 1 },
  { tab: 'tuberias', contenedor: 'experimento', id: 'expVista', clave: 'expVista', etiqueta: 'Cómo verlo', tipo: 'opciones', opciones: VISTAS_EXPERIMENTO },
  { tab: 'tuberias', contenedor: 'experimento', id: 'expTubo', clave: 'expTubo', etiqueta: 'Qué tubo mostrar', tipo: 'opciones', opciones: TUBOS_EXPERIMENTO },
  { tab: 'tuberias', contenedor: 'experimento', soloVidrio: true, id: 'expDiametro', clave: 'expDiametro', etiqueta: 'Diámetro del tubo de vidrio', unidad: 'mm', min: 2, max: 50, paso: 0.5, dec: 1, aUI: (v) => v * 1000, deUI: (v) => v / 1000 },
  { tab: 'tuberias', contenedor: 'experimento', soloVidrio: true, id: 'expVelocidad', clave: 'expVelocidad', etiqueta: 'Velocidad media del agua', unidad: 'm/s', min: 0.005, max: 2, paso: 0.005, dec: 3 },

  { tab: 'tanque', grupo: 'Dimensiones' },
  { tab: 'tanque', id: 'Dtanque', clave: 'Dtanque', etiqueta: 'Diámetro del tanque', unidad: 'm', min: 4, max: 20, paso: 0.1, dec: 2 },
  { tab: 'tanque', id: 'hMax', clave: 'hMax', etiqueta: 'Altura útil', unidad: 'm', min: 2, max: 8, paso: 0.1, dec: 2 },
  { tab: 'tanque', grupo: 'Control de la bomba' },
  { tab: 'tanque', id: 'controlBomba', clave: 'controlBomba', etiqueta: 'Modo de operación', tipo: 'opciones', opciones: [
    { valor: 'automatico', nombre: 'Automático por niveles (arranque y parada)' }, { valor: 'continuo', nombre: 'Continuo: la bomba nunca se apaga' }] },
  { tab: 'tanque', id: 'nivelParada', clave: 'nivelParada', etiqueta: 'Nivel de parada (se apaga)', unidad: 'm', min: 0.5, max: () => p.hMax, paso: 0.05, dec: 2, soloAuto: true },
  { tab: 'tanque', id: 'nivelArranque', clave: 'nivelArranque', etiqueta: 'Nivel de arranque (vuelve a encender)', unidad: 'm', min: 0.1, max: () => p.nivelParada - 0.2, paso: 0.05, dec: 2, soloAuto: true },
  { tab: 'tanque', grupo: 'Consumo del sector' },
  { tab: 'tanque', id: 'curvaDemanda', clave: 'curvaDemanda', etiqueta: 'Consumo a lo largo del día', tipo: 'opciones', opciones: [
    { valor: 'horaria', nombre: 'Curva horaria (picos de mañana y tarde)' }, { valor: 'constante', nombre: 'Constante e igual al QMD' }] },
  { tab: 'tanque', id: 'k1', clave: 'k1', etiqueta: 'k1 = QMD / Qmd', unidad: '', min: 1.1, max: 1.5, paso: 0.05, dec: 2 },
  { tab: 'tanque', id: 'k2', clave: 'k2', etiqueta: 'k2 = QMH / QMD', unidad: '', min: 1.2, max: 1.8, paso: 0.05, dec: 2 },
  { tab: 'tanque', grupo: 'Operación' },
  {
    tab: 'tanque', id: 'nivel', etiqueta: 'Nivel actual del agua', unidad: 'm', min: 0, max: () => p.hMax, paso: 0.01, dec: 2,
    leer: () => sim.nivel,
    escribir: (v) => { sim.nivel = limitar(v, 0, p.hMax); },
  },
  { tab: 'tanque', id: 'Qbombeo3', clave: 'Qbombeo', etiqueta: 'Caudal que entra (bombeo)', unidad: 'L/s', min: 0.1, max: 30, paso: 0.05, dec: 2 },
  { tab: 'tanque', id: 'Qdemanda2', clave: 'Qdemanda', etiqueta: 'Caudal máximo diario del sector (QMD)', unidad: 'L/s', min: 0.1, max: 30, paso: 0.05, dec: 2 },

  { tab: 'red', grupo: 'Trazado' },
  { tab: 'red', id: 'nRamales', clave: 'nRamales', etiqueta: 'Número de ramales', unidad: '', min: 1, max: 4, paso: 1, dec: 0 },
  { tab: 'red', id: 'nViviendas', clave: 'nViviendas', etiqueta: 'Viviendas por ramal', unidad: '', min: 2, max: 8, paso: 1, dec: 0 },
  { tab: 'red', id: 'Lentrada', clave: 'Lentrada', etiqueta: 'Entrada del barrio → primer ramal', unidad: 'm', min: 10, max: 200, paso: 5, dec: 0 },
  { tab: 'red', id: 'sepRamales', clave: 'sepRamales', etiqueta: 'Separación entre ramales', unidad: 'm', min: 20, max: 150, paso: 5, dec: 0 },
  { tab: 'red', id: 'sepViviendas', clave: 'sepViviendas', etiqueta: 'Separación entre viviendas', unidad: 'm', min: 6, max: 40, paso: 1, dec: 0 },
  { tab: 'red', id: 'pendPrincipal', clave: 'pendPrincipal', etiqueta: 'Pendiente del terreno en la principal', unidad: '%', min: -5, max: 5, paso: 0.1, dec: 1, aUI: (v) => v * 100, deUI: (v) => v / 100, extra: (v) => (v >= 0 ? 'Positiva: el terreno sube aguas abajo' : 'Negativa: el terreno baja aguas abajo') },
  { tab: 'red', id: 'pendRamal', clave: 'pendRamal', etiqueta: 'Pendiente del terreno en los ramales', unidad: '%', min: -5, max: 5, paso: 0.1, dec: 1, aUI: (v) => v * 100, deUI: (v) => v / 100 },
  { tab: 'red', grupo: 'Tuberías de la red' },
  { tab: 'red', id: 'tuboPrincipal', tubo: 'Principal', tipo: 'tubo', etiqueta: 'Tubería principal' },
  { tab: 'red', id: 'tuboRamal', tubo: 'Ramal', tipo: 'tubo', etiqueta: 'Ramales distribuidores' },
  { tab: 'red', grupo: 'Accesorios y maniobra' },
  { tab: 'red', id: 'valvulasRamal', clave: 'valvulasRamal', etiqueta: 'Válvula de compuerta con caja al inicio de cada ramal', tipo: 'casilla' },
  { tab: 'red', id: 'valvulaAire', clave: 'valvulaAire', etiqueta: 'Válvula de aire en el punto alto', tipo: 'casilla' },
  { tab: 'red', id: 'valvulaPurga', clave: 'valvulaPurga', etiqueta: 'Válvula de purga en el punto bajo', tipo: 'casilla' },
  { tab: 'red', id: 'hidrante', clave: 'hidrante', etiqueta: 'Hidrante contra incendios al final de la principal', tipo: 'casilla' },
  { tab: 'red', id: 'incendio', clave: 'incendio', etiqueta: 'Simular el uso del hidrante (incendio)', tipo: 'casilla', soloHidrante: true },
  { tab: 'red', id: 'Qincendio', clave: 'Qincendio', etiqueta: 'Caudal del hidrante', unidad: 'L/s', min: 1, max: 20, paso: 0.5, dec: 1, soloHidrante: true },
  { tab: 'red', id: 'ramalCerrado', clave: 'ramalCerrado', etiqueta: 'Cerrar la válvula de un ramal (reparación)', tipo: 'opciones', numero: true,
    opciones: () => [{ valor: 0, nombre: 'Todas las válvulas abiertas' }, ...Array.from({ length: Math.round(p.nRamales) }, (_, j) => ({ valor: j + 1, nombre: `Cerrar el ramal ${j + 1}` }))] },
  { tab: 'red', id: 'casaAnalisis', clave: 'casaAnalisis', etiqueta: 'Vivienda de análisis', tipo: 'opciones',
    opciones: () => [{ valor: 'auto', nombre: 'La de menor presión (crítica)' },
      ...Array.from({ length: Math.round(p.nRamales) * Math.round(p.nViviendas) }, (_, i) => {
        const j = Math.floor(i / Math.round(p.nViviendas)) + 1;
        const k = (i % Math.round(p.nViviendas)) + 1;
        return { valor: `${j}-${k}`, nombre: `Ramal ${j}, vivienda ${k}` };
      })] },
  { tab: 'red', grupo: 'Demanda por vivienda' },
  { tab: 'red', id: 'habitantes', clave: 'habitantes', etiqueta: 'Habitantes por vivienda', unidad: 'hab', min: 1, max: 12, paso: 0.5, dec: 1 },
  { tab: 'red', id: 'dotacion', clave: 'dotacion', etiqueta: 'Dotación neta', unidad: 'L/hab·d', min: 80, max: 250, paso: 5, dec: 0 },
  { tab: 'red', id: 'perdidas', clave: 'perdidas', etiqueta: 'Pérdidas técnicas', unidad: '%', min: 0, max: 50, paso: 1, dec: 0, aUI: (v) => v * 100, deUI: (v) => v / 100 },
  { tab: 'red', grupo: 'Zanja' },
  { tab: 'red', id: 'recubrimiento', clave: 'recubrimiento', etiqueta: 'Relleno sobre la tubería', unidad: 'm', min: 0.6, max: 2, paso: 0.05, dec: 2 },
  { tab: 'red', id: 'cama', clave: 'cama', etiqueta: 'Cama de apoyo', unidad: 'm', min: 0.05, max: 0.3, paso: 0.01, dec: 2 },
  { tab: 'red', id: 'holgura', clave: 'holgura', etiqueta: 'Espacio a cada lado del tubo', unidad: 'm', min: 0.15, max: 0.5, paso: 0.01, dec: 2 },
  { tab: 'red', grupo: 'Criterios de presión (referencia)' },
  { tab: 'red', id: 'presionMinima2', clave: 'presionMinima', etiqueta: 'Presión mínima en la red', unidad: 'm.c.a.', min: 5, max: 30, paso: 0.5, dec: 1 },
  { tab: 'red', id: 'presionMaxRed', clave: 'presionMaxRed', etiqueta: 'Presión estática máxima', unidad: 'm.c.a.', min: 30, max: 100, paso: 1, dec: 0 },

  { tab: 'vivienda', grupo: 'Grifo' },
  { tab: 'vivienda', id: 'apertura', clave: 'apertura', etiqueta: 'Apertura de la llave', unidad: '%', min: 5, max: 100, paso: 1, dec: 0, aUI: (v) => v * 100, deUI: (v) => v / 100 },
  { tab: 'vivienda', id: 'alturaGrifo', clave: 'alturaGrifo', etiqueta: 'Altura del grifo sobre el terreno', unidad: 'm', min: 0.5, max: 9, paso: 0.1, dec: 2 },
  { tab: 'vivienda', grupo: 'Acometida: de la red a la vivienda' },
  { tab: 'vivienda', id: 'tuboAcometida', tubo: 'Acometida', tipo: 'tubo', etiqueta: 'Tubería de servicio' },
  { tab: 'vivienda', id: 'Lacometida', clave: 'Lacometida', etiqueta: 'Longitud de la acometida', unidad: 'm', min: 2, max: 40, paso: 0.5, dec: 1 },
  { tab: 'vivienda', id: 'medidorDh', clave: 'medidorDh', etiqueta: 'Pérdida del medidor a su caudal máximo', unidad: 'm', min: 2, max: 25, paso: 0.5, dec: 1, extra: () => `Caudal máximo del medidor: ${fmt(p.medidorQmax, 1)} m³/h` },
  { tab: 'vivienda', grupo: 'Criterio de servicio' },
  { tab: 'vivienda', id: 'presionMinima', clave: 'presionMinima', etiqueta: 'Presión mínima de referencia', unidad: 'm.c.a.', min: 5, max: 30, paso: 0.5, dec: 1 },
  { tab: 'vivienda', id: 'Qdemanda3', clave: 'Qdemanda', etiqueta: 'Caudal máximo diario del sector (QMD)', unidad: 'L/s', min: 0.1, max: 30, paso: 0.05, dec: 2 },

  { tab: 'riego', grupo: 'Zona y cultivo' },
  { tab: 'riego', id: 'zonaRiego', clave: 'zonaRiego', etiqueta: 'Zona del río', tipo: 'opciones', opciones: OPC_ZONAS },
  { tab: 'riego', id: 'cultivo', clave: 'cultivo', etiqueta: 'Cultivo', tipo: 'opciones', opciones: opcionesCultivo },
  { tab: 'riego', id: 'areaRiego', clave: 'areaRiego', etiqueta: 'Área cultivada', unidad: 'ha', min: 0.5, max: 200, paso: 0.5, dec: 1 },
  { tab: 'riego', grupo: 'Sistema de riego' },
  { tab: 'riego', id: 'metodoRiego', clave: 'metodoRiego', etiqueta: 'Método de riego', tipo: 'opciones',
    opciones: () => Object.entries(G.METODOS_RIEGO).map(([valor, m]) => ({ valor, nombre: `${m.nombre} (Eₐ ${fmt(m.Ea * 100, 0)} %)${G.metodoAdecuado(p.cultivo, valor) ? '' : ' · no usual para este cultivo'}` })) },
  { tab: 'riego', id: 'horasRiego', clave: 'horasRiego', etiqueta: 'Horas de riego al día en la época seca', unidad: 'h', min: 2, max: 24, paso: 0.5, dec: 1 },
  { tab: 'riego', id: 'epoca', clave: 'epoca', etiqueta: 'Época del año', tipo: 'opciones', opciones: [
    { valor: 'seca', nombre: 'Época seca (con ella se diseña)' }, { valor: 'lluviosa', nombre: 'Época de lluvias' }] },
  { tab: 'riego', grupo: 'Tubería de riego: de la bomba al cultivo' },
  { tab: 'riego', id: 'tuboRiego', tubo: 'Riego', tipo: 'tubo', etiqueta: 'Tubería de riego' },
  { tab: 'riego', id: 'Lriego', clave: 'Lriego', etiqueta: 'Longitud de la tubería', unidad: 'm', min: 50, max: 3000, paso: 10, dec: 0 },
  { tab: 'riego', id: 'eficienciaR2', clave: 'eficienciaR', etiqueta: 'Eficiencia de la bomba de riego', unidad: '%', min: 40, max: 90, paso: 1, dec: 0, aUI: (v) => v * 100, deUI: (v) => v / 100 },

  { tab: 'huella', grupo: 'Cultivo (el mismo de la pestaña Riego)' },
  { tab: 'huella', id: 'zonaRiego2', clave: 'zonaRiego', etiqueta: 'Zona del río', tipo: 'opciones', opciones: OPC_ZONAS },
  { tab: 'huella', id: 'cultivo2', clave: 'cultivo', etiqueta: 'Cultivo', tipo: 'opciones', opciones: opcionesCultivo },
  { tab: 'huella', id: 'areaRiego2', clave: 'areaRiego', etiqueta: 'Área cultivada', unidad: 'ha', min: 0.5, max: 200, paso: 0.5, dec: 1 },
  { tab: 'huella', id: 'dosisN', clave: 'dosisN', etiqueta: 'Nitrógeno aplicado', unidad: '%', min: 0, max: 200, paso: 5, dec: 0,
    extra: (v) => `${fmt(((H.DATOS_CULTIVO[p.cultivo]?.N ?? 0) * v) / 100, 0)} kg/ha por cosecha (${fmt(v, 0)} % de la dosis típica para este cultivo)` },
  { tab: 'huella', grupo: 'Llevar la cosecha a la ciudad' },
  { tab: 'huella', id: 'capacidadCamion', clave: 'capacidadCamion', etiqueta: 'Capacidad del camión', unidad: 't', min: 2, max: 35, paso: 1, dec: 0 },
  { tab: 'huella', id: 'impuestoCarbono', clave: 'impuestoCarbono', etiqueta: 'Tarifa del impuesto al carbono', unidad: 'COP/t', min: 0, max: 200000, paso: 500, dec: 0,
    extra: () => 'Por tonelada de CO₂: la tarifa de 2026 es 29 070.49 COP (DIAN, Resolución 000003 de 2026)' },
  { tab: 'huella', grupo: 'Inundación del lote' },
  { tab: 'huella', id: 'lluvia2', clave: 'lluvia', etiqueta: 'Escenario de lluvia (el de la pestaña Río)', tipo: 'opciones', opciones: OPC_LLUVIA,
    alCambiar: (v) => { const l = R.LLUVIAS[v]; if (l) { p.cotaRio = l.cota; p.sedimento = l.sedimento; } } },
  {
    tab: 'huella', id: 'cotaRio2', clave: 'cotaRio', etiqueta: 'Cota del río sin la represa', unidad: 'm.s.n.m.', min: 1.2, max: 3.8, paso: 0.01, dec: 2,
    escribir: (v) => { p.cotaRio = v; p.lluvia = 'personalizada'; },
    extra: () => `La vega del lote de la zona baja está a la cota ${fmt(H.COTA_VEGA)} m; con la represa el río queda a la cota ${fmt(cotaEf())} m`,
  },
  { tab: 'huella', id: 'diasInundacion', clave: 'diasInundacion', etiqueta: 'Días que dura la creciente sobre el lote', unidad: 'días', min: 0.5, max: 20, paso: 0.5, dec: 1 },
  { tab: 'huella', id: 'Qcrecida2', clave: 'Qcrecida', etiqueta: 'Caudal de la crecida del arroyo', unidad: 'm³/s', min: 0.5, max: 40, paso: 0.1, dec: 2,
    extra: () => `El canal lleva hasta ${fmt(r.canal.Qcap)} m³/s; lo que sobra se sale y cubre el lote unas ${fmt(H.DIAS_ARROYO * 24, 0)} horas` },

  { tab: 'acuifero', grupo: 'Zona del río' },
  { tab: 'acuifero', id: 'zonaAcuifero', clave: 'zonaAcuifero', etiqueta: 'Dónde se mira el agua subterránea', tipo: 'opciones',
    opciones: Object.entries(R.ZONAS).map(([valor, z]) => ({ valor, nombre: `${z.nombre}: ${DESCRIPCION_ACUIFERO[valor]}` })),
    alCambiar: (v) => {
      const z = A.ZONAS_ACUIFERO[v];
      if (z) Object.assign(p, { materialAcuifero: z.material, espesorAcuifero: z.espesor, sueloAcuifero: z.suelo, tipoAcuifero: z.tipo });
    } },
  { tab: 'acuifero', grupo: 'Capas del terreno' },
  { tab: 'acuifero', id: 'sueloAcuifero', clave: 'sueloAcuifero', etiqueta: 'Suelo sobre el agua subterránea', tipo: 'opciones',
    opciones: Object.entries(R.SUELOS).map(([valor, x]) => ({ valor, nombre: `${x.nombre} (K = ${x.K} m/día)` })) },
  { tab: 'acuifero', id: 'tipoAcuifero', clave: 'tipoAcuifero', etiqueta: 'Tipo de acuífero', tipo: 'opciones',
    opciones: Object.entries(R.ACUIFEROS).map(([valor, a]) => ({ valor, nombre: a.capa ? `${a.nombre}: arcilla de ${a.capa.espesor} m encima` : `${a.nombre}: sin capa de arcilla` })) },
  {
    tab: 'acuifero', id: 'profFreatico', clave: 'profFreatico', etiqueta: 'Profundidad del agua subterránea', unidad: 'm', min: 0.5, max: 30, paso: 0.1, dec: 1,
    extra: (d) => {
      const a = r.acuifero;
      const nivel = a.terreno - d;
      const dif = a.hRio - nivel;
      return `Nivel a la cota ${fmt(nivel)} m: ${Math.abs(dif) < 0.05 ? 'igual que el río' : `${fmt(Math.abs(dif))} m ${dif > 0 ? 'por debajo' : 'por encima'} del río (cota ${fmt(a.hRio)} m)`}${a.zona === 'baja' ? '' : '; cotas medidas desde un lecho a la cota 1.00 m'}`;
    },
  },
  { tab: 'acuifero', id: 'materialAcuifero', clave: 'materialAcuifero', etiqueta: 'Material del acuífero', tipo: 'opciones',
    opciones: Object.entries(A.MATERIALES_ACUIFERO).map(([valor, x]) => ({ valor, nombre: `${x.nombre} (K = ${x.K} m/día)` })) },
  { tab: 'acuifero', id: 'espesorAcuifero', clave: 'espesorAcuifero', etiqueta: 'Espesor del acuífero', unidad: 'm', min: 5, max: 60, paso: 1, dec: 0 },
  { tab: 'acuifero', grupo: 'Pozo de una finca' },
  { tab: 'acuifero', id: 'Qpozo', clave: 'Qpozo', etiqueta: 'Caudal que bombea el pozo', unidad: 'L/s', min: 0, max: 30, paso: 0.5, dec: 1,
    extra: (q) => (q > 0 ? `Equivale al consumo de ${R.miles((q / 1000) / (r.qMedCasa * p.k1))} viviendas` : 'Pozo sin bombear') },
  { tab: 'acuifero', id: 'distanciaPozo', clave: 'distanciaPozo', etiqueta: 'Distancia del pozo al río', unidad: 'm', min: 5, max: 500, paso: 1, dec: 0 },

  { tab: 'arroyo', grupo: 'Sección del canal' },
  { tab: 'arroyo', id: 'perimetro', clave: 'perimetro', etiqueta: 'Perímetro mojado disponible (P)', unidad: 'm', min: 2, max: 12, paso: 0.05, dec: 2 },
  { tab: 'arroyo', id: 'anchoCanal', clave: 'anchoCanal', etiqueta: 'Ancho del fondo (b)', unidad: 'm', min: 0.2, max: () => p.perimetro - 0.2, paso: 0.05, dec: 2 },
  {
    tab: 'arroyo', id: 'taludCanal', clave: 'taludCanal', etiqueta: 'Talud de las paredes (z : 1)', unidad: 'H:V', min: 0, max: 3, paso: 0.05, dec: 2,
    extra: (z) => (z > 0 ? `Paredes a ${fmt((Math.atan(1 / z) * 180) / Math.PI, 1)}° con la horizontal` : 'z = 0: paredes verticales (canal rectangular)'),
  },
  { tab: 'arroyo', accion: 'optimo', texto: 'Usar el ancho óptimo (vértice de A(b))' },
  { tab: 'arroyo', grupo: 'Pendiente, material y crecida' },
  { tab: 'arroyo', id: 'pendiente', clave: 'pendiente', etiqueta: 'Pendiente del fondo (S)', unidad: 'm/m', min: 0.0005, max: 0.03, paso: 0.0005, dec: 4 },
  { tab: 'arroyo', id: 'nManning', clave: 'nManning', etiqueta: 'Material del canal', tipo: 'material' },
  { tab: 'arroyo', id: 'Qcrecida', clave: 'Qcrecida', etiqueta: 'Caudal de la crecida', unidad: 'm³/s', min: 0.5, max: 40, paso: 0.1, dec: 2 },
  { tab: 'arroyo', id: 'alturaCaida', clave: 'alturaCaida', etiqueta: 'Caída a la salida de la compuerta', unidad: 'm', min: 0.3, max: 4, paso: 0.05, dec: 2 },
];

const valorMax = (c) => (typeof c.max === 'function' ? c.max() : c.max);

function leerControl(c) {
  if (c.leer) return c.leer();
  const v = p[c.clave];
  return c.aUI ? c.aUI(v) : v;
}

function escribirControl(c, valorUI) {
  const v = limitar(valorUI, c.min, valorMax(c));
  if (c.escribir) c.escribir(v);
  else p[c.clave] = c.deUI ? c.deUI(v) : v;
}

// ── Construcción del panel ────────────────────────────────────────────────
const elPestanas = document.getElementById('pestanas');
const elFichas = document.getElementById('fichas');
const fichas = {};
const graficas = {};

function crearPanel() {
  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pestana';
    b.id = `pestana-${t.id}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', `ficha-${t.id}`);
    b.dataset.tab = t.id;
    b.innerHTML = `${t.nombre}<span class="alerta-mini" hidden></span>`;
    b.addEventListener('click', () => mostrarTab(t.id));
    elPestanas.appendChild(b);

    const f = document.createElement('section');
    f.className = 'ficha';
    f.id = `ficha-${t.id}`;
    f.setAttribute('role', 'tabpanel');
    f.setAttribute('aria-labelledby', b.id);
    if (t.datos) {
      crearFichaDatos(t, f);
      continue;
    }
    f.innerHTML = `
      <p class="intro">${t.intro}</p>
      ${t.red ? `<figure class="plano"><div class="svg-plano" role="img" aria-label="Plano de la red de distribución"></div><figcaption>Plano esquemático (sin escala). El color de cada vivienda es su presión en la hora pico con el tanque en el nivel de arranque: verde cumple, ocre está cerca del mínimo y rojo no cumple. Toca una vivienda para analizarla.</figcaption></figure>` : ''}
      ${t.corte ? `<figure class="plano corte-acuifero"><div class="svg-plano svg-corte" role="img" aria-label="Corte del terreno entre el río y el pozo"></div><figcaption>Corte esquemático del terreno desde el río hasta más allá del pozo (alturas exageradas). Las flechas muestran hacia dónde se mueve el agua subterránea.</figcaption></figure>` : ''}
      ${t.figura ? `<figure class="plano figura-tab"><div class="svg-plano svg-figura" role="img" aria-label="${t.figura}"></div><figcaption></figcaption></figure>` : ''}
      ${t.perfil ? `<figure class="plano perfil-rio"><div class="svg-plano svg-perfil" role="img" aria-label="Perfil del río por zonas con la calidad del agua"></div><figcaption>Perfil del cauce desde el nacimiento hasta el mar (sin escala horizontal; alturas exageradas). El color del río es el oxígeno disuelto y la franja de abajo, los coliformes fecales.</figcaption></figure>` : ''}
      <div class="controles"></div>
      <h3>Resultados</h3>
      <dl class="metricas"></dl>
      ${t.red || t.revision || t.id === 'tuberias' ? '<h3>Revisión del diseño</h3><ul class="revision"></ul>' : ''}
      ${t.tablas ? '<div class="tablas"></div>' : ''}
      ${t.red ? `<h3>Zanja típica</h3><figure class="zanja"><div class="svg-zanja" role="img" aria-label="Corte de la zanja"></div><figcaption></figcaption></figure>
        <h3>Cantidades de obra</h3><div class="tabla-cantidades"></div>` : ''}
      <h3>Modelo matemático</h3>
      <div class="ecuacion"></div>
      <figure class="grafica${t.tablas ? ' alta' : ''}"><div class="lienzo"><canvas aria-label="Gráfica de ${t.nombre.toLowerCase()}"></canvas></div><figcaption></figcaption></figure>
      ${t.extra ? `<figure class="grafica grafica-extra${t.tablas ? ' alta' : ''}"><div class="lienzo"><canvas aria-label="Segunda gráfica"></canvas></div><figcaption></figcaption></figure>` : ''}
      ${t.experimento ? `<section class="experimento" aria-labelledby="exp-${t.id}">
        <h3 id="exp-${t.id}">Laminar o turbulento: experimento de Reynolds</h3>
        <p class="intro">En 1883 Osborne Reynolds inyectó un hilo de tinta en el eje de un tubo de vidrio. Con poca velocidad la tinta sigue recta (flujo laminar); al aumentarla ondula y se rompe (transición) y, con más, se mezcla en toda la sección (flujo turbulento).</p>
        <div class="controles"></div>
        <figure class="animacion"><canvas aria-label="Animación del experimento de Reynolds"></canvas><figcaption></figcaption></figure>
        <dl class="metricas"></dl>
        <div class="ecuacion"></div>
      </section>` : ''}`;
    elFichas.appendChild(f);
    const graficaExtra = f.querySelector('.grafica-extra');
    const exp = f.querySelector('.experimento');
    fichas[t.id] = {
      raiz: f,
      plano: f.querySelector('.svg-plano:not(.svg-perfil):not(.svg-corte):not(.svg-figura)'),
      figura: f.querySelector('.svg-figura'),
      corte: f.querySelector('.svg-corte'),
      perfil: f.querySelector('.svg-perfil'),
      tablas: f.querySelector('.tablas'),
      revision: f.querySelector('.revision'),
      zanja: f.querySelector('.svg-zanja'),
      leyendaZanja: f.querySelector('.zanja figcaption'),
      cantidades: f.querySelector('.tabla-cantidades'),
      controles: f.querySelector('.controles'),
      metricas: f.querySelector('.metricas'),
      ecuacion: f.querySelector('.ecuacion'),
      canvas: f.querySelector('canvas'),
      leyenda: f.querySelector('figure.grafica figcaption'),
      canvas2: graficaExtra?.querySelector('canvas'),
      leyenda2: graficaExtra?.querySelector('figcaption'),
      exp: exp && {
        controles: exp.querySelector('.controles'),
        canvas: exp.querySelector('canvas'),
        leyenda: exp.querySelector('figcaption'),
        metricas: exp.querySelector('.metricas'),
        ecuacion: exp.querySelector('.ecuacion'),
      },
    };
  }

  elPestanas.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.id === tabActiva);
    const j = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    mostrarTab(TABS[j].id);
    document.getElementById(`pestana-${TABS[j].id}`).focus();
  });

  for (const c of CONTROLES) {
    const destino = c.contenedor === 'experimento' ? fichas[c.tab].exp.controles : fichas[c.tab].controles;
    if (c.grupo) {
      const h = document.createElement('h3');
      h.textContent = c.grupo;
      destino.appendChild(h);
      if (c.visible) c.el = { div: h };
      continue;
    }
    if (c.accion) {
      const div = document.createElement('div');
      div.className = 'acciones';
      div.innerHTML = `<button type="button" class="boton">${c.texto}</button>`;
      div.querySelector('button').addEventListener('click', () => {
        p.anchoCanal = M.seccionOptima(p.perimetro, p.taludCanal).b;
        cambio();
      });
      destino.appendChild(div);
      continue;
    }
    const div = document.createElement('div');
    div.className = 'control';
    if (c.tipo === 'material') {
      div.innerHTML = `<label for="c-${c.id}">${c.etiqueta}</label>
        <select id="c-${c.id}">${MATERIALES.map((m) => `<option value="${m.n}">${m.nombre}</option>`).join('')}</select>`;
      const sel = div.querySelector('select');
      sel.value = String(p.nManning);
      sel.addEventListener('change', () => { p.nManning = parseFloat(sel.value); cambio(); });
      c.el = { sel };
      destino.appendChild(div);
      continue;
    }
    if (c.tipo === 'opciones') {
      div.innerHTML = `<label for="c-${c.id}">${c.etiqueta}</label><select id="c-${c.id}"></select>`;
      const sel = div.querySelector('select');
      llenarOpciones(sel, typeof c.opciones === 'function' ? c.opciones() : c.opciones);
      sel.value = String(p[c.clave]);
      sel.addEventListener('change', () => {
        p[c.clave] = c.numero ? Number(sel.value) : sel.value;
        c.alCambiar?.(p[c.clave]);
        cambio();
      });
      c.el = { sel, div };
      destino.appendChild(div);
      continue;
    }
    if (c.tipo === 'casilla') {
      div.className = 'control casilla';
      div.innerHTML = `<label><input type="checkbox" id="c-${c.id}"> ${c.etiqueta}</label>`;
      const chk = div.querySelector('input');
      chk.checked = Boolean(p[c.clave]);
      chk.addEventListener('change', () => { p[c.clave] = chk.checked; cambio(); });
      c.el = { chk, div };
      destino.appendChild(div);
      continue;
    }
    if (c.tipo === 'tubo') {
      const t = c.tubo;
      div.className = 'control tubo';
      div.innerHTML = `<span class="etiqueta-tubo">${c.etiqueta}</span>
        <div class="selects-tubo">
          <label class="sr" for="m-${c.id}">Material</label><select id="m-${c.id}" title="Material">${Object.entries(D.MATERIALES).map(([k, m]) => `<option value="${k}" title="${m.nombre}">${m.corto} · C ${m.C}</option>`).join('')}</select>
          <label class="sr" for="d-${c.id}">Diámetro</label><select id="d-${c.id}" title="Diámetro nominal"></select>
          <label class="sr" for="k-${c.id}">Clase</label><select id="k-${c.id}" title="Clase de presión"></select>
        </div>
        <span class="extra"></span>`;
      const [selM, selD, selK] = div.querySelectorAll('select');
      selM.addEventListener('change', () => {
        const antes = D.especTubo(p[`mat${t}`], p[`clase${t}`], p[`dn${t}`]);
        p[`mat${t}`] = selM.value;
        const m = D.MATERIALES[selM.value];
        p[`clase${t}`] = m.clases.includes(p[`clase${t}`]) ? p[`clase${t}`] : m.clases[Math.min(2, m.clases.length - 1)];
        p[`dn${t}`] = D.diametroCercano(selM.value, p[`clase${t}`], antes.DI);
        cambio();
      });
      selD.addEventListener('change', () => { p[`dn${t}`] = selD.value; cambio(); });
      selK.addEventListener('change', () => { p[`clase${t}`] = selK.value; cambio(); });
      c.el = { selM, selD, selK, extra: div.querySelector('.extra'), div, tubo: true };
      destino.appendChild(div);
      continue;
    }
    div.innerHTML = `
      <div class="fila">
        <label for="r-${c.id}">${c.etiqueta}</label>
        <span class="valor"><input type="number" id="n-${c.id}" aria-label="${c.etiqueta} (${c.unidad})" step="${c.paso}"><span class="unidad">${c.unidad}</span></span>
      </div>
      <input type="range" id="r-${c.id}" step="${c.paso}">
      ${c.extra ? '<span class="extra"></span>' : ''}`;
    const rango = div.querySelector('input[type="range"]');
    const numero = div.querySelector('input[type="number"]');
    rango.addEventListener('input', () => { escribirControl(c, parseFloat(rango.value)); cambio(c); });
    const confirmar = () => {
      const v = parseFloat(numero.value.replace(',', '.'));
      if (Number.isFinite(v)) escribirControl(c, v);
      cambio();
    };
    numero.addEventListener('change', confirmar);
    numero.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); numero.blur(); } });
    c.el = { rango, numero, extra: div.querySelector('.extra'), div };
    destino.appendChild(div);
  }
}

const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function llenarOpciones(sel, opciones) {
  const clave = opciones.map((o) => `${o.valor}:${o.nombre}`).join('|');
  if (sel.__clave === clave) return;
  sel.innerHTML = opciones.map((o) => `<option value="${escAttr(o.valor)}">${escAttr(o.nombre)}</option>`).join('');
  sel.__clave = clave;
}

function sincronizarTubo(c) {
  const t = c.tubo;
  const mat = p[`mat${t}`];
  const m = D.MATERIALES[mat];
  const e = r.especs?.[t] || D.especTubo(mat, p[`clase${t}`], p[`dn${t}`]);
  c.el.selM.value = mat;
  llenarOpciones(c.el.selD, m.diametros.map((dn) => {
    const k = D.clasesValidas(mat, dn)[0] && (D.clasesValidas(mat, dn).includes(e.clase) ? e.clase : D.clasesValidas(mat, dn)[0]);
    const di = k ? m.medidas(dn, k).di : NaN;
    return { valor: dn, nombre: `${dn} (DI ${fmt(di, 1)} mm)` };
  }));
  c.el.selD.value = e.dn;
  llenarOpciones(c.el.selK, D.clasesValidas(mat, e.dn).map((k) => ({ valor: k, nombre: `${k} · ${fmt(m.medidas(e.dn, k).pn * 101.97, 0)} m.c.a.` })));
  c.el.selK.value = e.clase;
  const txt = `${m.nombre}: DE ${fmt(e.DE * 1000, 1)} mm, DI ${fmt(e.DI * 1000, 1)} mm, espesor ${fmt(e.e * 1000, 2)} mm · presión de trabajo ${fmt(e.pnMPa, 2)} MPa (${fmt(e.pnMca, 0)} m.c.a.) · C = ${e.C}, ε = ${fmt(e.rugosidad * 1000, 4)} mm · ${m.norma}`;
  if (c.el.extra.textContent !== txt) c.el.extra.textContent = txt;
  c.el.extra.title = m.nota;
}

function sincronizarControles(origen) {
  for (const c of CONTROLES) {
    if (!c.el) continue;
    if (c.soloVidrio) c.el.div.hidden = p.expTubo !== 'vidrio';
    if (c.soloAuto) c.el.div.hidden = p.controlBomba !== 'automatico';
    if (c.soloHidrante) c.el.div.hidden = !p.hidrante;
    if (c.visible) c.el.div.hidden = !c.visible();
    if (c.grupo) continue;
    if (c.el.tubo) { sincronizarTubo(c); continue; }
    if (c.el.chk) { c.el.chk.checked = Boolean(p[c.clave]); continue; }
    if (c.el.sel) {
      if (typeof c.opciones === 'function') llenarOpciones(c.el.sel, c.opciones());
      c.el.sel.value = String(p[c.clave]);
      continue;
    }
    const v = leerControl(c);
    const max = valorMax(c);
    c.el.rango.min = c.min;
    c.el.rango.max = max;
    c.el.numero.min = c.min;
    c.el.numero.max = max;
    if (c !== origen) c.el.rango.value = limitar(v, c.min, max);
    if (document.activeElement !== c.el.numero) c.el.numero.value = M.redondear(v, c.dec).toFixed(c.dec);
    const pct = ((limitar(v, c.min, max) - c.min) / (max - c.min)) * 100;
    c.el.rango.style.setProperty('--pct', `${pct}%`);
    if (c.el.extra) c.el.extra.textContent = c.extra(v);
  }
}

// ── Recalcular y pintar ─────────────────────────────────────────────────
function aplicarRestricciones() {
  p.anchoCanal = limitar(p.anchoCanal, 0.2, p.perimetro - 0.2);
  p.nRamales = Math.round(p.nRamales);
  p.nViviendas = Math.round(p.nViviendas);
  S.sincronizarTubos(p);
  sim.nivel = limitar(sim.nivel, 0, p.hMax);
  sim.nivelEmbalse = limitar(sim.nivelEmbalse, 0, P.nivelMaximo(p.alturaPresa));
}

function recalcular() {
  aplicarRestricciones();
  r = S.calcular(p, sim);
  if (r.bomba !== sim.bomba) {
    registro.agregarEvento(sim.t, sim.nivel, r.bomba, 'cambio del nivel, de los interruptores o del modo en el panel');
    if (r.bomba) sim.arranques += 1;
  }
  sim.bomba = r.bomba;
}

function cambio(origen) {
  recalcular();
  sincronizarControles(origen);
  pintarPanel();
  actualizarEscena();
}

/** La escena dibuja el río con la represa: recibe la cota efectiva en la bocatoma. */
function actualizarEscena() {
  if (!escena) return;
  const ef = cotaEf();
  escena.actualizar(Math.abs(ef - p.cotaRio) > 1e-9 ? { ...p, cotaRio: ef } : p, r, sim.nivel);
}

const ecu = {
  tipo: (t) => `<p class="tipo">${t}</p>`,
  formula: (t) => `<p class="formula">${t}</p>`,
  sust: (t) => `<p class="sustitucion">${t}</p>`,
  nota: (t, alerta = false) => `<p class="nota${alerta ? ' alerta' : ''}">${t}</p>`,
};
const i = (v) => `<i>${v}</i>`;

/**
 * Filas de resultados: [etiqueta, valor, unidad, nivel, decimales]. El valor puede ser
 * un texto ya formateado o un número (se formatea aquí con sus decimales y así pasa
 * completo al Excel). Mientras se arma una instantánea, las filas se guardan en `captura`.
 */
let captura = null;
function textoValor(valor, unidad, dec = 2) {
  if (typeof valor !== 'number') return valor;
  const txt = fmt(valor, dec);
  return unidad === 'COP' && Number.isFinite(valor) ? `$\u00a0${txt}` : txt;
}

function metricas(filas) {
  if (captura) captura.push(filas);
  return filas.map(([dt, valor, unidad = '', nivel = '', dec = 2]) =>
    `<dt>${dt}</dt><dd${nivel ? ` data-nivel="${nivel}"` : ''}>${textoValor(valor, unidad, dec)}${unidad ? `<small>${unidad}</small>` : ''}</dd>`).join('');
}

function setHTML(el, html) {
  if (el.__html !== html) { el.innerHTML = html; el.__html = html; }
}

/** Datos del experimento de Reynolds según el tubo elegido (vidrio o una tubería del sistema). */
function datosExperimento() {
  let D, V, Re, etiqueta;
  if (p.expTubo === 'aduccion') {
    ({ V, Re } = r.aduccion); D = p.Daduccion; etiqueta = 'Aducción';
  } else if (p.expTubo === 'distribucion') {
    ({ V, Re } = r.distribucion); D = p.Ddistribucion; etiqueta = 'Distribución';
  } else {
    D = p.expDiametro; V = p.expVelocidad; Re = M.reynoldsVelocidad(V, D); etiqueta = 'Tubo de vidrio';
  }
  const regimen = M.regimen(Re);
  const R = D / 2;
  const a2 = (2 * V) / (R * R);
  const uEje = regimen === 'laminar' ? 2 * V : (regimen === 'turbulento' ? M.velocidadMaximaTurbulenta(V) : null);
  const f = M.factorFriccion(Re, D);
  const vMax = M.redondear(Re < 2000 ? (2000 * M.MU) / (M.RHO * D) : 0, 4);
  const notas = {
    laminar: 'Las capas de agua se deslizan unas sobre otras sin mezclarse: la tinta sigue una línea recta y el perfil de velocidad es una parábola, con el doble de la velocidad media en el eje.',
    'transición': 'El flujo alterna entre ordenado y agitado: llegan ráfagas de remolinos, la tinta ondula y se rompe a ratos. Por eso este tramo no se usa para diseñar.',
    turbulento: 'Los remolinos mezclan el agua en toda la sección: la tinta se dispersa enseguida y el perfil se aplana (ley de potencia 1/7, con una velocidad en el eje de 1.22 veces la media). Es el régimen de las tuberías reales del sistema.',
  };
  return {
    config: { D, V, Re, regimen, etiqueta, vista: p.expVista },
    leyenda: p.expVista === 'lineas'
      ? 'Corte longitudinal del tubo con las líneas de corriente vistas por un observador que viaja con el agua: rectas y paralelas en laminar, onduladas en la transición y enrolladas en remolinos en turbulento. A la derecha, el perfil de velocidad (flechas proporcionales a u/V; la línea punteada es la velocidad media).'
      : 'Corte longitudinal del tubo. La tinta (naranja) sale de la aguja en el eje y los puntos azules marcan el agua; a la derecha, el perfil de velocidad (flechas proporcionales a u/V; la línea punteada es la velocidad media).',
    metricas: metricas([
      ['Número de Reynolds', `${fmt(Re, 0)} (${regimen})`, '', regimen === 'laminar' ? 'ok' : (regimen === 'turbulento' ? 'alerta' : 'aviso')],
      ['Velocidad media', fmt(V, 3), 'm/s'],
      ['Velocidad en el eje', uEje !== null ? fmt(uEje, 3) : `entre ${fmt(1.22 * V, 3)} y ${fmt(2 * V, 3)}`, 'm/s'],
      ['Factor de fricción f', fmt(f, 4), ''],
      ...(Re < 2000 && p.expTubo === 'vidrio' ? [['Velocidad máxima para seguir laminar', fmt(vMax, 4), 'm/s']] : []),
    ]),
    ecuacion: [
      ecu.tipo('Decimales: número de Reynolds'),
      ecu.formula(`${i('Re')} = ρ${i('VD')} / μ  (laminar < 2000; turbulento > 4000)`),
      ecu.sust(`${i('Re')} = 997.05 × ${fmt(V, 3)} × ${fmt(D, 4)} / 0.00089 = ${fmt(Re, 0)} → ${regimen}`),
      ecu.tipo('Ecuación cuadrática: perfil de velocidad laminar'),
      ecu.formula(`${i('u')}(${i('r')}) = 2${i('V')}(1 − ${i('r')}²/${i('R')}²) = −(2${i('V')}/${i('R')}²)·${i('r')}² + 2${i('V')}`),
      ecu.sust(`${i('u')}(${i('r')}) = −${fmt(a2, a2 >= 100 ? 0 : 2)}·${i('r')}² + ${fmt(2 * V, 3)};  vértice en el eje: ${i('u')} = ${fmt(2 * V, 3)} m/s;  raíces ${i('r')} = ±${fmt(R, 4)} m (en la pared el agua no se mueve)`),
      ecu.nota(notas[regimen] + (regimen !== 'laminar' ? ' La parábola solo describe el flujo laminar.' : '') + ' Algunos textos fijan el límite laminar en Re = 2300; aquí se usa 2000 (Mott y Untener, 2015).'),
    ].join(''),
  };
}

// ── Plano de la red, zanja y cantidades ────────────────────────────────────
const colorPresion = (pr, cerrada) => (cerrada ? 'var(--tinta-2)' : (pr < p.presionMinima ? 'var(--alerta)' : (pr < p.presionMinima + 3 ? 'var(--aviso)' : 'var(--ok)')));

function planoRed() {
  const rd = r.redDiseno;
  const N = rd.N;
  const K = rd.K;
  const W = 360;
  const H = 70 + N * 62;
  const x0 = 34;
  const xFin = W - 30;
  const ancho = xFin - x0 - 60;
  const yP = 34;
  const yR = (j) => yP + 30 + (j - 1) * 62;
  const xCasa = (k) => x0 + 50 + ((k - 0.5) / K) * ancho;
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="svg-red">`;
  const e = r.especs;
  const grosor = (es) => Math.max(1.5, Math.min(7, es.DE * 60));
  // principal (vertical a la izquierda desde la entrada)
  svg += `<text x="${x0 - 22}" y="16" class="t-chica">Conducción</text>`;
  svg += `<line x1="${x0}" y1="18" x2="${x0}" y2="${yR(N) + (p.hidrante ? 26 : 0)}" stroke="var(--agua)" stroke-width="${grosor(e.Principal)}" stroke-linecap="round"/>`;
  svg += `<circle cx="${x0}" cy="22" r="4" fill="var(--panel)" stroke="var(--tinta)" stroke-width="1.5"/><text x="${x0 + 8}" y="26" class="t-chica">E · entrada (${fmt(rd.nodos.E.H - rd.nodos.E.cota, 1)} m)</text>`;
  for (let j = 1; j <= N; j++) {
    const y = yR(j);
    const cerrado = p.ramalCerrado === j;
    svg += `<line x1="${x0}" y1="${y}" x2="${xCasa(K) + 6}" y2="${y}" stroke="var(--agua)" stroke-opacity="${cerrado ? 0.3 : 1}" stroke-width="${grosor(e.Ramal)}" stroke-linecap="round"/>`;
    svg += `<text x="${x0 + 6}" y="${y - 8}" class="t-chica">P${j}</text>`;
    if (p.valvulasRamal) {
      svg += `<g transform="translate(${x0 + 22},${y})"><rect x="-7" y="-7" width="14" height="14" fill="none" stroke="var(--tinta-2)" stroke-width="1"/><path d="M-5,-4 L5,4 L5,-4 L-5,4 Z" fill="${cerrado ? 'var(--alerta)' : 'var(--agua)'}"/><title>Válvula de compuerta del ramal ${j}${cerrado ? ' (cerrada)' : ''}</title></g>`;
    }
    for (let k = 1; k <= K; k++) {
      const c = rd.casas.find((x) => x.j === j && x.k === k);
      const xc = xCasa(k);
      const sel = r.casa.id === c.id;
      svg += `<line x1="${xc}" y1="${y}" x2="${xc}" y2="${y - 14}" stroke="var(--agua)" stroke-width="1.2"/>`;
      svg += `<g class="casa-plano" data-casa="${c.id}" tabindex="0" role="button" aria-label="Vivienda ${c.id}, ${fmt(c.presion, 1)} m.c.a.">
        <path d="M${xc - 9},${y - 14} v-12 l9,-8 l9,8 v12 z" fill="${colorPresion(c.presion, c.cerrada)}" stroke="${sel ? 'var(--tinta)' : 'none'}" stroke-width="${sel ? 2.2 : 0}"/>
        <rect x="${xc - 3}" y="${y - 20}" width="6" height="4" fill="var(--panel)" opacity="0.8"/>
        <title>Vivienda ${c.id}: ${c.cerrada ? 'ramal cerrado' : `${fmt(c.presion, 1)} m.c.a. con QMH; cota ${fmt(c.cota)} m`}</title></g>`;
      if (sel) svg += `<text x="${xc}" y="${y + 13}" text-anchor="middle" class="t-chica t-sel">análisis</text>`;
    }
  }
  const marca = (nodo, color, texto, dy = -10, dx = 7) => {
    if (!nodo) return '';
    const xx = nodo.tipo === 'casa' ? xCasa(Number(nodo.casa.split('-')[1])) : x0;
    const yy = nodo.tipo === 'casa' ? yR(Number(nodo.casa.split('-')[0])) : (nodo.id === 'HI' ? yR(N) + 26 : yR(Number(nodo.id.slice(1))));
    return `<g transform="translate(${xx},${yy})"><circle r="4.5" fill="${color}" stroke="var(--panel)" stroke-width="1.2"/><text x="${dx}" y="${dy + 14}" class="t-chica">${texto}</text></g>`;
  };
  if (p.valvulaAire) svg += marca(rd.puntoAlto, 'var(--ocre)', 'aire', -10, 9);
  if (p.valvulaPurga) svg += marca(rd.puntoBajo, 'var(--tinta-2)', 'purga', 0);
  if (p.hidrante) svg += marca(rd.nodos.HI, 'var(--alerta)', p.incendio ? 'hidrante (en uso)' : 'hidrante');
  svg += '</svg>';
  const leyenda = `<p class="leyenda-plano"><span><i style="background:var(--ok)"></i>cumple</span><span><i style="background:var(--aviso)"></i>cerca del mínimo</span><span><i style="background:var(--alerta)"></i>no cumple</span><span>grosor de la línea ∝ diámetro</span></p>`;
  return svg + leyenda;
}

function zanjaSVG() {
  const DE = r.especs.Principal.DE;
  const z = D.zanja(p, DE);
  const esc = 150 / Math.max(z.profundidad + 0.3, z.ancho + 0.6);
  const W = 320;
  const H = (z.profundidad + 0.35) * esc + 30;
  const cx = W / 2;
  const top = 20;
  const a = z.ancho * esc;
  const prof = z.profundidad * esc;
  const ytubo = top + prof - p.cama * esc - (DE * esc) / 2;
  const R = (DE * esc) / 2;
  const yCinta = z.cinta ? top + prof - z.cinta * esc : null;
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${top}" width="${W}" height="${H - top}" fill="var(--ocre)" opacity="0.18"/>
    <line x1="0" y1="${top}" x2="${W}" y2="${top}" stroke="var(--tinta-2)" stroke-width="1.5"/>
    <rect x="${cx - a / 2}" y="${top}" width="${a}" height="${prof}" fill="var(--ocre)" opacity="0.38"/>
    <rect x="${cx - a / 2}" y="${top + prof - p.cama * esc - DE * esc - 0.05 * esc}" width="${a}" height="${p.cama * esc + DE * esc + 0.05 * esc}" fill="#d9c49a" opacity="0.9"/>
    <circle cx="${cx}" cy="${ytubo}" r="${R}" fill="var(--agua)" stroke="var(--panel)" stroke-width="1"/>
    ${yCinta ? `<line x1="${cx - a / 2 + 4}" y1="${yCinta}" x2="${cx + a / 2 - 4}" y2="${yCinta}" stroke="var(--alerta)" stroke-width="3"/>` : ''}
    <text x="${cx + a / 2 + 8}" y="${top + 14}" class="t-chica">Relleno compactado ${fmt(p.recubrimiento, 2)} m</text>
    ${yCinta ? `<text x="${cx + a / 2 + 8}" y="${yCinta + 4}" class="t-chica" fill="var(--alerta)">Cinta de advertencia</text>` : ''}
    <text x="${cx + a / 2 + 8}" y="${ytubo + 4}" class="t-chica">Tubería ${r.especs.Principal.dn}</text>
    <text x="${cx + a / 2 + 8}" y="${top + prof - 2}" class="t-chica">Cama de apoyo ${fmt(p.cama * 100, 0)} cm</text>
    <line x1="${cx - a / 2}" y1="${top + prof + 10}" x2="${cx + a / 2}" y2="${top + prof + 10}" stroke="var(--tinta-2)"/>
    <text x="${cx}" y="${top + prof + 22}" text-anchor="middle" class="t-chica">${fmt(z.ancho, 2)} m</text>
    <line x1="${cx - a / 2 - 10}" y1="${top}" x2="${cx - a / 2 - 10}" y2="${top + prof}" stroke="var(--tinta-2)"/>
    <text x="${cx - a / 2 - 14}" y="${top + prof / 2}" text-anchor="end" class="t-chica">${fmt(z.profundidad, 2)} m</text>
  </svg>`;
  return { svg, leyenda: `Zanja de la tubería principal: ancho = DE + 2 × ${fmt(p.holgura, 2)} m (mínimo 0.50 m); profundidad = cama + DE + relleno. Excavación: ${fmt(z.area, 3)} m³ por metro.` };
}

function tablaCantidades() {
  const filas = r.cantidades.filas.map(([item, det, cant, und]) =>
    `<tr><td>${item}<small>${det}</small></td><td class="num">${fmt(cant, und === 'und' ? 0 : 1)}</td><td>${und}</td></tr>`).join('');
  return `<table class="cantidades"><thead><tr><th>Ítem</th><th class="num">Cantidad</th><th>Unidad</th></tr></thead><tbody>${filas}</tbody></table>`;
}

function revisionHTML(lista) {
  return lista.map((c) => `<li data-nivel="${c.nivel}"><span class="marca-rev">${c.nivel === 'ok' ? '✓' : (c.nivel === 'aviso' ? '!' : '✗')}</span><span>${c.texto}<small>${c.detalle}</small></span></li>`).join('');
}

// ── Río, bombas y riego: tablas, perfil de la cuenca y formatos ──────────────
const SUPERINDICES = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
/** Etiqueta de un eje logarítmico: 3 → 10³; entre potencias, el número. */
function potencia10(v) {
  const e = Math.round(v);
  if (Math.abs(v - e) < 1e-9) return `10${String(e).split('').map((c) => SUPERINDICES[c] ?? c).join('')}`;
  return fmt(10 ** v, 0);
}

const horaTexto = (h) => {
  const m = Math.round((((h % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Tabla de comparación. cabecera: textos; filas: arreglos de celdas o { celdas, clase }.
 * Una celda puede ser texto o { v, clase, nota }; numericas: columnas alineadas a la derecha.
 */
function tablaHTML(titulo, cabecera, filas, { nota = '', numericas = [], marcar = -1 } = {}) {
  const celda = (c, k, etiqueta = 'td') => {
    const o = c !== null && typeof c === 'object' ? c : { v: c };
    const clases = [o.clase, numericas.includes(k) ? 'num' : '', k === marcar ? 'marcada' : ''].filter(Boolean).join(' ');
    return `<${etiqueta}${clases ? ` class="${clases}"` : ''}>${o.v ?? ''}${o.nota ? `<small>${o.nota}</small>` : ''}</${etiqueta}>`;
  };
  const cuerpo = filas.map((f) => {
    const celdas = Array.isArray(f) ? f : f.celdas;
    return `<tr${f.clase ? ` class="${f.clase}"` : ''}>${celdas.map((c, k) => celda(c, k)).join('')}</tr>`;
  }).join('');
  return `<h3>${titulo}</h3><div class="tabla-desliza"><table class="cantidades comparar"><thead><tr>${cabecera.map((c, k) => celda(c, k, 'th')).join('')}</tr></thead><tbody>${cuerpo}</tbody></table></div>${nota ? `<p class="nota-tabla">${nota}</p>` : ''}`;
}

// Perfil esquemático del cauce: cota del fondo [m.s.n.m.] según la distancia [km]
const PERFIL_CAUCE = [[0, 2000], [5, 1500], [15, 700], [25, 300], [35, 80], [44, 12], [50, 0]];
function cotaCauce(km) {
  for (let k = 0; k < PERFIL_CAUCE.length - 1; k++) {
    const [a, za] = PERFIL_CAUCE[k];
    const [b, zb] = PERFIL_CAUCE[k + 1];
    if (km <= b) return za + ((zb - za) * (km - a)) / (b - a);
  }
  return 0;
}

/** Perfil del río del nacimiento al mar: zonas, oxígeno disuelto, coliformes y puntos de interés. */
function perfilRio() {
  const cal = r.rio.calidad;
  const P = cal.puntos;
  const W = 360;
  const H = 206;
  const x0 = 12;
  const x1 = W - 12;
  const yTop = 32;
  const yBase = 150;
  const X = (km) => x0 + (km / 50) * (x1 - x0);
  const Y = (z) => yBase - (z / 2000) * (yBase - yTop);
  const colorOD = (od) => (od < p.odMin ? 'var(--alerta)' : (od < p.odMin + 1 ? 'var(--aviso)' : 'var(--agua)'));
  const colorCF = (cf) => (cf > p.cfMax ? 'var(--alerta)' : (cf > G.CF_RIEGO_CRUDO ? 'var(--aviso)' : 'var(--ok)'));
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="svg-red">`;
  const opacidad = { alta: 0.04, media: 0.08, baja: 0.13 };
  for (const [id, z] of Object.entries(R.ZONAS)) {
    const xa = X(z.km[0]);
    const xb = X(z.km[1]);
    svg += `<rect x="${xa}" y="${yTop - 26}" width="${xb - xa}" height="${yBase - yTop + 26}" fill="var(--agua)" opacity="${opacidad[id]}"/>`;
    svg += `<text x="${(xa + xb) / 2}" y="${yTop - 15}" text-anchor="middle" class="t-chica t-sel">${z.nombre}</text>`;
    svg += `<text x="${(xa + xb) / 2}" y="${yTop - 5}" text-anchor="middle" class="t-chica">${R.miles(z.elevacion)} m · ${z.Tagua} °C</text>`;
  }
  const pts = [];
  for (let km = 0; km <= 50 + 1e-9; km += 0.5) pts.push(`${X(km).toFixed(1)},${Y(cotaCauce(km)).toFixed(1)}`);
  svg += `<path d="M${X(0)},${yBase} L${pts.join(' L')} L${X(50)},${yBase} Z" fill="var(--ocre)" opacity="0.28"/>`;
  for (let k = 0; k < P.length - 1; k++) {
    const a = P[k];
    const b = P[k + 1];
    svg += `<line x1="${X(a.km).toFixed(1)}" y1="${Y(cotaCauce(a.km)).toFixed(1)}" x2="${X(b.km).toFixed(1)}" y2="${Y(cotaCauce(b.km)).toFixed(1)}" stroke="${colorOD(Math.min(a.OD, b.OD))}" stroke-width="4" stroke-linecap="round"/>`;
  }
  const yF = yBase + 9;
  for (let k = 0; k < P.length - 1; k++) {
    const a = P[k];
    const b = P[k + 1];
    svg += `<rect x="${X(a.km).toFixed(1)}" y="${yF}" width="${(X(b.km) - X(a.km) + 0.5).toFixed(1)}" height="7" fill="${colorCF(Math.max(a.CF, b.CF))}"/>`;
  }
  for (let km = 0; km <= 50; km += 10) {
    svg += `<text x="${X(km)}" y="${yF + 19}" text-anchor="${km === 0 ? 'start' : (km === 50 ? 'end' : 'middle')}" class="t-chica">${km === 0 ? 'km 0' : km}</text>`;
  }
  svg += `<text x="${X(50) - 3}" y="${yBase - 6}" text-anchor="end" class="t-chica t-halo">mar</text>`;
  // Puntos de interés con su rótulo en filas que no se tapan
  const marcas = [
    { km: R.KM_BOCATOMA, color: 'var(--agua)', texto: 'Bocatoma de la ciudad', cuadro: true },
    { km: R.ZONAS[p.zonaRiego].kmToma, color: 'var(--ok)', texto: 'Toma de riego' },
  ];
  if (cal.inicio) marcas.push({ km: cal.kmV, color: 'var(--alerta)', texto: 'Vertimiento' });
  if (cal.odMin.od < p.odMin) marcas.push({ km: cal.odMin.km, color: 'var(--alerta)', texto: `OD mínimo ${fmt(cal.odMin.od, 1)} mg/L` });
  // De la más lejana a la más cercana al nacimiento y con el rótulo a la izquierda de su
  // marca: así ninguna línea guía cruza el rótulo de otra marca
  marcas.sort((a, b) => b.km - a.km);
  const filas = [[], [], [], []];
  for (const m of marcas) {
    const x = X(m.km);
    const w = m.texto.length * 4.7 + 4;
    const ancla = x - w >= x0 ? 'end' : 'start';
    const tramo = ancla === 'end' ? [x - w, x] : [x, x + w];
    let f = filas.findIndex((fila) => fila.every(([a, b]) => tramo[1] < a - 3 || tramo[0] > b + 3));
    if (f < 0) f = filas.length - 1;
    filas[f].push(tramo);
    const yt = yTop + 12 + f * 12;
    const yr = Y(cotaCauce(m.km));
    if (yr - 5 > yt + 2) svg += `<line x1="${x}" y1="${yt + 3}" x2="${x}" y2="${yr - 5}" stroke="var(--tinta-2)" stroke-width="0.8" stroke-dasharray="2 2"/>`;
    svg += m.cuadro
      ? `<rect x="${x - 3.5}" y="${yr - 3.5}" width="7" height="7" fill="${m.color}" stroke="var(--panel)" stroke-width="1"/>`
      : `<circle cx="${x}" cy="${yr}" r="4" fill="${m.color}" stroke="var(--panel)" stroke-width="1"/>`;
    svg += `<text x="${ancla === 'end' ? x + 3 : x - 3}" y="${yt}" text-anchor="${ancla}" class="t-chica t-halo">${m.texto}</text>`;
  }
  svg += '</svg>';
  const leyenda = `<p class="leyenda-plano"><span><i style="background:var(--agua)"></i>oxígeno suficiente</span><span><i style="background:var(--aviso)"></i>cerca del mínimo</span><span><i style="background:var(--alerta)"></i>bajo el mínimo</span><span>franja de coliformes: <i style="background:var(--ok)"></i>≤ ${R.miles(G.CF_RIEGO_CRUDO)} <i style="background:var(--aviso)"></i>≤ ${R.miles(p.cfMax)} <i style="background:var(--alerta)"></i>más</span></p>`;
  return svg + leyenda;
}

function tablaZonasRio() {
  const cal = r.rio.calidad;
  const ids = Object.keys(R.ZONAS);
  const maximo = (id, campo) => Math.max(...cal.puntos.filter((x) => x.zona === id).map((x) => x[campo]));
  const filas = [
    ['Tramo', ...ids.map((id) => `km ${R.ZONAS[id].km[0]} a ${R.ZONAS[id].km[1]}`)],
    ['Altitud', ...ids.map((id) => `${R.miles(R.ZONAS[id].elevacion)} m`)],
    ['Temperatura del agua', ...ids.map((id) => `${R.ZONAS[id].Tagua} °C`)],
    ...(Math.abs(r.represa.dQ) > 1e-9 ? [['Caudal sin la represa', ...ids.map((id) => `${fmt(r.represa.zonas[id].natural)} m³/s`)]] : []),
    [Math.abs(r.represa.dQ) > 1e-9 ? 'Caudal con la represa' : 'Caudal', ...ids.map((id) => `${fmt(cal.hid[id].Q)} m³/s`)],
    ['Profundidad', ...ids.map((id) => `${fmt(cal.hid[id].y)} m`)],
    ['Velocidad', ...ids.map((id) => `${fmt(cal.hid[id].u)} m/s`)],
    ['Reaireación k<sub>a</sub>', ...ids.map((id) => `${fmt(cal.hid[id].ka, 1)} 1/día`)],
    ['Oxígeno de saturación', ...ids.map((id) => `${fmt(cal.hid[id].ODsat)} mg/L`)],
    ['Oxígeno disuelto mínimo', ...ids.map((id) => ({ v: `${fmt(cal.zonas[id].odMin)} mg/L`, clase: cal.zonas[id].odMin < p.odMin ? 'mal' : '' }))],
    ['DBO máxima', ...ids.map((id) => `${fmt(maximo(id, 'DBO'))} mg/L`)],
    ['Coliformes fecales máximos', ...ids.map((id) => {
      const v = maximo(id, 'CF');
      return { v: R.miles(v), clase: v > p.cfMax ? 'mal' : '' };
    })],
  ];
  return tablaHTML('Las tres zonas del río', ['', 'Alta', 'Media', 'Baja'], filas, {
    numericas: [1, 2, 3],
    nota: 'En la montaña el río es rápido y poco profundo: se airea enseguida y se recupera pronto de un vertimiento. En la zona baja es lento y hondo: la falta de oxígeno dura más kilómetros.',
  });
}

// ── Acuífero: corte esquemático del terreno entre el río y el pozo ───────────
// El río se dibuja a la izquierda: su orilla este es x = 0 y el pozo está en x = L.
const RIO_CORTE = { centro: -8, semiancho: 5, talud: 3 };

/** Cota del terreno [m] a la distancia x [m] de la orilla este (negativa: río y orilla oeste). */
function terrenoCorte(x) {
  const c = RIO_CORTE;
  const d = Math.abs(x - c.centro);
  const lecho = R.CAUCE.fondo;
  const terreno = r.acuifero.terreno;
  if (d <= c.semiancho) return lecho;
  if (d <= c.semiancho + c.talud) return lecho + ((terreno - lecho) * (d - c.semiancho)) / c.talud;
  return terreno;
}

/** Nivel del agua subterránea [m] en el corte: el del río bajo el cauce, con el pozo al este. */
function nivelCorte(a, x) {
  const orillaOeste = RIO_CORTE.centro - RIO_CORTE.semiancho - RIO_CORTE.talud;
  if (x >= 0) return A.nivelConPozo(a, x);
  if (x <= orillaOeste) return A.nivelNatural(a, orillaOeste - x);
  return a.hRio;
}

function corteAcuifero() {
  const a = r.acuifero;
  const est = a.est;
  const W = 360;
  const H = 232;
  const x0 = 10;
  const x1 = W - 10;
  const yT = 30;
  const yB = H - 26;
  const xMin = -20;
  const xMax = Math.max(100, Math.min(600, Math.ceil((Math.max(2.3 * a.L, a.L + 30)) / 10) * 10));
  // Escala vertical en dos tramos: la parte de arriba (río, suelo, arcilla y cono del
  // pozo) se ve más grande que la profundidad del acuífero
  const cTop = a.terreno + 2.5;
  const cBot = est.fondo - 3;
  const cMed = Math.max(cBot + 2, Math.min(est.techoAcuifero, Math.max(est.fondo, a.nivelPozo), R.CAUCE.fondo) - 2.5);
  const hArriba = 0.62 * (yB - yT);
  const X = (x) => x0 + ((x - xMin) / (xMax - xMin)) * (x1 - x0);
  const Y = (c) => {
    const k = Math.max(cBot, Math.min(cTop, c));
    return k >= cMed ? yT + ((cTop - k) / (cTop - cMed)) * hArriba : yT + hArriba + ((cMed - k) / (cMed - cBot)) * (yB - yT - hArriba);
  };
  const pasos = 120;
  const xs = Array.from({ length: pasos + 1 }, (_, k) => xMin + ((xMax - xMin) * k) / pasos);
  const linea = (f) => xs.map((x) => `${X(x).toFixed(1)},${Y(f(x)).toFixed(1)}`).join(' L');
  const nivel = (x) => Math.max(est.fondo, nivelCorte(a, x));
  const libre = !est.tipo.capa;
  const suelo = R.SUELOS[p.sueloAcuifero] ?? R.SUELOS.arena;
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="svg-red">
    <defs>
      <pattern id="pt-suelo" width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" style="fill:color-mix(in srgb, var(--ocre) 30%, var(--panel))"/><circle cx="2" cy="2" r="0.8" style="fill:color-mix(in srgb, var(--ocre) 70%, var(--panel))"/><circle cx="5.5" cy="5" r="0.6" style="fill:color-mix(in srgb, var(--ocre) 60%, var(--panel))"/></pattern>
      <pattern id="pt-acuifero" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" style="fill:color-mix(in srgb, var(--agua) 30%, var(--panel))"/><circle cx="2" cy="3" r="1.1" style="fill:color-mix(in srgb, var(--agua) 12%, var(--ocre) 40%)"/><circle cx="6" cy="6.5" r="0.9" style="fill:color-mix(in srgb, var(--agua) 12%, var(--ocre) 40%)"/></pattern>
      <pattern id="pt-arcilla" width="10" height="5" patternUnits="userSpaceOnUse"><rect width="10" height="5" style="fill:color-mix(in srgb, var(--tinta-2) 35%, var(--panel))"/><path d="M0 2.5 H6" style="stroke:color-mix(in srgb, var(--tinta-2) 65%, var(--panel))" stroke-width="0.8"/></pattern>
      <pattern id="pt-roca" width="12" height="9" patternUnits="userSpaceOnUse"><rect width="12" height="9" style="fill:color-mix(in srgb, var(--tinta-2) 55%, var(--panel))"/><path d="M0 4.5 H12 M6 0 V4.5 M0 9 V4.5 M12 9 V4.5" style="stroke:color-mix(in srgb, var(--tinta) 35%, var(--panel))" stroke-width="0.6"/></pattern>
      <marker id="mk-flecha" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L6 3 L0 6 z" style="fill:var(--agua)"/></marker>
    </defs>`;
  const xa = X(xMin);
  const xb = X(xMax);
  // Roca bajo el acuífero
  svg += `<rect x="${xa}" y="${Y(est.fondo)}" width="${xb - xa}" height="${yB - Y(est.fondo)}" fill="url(#pt-roca)"/>`;
  if (libre) {
    // Acuífero libre: saturado bajo el nivel freático, suelo seco encima
    svg += `<path d="M${xa},${Y(est.fondo)} L${linea(nivel)} L${xb},${Y(est.fondo)} Z" fill="url(#pt-acuifero)"/>`;
    svg += `<path d="M${linea(terrenoCorte)} L${linea(nivel).split(' L').reverse().join(' L')} Z" fill="url(#pt-suelo)"/>`;
  } else {
    svg += `<rect x="${xa}" y="${Y(est.techoAcuifero)}" width="${xb - xa}" height="${Y(est.fondo) - Y(est.techoAcuifero)}" fill="url(#pt-acuifero)"/>`;
    svg += `<rect x="${xa}" y="${Y(est.nivel)}" width="${xb - xa}" height="${Y(est.techoAcuifero) - Y(est.nivel)}" fill="url(#pt-arcilla)"/>`;
    svg += `<path d="M${linea(terrenoCorte)} L${xb},${Y(est.nivel)} L${xa},${Y(est.nivel)} Z" fill="url(#pt-suelo)"/>`;
  }
  // Cauce con el agua del río
  const cc = RIO_CORTE;
  const xr0 = X(cc.centro - cc.semiancho - cc.talud);
  const xr1 = X(cc.centro + cc.semiancho + cc.talud);
  const lechoY = Y(R.CAUCE.fondo);
  const rioY = Y(a.hRio);
  const xsRio = xs.filter((x) => x > cc.centro - cc.semiancho - cc.talud && x < cc.centro + cc.semiancho + cc.talud && terrenoCorte(x) < a.hRio);
  if (xsRio.length) {
    svg += `<path d="M${X(xsRio[0])},${rioY} ${xsRio.map((x) => `L${X(x).toFixed(1)},${Y(terrenoCorte(x)).toFixed(1)}`).join(' ')} L${X(xsRio[xsRio.length - 1])},${rioY} Z" style="fill:var(--agua)" opacity="0.75"/>`;
  }
  // Terreno (línea), nivel natural (punteado) y nivel con el pozo
  svg += `<path d="M${linea(terrenoCorte)}" fill="none" style="stroke:var(--tinta-2)" stroke-width="1.2"/>`;
  svg += `<path d="M${linea((x) => (x < 0 ? nivelCorte(a, x) : A.nivelNatural(a, x)))}" fill="none" style="stroke:var(--agua)" stroke-width="1" stroke-dasharray="3 3" opacity="0.8"/>`;
  svg += `<path d="M${linea(nivel)}" fill="none" style="stroke:var(--agua)" stroke-width="2.2"/>`;
  // Flechas del flujo subterráneo
  const cMedia = libre ? (est.nivel + est.fondo) / 2 : (est.techoAcuifero + est.fondo) / 2;
  const flecha = (xA, xB, c) => `<line x1="${X(xA)}" y1="${Y(c)}" x2="${X(xB)}" y2="${Y(c)}" style="stroke:var(--agua)" stroke-width="1.6" marker-end="url(#mk-flecha)"/>`;
  const conPozo = a.Q > 0;
  if (a.via !== 'ninguna') {
    for (const f of [0.15, 0.55]) svg += flecha(f * a.L, (f + 0.28) * a.L, cMedia);
    svg += `<line x1="${X(cc.centro)}" y1="${lechoY + 3}" x2="${X(cc.centro)}" y2="${Y(cMedia) - 4}" style="stroke:var(--agua)" stroke-width="1.6" marker-end="url(#mk-flecha)"/>`;
  } else {
    for (const f of [0.6, 0.2]) svg += flecha(f * a.L + 10, f * a.L - 8, cMedia);
  }
  if (conPozo && a.cono.R > 5) {
    const xEnd = Math.min(xMax - 4, a.L + Math.min(a.cono.R, xMax) * 0.8);
    if (xEnd > a.L + 8) svg += flecha(xEnd, a.L + 6, cMedia);
  }
  // Pozo: tubería, agua adentro y bomba
  const xp = X(a.L);
  const fondoPozo = Y(est.fondo + 0.8);
  const aguaPozo = Y(Math.max(est.fondo + 1, a.nivelPozo));
  svg += `<rect x="${xp - 3.5}" y="${Y(a.terreno) - 7}" width="7" height="${fondoPozo - Y(a.terreno) + 7}" style="fill:var(--panel);stroke:var(--tinta)" stroke-width="1"/>`;
  svg += `<rect x="${xp - 2.5}" y="${aguaPozo}" width="5" height="${Math.max(0, fondoPozo - aguaPozo)}" style="fill:var(--agua)"/>`;
  if (conPozo) svg += `<rect x="${xp - 2.5}" y="${fondoPozo - 9}" width="5" height="7" style="fill:var(--tinta)"/>`;
  svg += `<rect x="${xp - 7}" y="${Y(a.terreno) - 13}" width="14" height="6" rx="1" style="fill:var(--tinta-2)"/>`;
  // Cotas y rótulos
  const yL = yT - 14;
  svg += `<line x1="${X(0)}" y1="${yL}" x2="${xp}" y2="${yL}" style="stroke:var(--tinta-2)" stroke-width="0.8"/>`;
  svg += `<line x1="${X(0)}" y1="${yL - 3}" x2="${X(0)}" y2="${yL + 3}" style="stroke:var(--tinta-2)" stroke-width="0.8"/><line x1="${xp}" y1="${yL - 3}" x2="${xp}" y2="${yL + 3}" style="stroke:var(--tinta-2)" stroke-width="0.8"/>`;
  svg += `<text x="${(X(0) + xp) / 2}" y="${yL - 4}" text-anchor="middle" class="t-chica">L = ${fmt(a.L, 0)} m</text>`;
  svg += `<text x="${X(cc.centro)}" y="${rioY - 5}" text-anchor="middle" class="t-chica t-sel t-halo">Río</text>`;
  svg += `<text x="${xp}" y="${Y(a.terreno) - 16}" text-anchor="middle" class="t-chica t-sel t-halo">Pozo · ${fmt(p.Qpozo, 1)} L/s</text>`;
  const xTxt = X(xMax) - 4;
  // Rótulos de las capas, alineados a la derecha; se guardan sus cajas para no encimar el del nivel
  const anchoTxt = (t) => 4.9 * t.length;
  const cajas = [];
  const rotulo = (texto, y) => {
    svg += `<text x="${xTxt}" y="${y}" text-anchor="end" class="t-chica t-halo">${texto}</text>`;
    cajas.push({ x0: xTxt - anchoTxt(texto), x1: xTxt, y });
  };
  const ySuelo = Math.max(Y(a.terreno) + 10, Y((a.terreno + est.nivel) / 2) + 3);
  rotulo(`${libre ? 'Zona no saturada' : 'Suelo'}: ${suelo.nombre.toLowerCase()}`, ySuelo);
  if (!libre) rotulo(`Arcilla, ${fmt(est.e, 0)} m`, Y((est.nivel + est.techoAcuifero) / 2) + 3);
  rotulo(`Acuífero: ${a.mat.nombre.toLowerCase()}, ${fmt(est.b, 0)} m`, Y(cMedia) + 3);
  rotulo('Roca', Math.min(yB - 4, Y(est.fondo) + 12));
  // El rótulo del nivel va donde no choque: sobre la línea o bajo ella, a la derecha del
  // pozo, o entre el río y el pozo si allí cabe
  const textoNivel = libre ? 'Nivel freático' : 'Nivel piezométrico';
  const wN = anchoTxt(textoNivel);
  const choca = (cx, y) => cajas.reduce((n, c) => n + (Math.abs(c.y - y) < 11 && cx + wN / 2 > c.x0 - 2 && cx - wN / 2 < c.x1 + 2 ? 1 : 0), 0);
  const xNivel = a.L + (xMax - a.L) * 0.62;
  const candidatos = [
    [X(xNivel), Y(nivel(xNivel)) - 5],
    [X(xNivel), Y(nivel(xNivel)) + 11],
  ];
  const xOrilla = X(cc.centro + cc.semiancho + cc.talud);
  if (xp - xOrilla > wN + 16) {
    const xm = (xOrilla + xp) / 2;
    const cm = xMin + ((xm - x0) / (x1 - x0)) * (xMax - xMin);
    candidatos.push([xm, Y(nivel(cm)) - 5]);
  }
  const [xN, yN] = candidatos.reduce((m, c) => (choca(...c) < choca(...m) ? c : m));
  svg += `<text x="${xN}" y="${yN}" text-anchor="middle" class="t-chica t-halo">${textoNivel}</text>`;
  if (conPozo) svg += `<text x="${xp + 6}" y="${aguaPozo + 3}" class="t-chica t-halo">s = ${fmt(Math.min(a.cono.s, 999), 2)} m</text>`;
  // Escala horizontal
  svg += `<text x="${X(0)}" y="${H - 8}" text-anchor="middle" class="t-chica">0</text><text x="${xp}" y="${H - 8}" text-anchor="middle" class="t-chica">${fmt(a.L, 0)} m</text><text x="${X(xMax)}" y="${H - 8}" text-anchor="end" class="t-chica">${fmt(xMax, 0)} m</text>`;
  svg += '</svg>';
  const textoFlujo = a.via === 'bombeo'
    ? `El pozo atrae agua del río: llega en ${fmt(a.tViaje, 1)} días.`
    : (a.via === 'natural' ? `El río pierde agua hacia el acuífero; llega al pozo en ${fmt(a.tViaje, 0)} días.` : 'El acuífero alimenta al río: el agua del río no llega al pozo.');
  const leyenda = `<p class="leyenda-plano"><span><i style="background:var(--agua)"></i>agua (río y acuífero saturado)</span><span>línea gruesa: ${libre ? 'nivel freático' : 'nivel piezométrico'} con el pozo; punteada: sin bombear</span><span>${textoFlujo}</span></p>`;
  return svg + leyenda;
}

/** Corte del embalse a lo largo del río: presa, niveles de operación, tubería forzada y central. */
function presaSVG() {
  const rep = r.represa;
  const W = 360;
  const H = 214;
  const xP = 226;                                  // cara de aguas arriba de la presa
  const yL = 178;                                  // lecho del río al pie de la presa
  const esc = 128 / Math.max(rep.Hp, 1);           // px por metro: la presa ocupa 128 px
  const pend = 0.56;                               // el lecho sube aguas arriba (px de alto por px de largo)
  const Y = (h) => yL - h * esc;
  const xCola = (h) => Math.max(4, xP - (h * esc) / pend);
  const corona = 9;
  const xPie = xP + corona + 0.55 * rep.Hp * esc;  // pie de aguas abajo
  const yTerreno = (x) => (x <= xP ? yL - (xP - x) * pend : yL + Math.min(10, (x - xP) * 0.04));
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="svg-red">
    <defs><marker id="mk-presa" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L6 3 L0 6 z" style="fill:var(--tinta-2)"/></marker></defs>`;
  // Terreno y lecho
  const pts = [];
  for (let x = 0; x <= W; x += 6) pts.push(`${x},${yTerreno(x).toFixed(1)}`);
  svg += `<path d="M0,${H} L${pts.join(' L')} L${W},${H} Z" style="fill:color-mix(in srgb, var(--ocre) 30%, var(--panel))"/>`;
  // Agua del embalse
  const yA = Y(rep.nivel);
  if (rep.nivel > 0.05) svg += `<path d="M${xCola(rep.nivel).toFixed(1)},${yA.toFixed(1)} L${xP},${yA.toFixed(1)} L${xP},${yL} Z" style="fill:var(--agua)" opacity="0.6"/>`;
  // Río aguas abajo (lámina exagerada para que se vea)
  const yR = Math.max(2.5, rep.yAbajo * esc * 6);
  svg += `<path d="M${xP + corona},${yL - yR} L${W},${yTerreno(W) - yR} L${W},${yTerreno(W)} L${xP + corona},${yL} Z" style="fill:var(--agua)" opacity="0.6"/>`;
  // Niveles máximo y mínimo de operación
  for (const [h, txt] of [[rep.hMax, `máximo ${fmt(rep.hMax, 0)} m`], [rep.hMin, `mínimo ${fmt(rep.hMin, 0)} m`]]) {
    const y = Y(h);
    svg += `<line x1="${xCola(h).toFixed(1)}" y1="${y.toFixed(1)}" x2="${xP}" y2="${y.toFixed(1)}" style="stroke:var(--tinta-2)" stroke-width="0.9" stroke-dasharray="4 3"/>`;
    svg += `<text x="${(xCola(h) + 3).toFixed(1)}" y="${(y - 3).toFixed(1)}" class="t-chica t-halo">${txt}</text>`;
  }
  // Presa (concreto) y aliviadero en la corona
  svg += `<path d="M${xP},${Y(rep.Hp).toFixed(1)} L${xP + corona},${Y(rep.Hp).toFixed(1)} L${xPie.toFixed(1)},${yL + 1} L${xP},${yL + 1} Z" style="fill:color-mix(in srgb, var(--tinta-2) 45%, var(--panel));stroke:var(--tinta-2)" stroke-width="1"/>`;
  if (rep.Qvert > 1e-6) {
    svg += `<path d="M${xP + corona},${Y(rep.Hp) + 2} L${xPie - 4},${yL - 2}" style="stroke:var(--agua)" stroke-width="3" opacity="0.85"/>`;
    svg += `<text x="${xP + corona + 6}" y="${Y(rep.Hp) - 4}" class="t-chica t-halo">aliviadero: ${fmt(rep.Qvert)} m³/s</text>`;
  }
  // Tubería forzada: de la toma (bajo el nivel mínimo) a la casa de máquinas, y la central
  const yToma = Y(rep.hMin * 0.6);
  const xCasa = Math.min(W - 30, xPie + 4);
  svg += `<path d="M${xP - 8},${yToma.toFixed(1)} L${xP + 4},${yToma.toFixed(1)} L${xCasa + 6},${yL - 8}" fill="none" style="stroke:var(--tinta)" stroke-width="2.4"/>`;
  svg += `<rect x="${xCasa}" y="${yL - 18}" width="24" height="16" rx="1.5" style="fill:var(--panel);stroke:var(--tinta)" stroke-width="1"/>`;
  svg += `<circle cx="${xCasa + 8}" cy="${yL - 8}" r="4" style="fill:${rep.Qturb > 0 ? 'var(--ok)' : 'var(--tinta-2)'}"/>`;
  svg += `<text x="${xCasa + 12}" y="${yL - 24}" text-anchor="middle" class="t-chica t-sel t-halo">${fmt(rep.P / 1000, 0)} kW</text>`;
  // Salto neto: del río al pie hasta el nivel del embalse
  const xH = xP - 16;
  if (rep.nivel > 1) {
    svg += `<line x1="${xH}" y1="${(yL - yR).toFixed(1)}" x2="${xH}" y2="${(yA + 2).toFixed(1)}" style="stroke:var(--tinta-2)" stroke-width="1" marker-start="url(#mk-presa)" marker-end="url(#mk-presa)"/>`;
    svg += `<text x="${xH - 4}" y="${(yA + 0.3 * (yL - yA) + 4).toFixed(1)}" text-anchor="end" class="t-chica t-halo">salto neto ${fmt(rep.Hn, 1)} m</text>`;
  }
  // Rótulos de nivel y caudales
  svg += `<text x="${xP - 4}" y="${(yA - 5).toFixed(1)}" text-anchor="end" class="t-chica t-sel t-halo">h = ${fmt(rep.nivel, 1)} m · ${fmt(rep.V / 1e6, 2)} Mm³</text>`;
  svg += `<text x="6" y="16" class="t-chica t-halo">Entra: ${fmt(rep.Qin)} m³/s</text>`;
  svg += `<line x1="8" y1="22" x2="38" y2="22" style="stroke:var(--agua)" stroke-width="1.6" marker-end="url(#mk-presa)"/>`;
  svg += `<text x="${W - 4}" y="${H - 8}" text-anchor="end" class="t-chica t-halo">Sale: ${fmt(rep.Qsale)} m³/s</text>`;
  svg += `<text x="${xP + corona / 2}" y="${(Y(rep.Hp) - 5).toFixed(1)}" text-anchor="middle" class="t-chica t-halo">presa ${fmt(rep.Hp, 0)} m</text>`;
  svg += '</svg>';
  const leyenda = `<p class="leyenda-plano"><span><i style="background:var(--agua)"></i>agua del embalse y del río</span><span>línea gruesa: tubería forzada a la central</span><span>sin escala horizontal; el río al pie de la presa, exagerado</span></p>`;
  return {
    svg: svg + leyenda,
    leyenda: `Corte a lo largo del río en la presa (km ${P.PRESA.km}). El salto neto es la altura del embalse sobre el río al pie, menos lo que se pierde en la tubería forzada.`,
  };
}

const PINTORES = {
  captacion() {
    const desnivel = p.cotaTanque + sim.nivel - cotaEf();
    const c = r.costo;
    const d = r.desarenador;
    const dmm = d.dMin * 1000;
    const hayFlujo = p.Qbombeo > 0;
    const auto = p.controlBomba === 'automatico';
    const Hm = i('H̄');
    return {
      metricas: metricas([
        ['<b>Bombeo y energía</b>', '', ''],
        ['Estado de la bomba', r.bomba ? 'Encendida' : (r.capta ? `Apagada (arranca a ${fmt(p.nivelArranque)} m)` : 'Detenida: el río está por debajo de la rejilla'), '', r.bomba ? 'ok' : (r.capta ? 'aviso' : 'alerta')],
        ['Altura dinámica ahora', r.bomba ? r.alturaBombeo : 'sin bombeo', r.bomba ? 'm' : ''],
        ['Desnivel río → superficie del tanque', fmt(desnivel), 'm'],
        ['Pérdida en la succión', fmt(r.succion.hfReal, 3), 'm'],
        ['Velocidad en la succión', fmt(r.succion.V), 'm/s', r.succion.V <= p.VmaxSuccion ? 'ok' : 'aviso'],
        ['Pérdida por fricción en la aducción', fmt(r.aduccion.hfReal), 'm'],
        ['Altura dinámica media del ciclo', r.Hmedia, 'm'],
        ['Horas de bombeo al día', `${fmt(r.horasDia, 1)}${auto ? ' (las fija el control por niveles)' : ''}`, 'h'],
        ['Potencia al freno (en el eje) al trabajar', r.potenciaMedia / 1000, 'kW'],
        ['Potencia eléctrica real al trabajar', r.potenciaElectrica / 1000, 'kW'],
        ['Motor de la bomba (capacidad)', `${r.bombas.acueducto.motor.hp} HP, η<sub>m</sub> = ${fmt(r.etaMotor * 100, 1)} %`, ''],
        ['Volumen bombeado al mes', r.Vmes, 'm³'],
        ['Energía eléctrica al mes', c.energia, 'kWh'],
        ['Costo mensual de bombeo', c.costo, 'COP', '', 0],
        ['<b>Desarenador</b>', '', ''],
        ['Velocidad horizontal V<sub>h</sub> = Q/(B·h)', fmt(d.Vh, 4), 'm/s'],
        ['Tiempo que tarda el agua en cruzarlo', fmtTiempo(d.t), ''],
        ['Carga superficial q = Q/(B·L)', fmt(d.q * 1000, 3), 'mm/s'],
        ['Grano más fino que se queda (Stokes)', hayFlujo ? `${fmt(dmm, 3)} mm` : '—', '', 'ok'],
        ['Tipo de grano retenido desde ese tamaño', hayFlujo ? d.clase : '—', ''],
        ['Reynolds del grano (Stokes vale si < 1)', fmt(d.Rep, 3), '', d.Rep < 1 ? '' : 'aviso'],
      ]),
      ecuacion: [
        ecu.tipo('Decimales: volumen mensual'),
        ecu.formula(`${i('V')} = ${i('Q')}<sub>b</sub> · horas · 3600 · 30`),
        ecu.sust(`${i('V')} = ${fmt(lps(p.Qbombeo), 5)} × ${fmt(r.horasDia, 2)} × 3600 × 30 = ${fmt(r.Vmes)} m³`),
        ecu.tipo('Decimales: altura dinámica media del ciclo'),
        ecu.formula(`${Hm} = (${i('z')}<sub>t</sub> + ${i('h')}<sub>medio</sub> − ${i('z')}<sub>río</sub>) + ${i('h')}<sub>f</sub>,  ${i('h')}<sub>medio</sub> = (${i('h')}<sub>a</sub> + ${i('h')}<sub>p</sub>)/2`),
        ecu.sust(`${Hm} = (${fmt(p.cotaTanque)} + ${fmt(r.nivelMedio, 3)} − ${fmt(cotaEf())}) + ${fmt(r.hfBombeo, 3)} = ${fmt(r.Hmedia)} m`),
        ecu.tipo('Ecuación lineal: costo de bombeo'),
        ecu.formula(`${i('C')}(${i('V')}) = ${i('m')} · ${i('V')} + ${i('b')}`),
        ecu.formula(`${i('m')} = tarifa · ρ${i('g')}${Hm} / (η · η<sub>m</sub> · 3.6×10⁶)`),
        ecu.sust(`${i('m')} = ${fmt(p.tarifaKWh, 0)} × 997.05 × 9.81 × ${fmt(r.Hmedia)} / (${fmt(p.eficiencia)} × ${fmt(r.etaMotor, 3)} × 3 600 000) = ${fmt(c.m)} COP/m³`),
        ecu.sust(`${i('C')}(${fmt(r.Vmes)}) = ${fmt(c.m)} × ${fmt(r.Vmes)} + ${fmt(c.b, 0)} = $ ${fmt(c.costo, 0)}`),
        ecu.nota('La pendiente es lo que cuesta subir un metro cúbico hasta el tanque; el intercepto es el cargo fijo que se paga aunque la bomba no funcione. Se convierte el volumen a energía antes de aplicar la tarifa, porque la tarifa está en COP por kWh. Se paga la energía eléctrica: por eso se divide también por la eficiencia del motor η<sub>m</sub> (motor elegido en la pestaña Bombas).'),
        ecu.nota(auto
          ? 'El costo es mensual: se calcula con el ciclo completo de la bomba (las horas que trabaja al día y la altura media entre el arranque y la parada), así que no cambia en el momento en que la bomba se apaga o se prende; solo cambia si cambian los parámetros. Mientras bombea, el nivel sube en línea recta de h<sub>a</sub> a h<sub>p</sub>, y como la altura dinámica es lineal en el nivel, su promedio es la altura con el nivel medio.'
          : 'Con bombeo continuo la bomba trabaja las 24 horas y el tanque se mantiene lleno (el sobrante sale por el rebose), así que la altura media es la del tanque lleno; si la bomba no alcanza el consumo, el tanque termina vacío.'),
        ecu.tipo('Decimales: velocidad y carga superficial en el desarenador'),
        ecu.formula(`${i('V')}<sub>h</sub> = ${i('Q')} / (${i('B')} · ${i('h')}),  ${i('t')} = ${i('L')} / ${i('V')}<sub>h</sub>,  ${i('q')} = ${i('Q')} / (${i('B')} · ${i('L')})`),
        ecu.sust(`${i('V')}<sub>h</sub> = ${fmt(lps(p.Qbombeo), 5)} / (${fmt(p.desAncho)} × ${fmt(p.desProfundidad)}) = ${fmt(d.Vh, 4)} m/s;  ${i('t')} = ${fmt(p.desLongitud)} / ${fmt(d.Vh, 4)} = ${fmt(d.t, 0)} s`),
        ecu.sust(`${i('q')} = ${fmt(lps(p.Qbombeo), 5)} / (${fmt(p.desAncho)} × ${fmt(p.desLongitud)}) = ${fmt(d.q, 5)} m/s`),
        ecu.tipo('Ecuación cuadrática: ley de Stokes'),
        ecu.formula(`${i('v')}<sub>s</sub> = ${i('K')} · ${i('d')}²,  ${i('K')} = ${i('g')}(ρ<sub>s</sub> − ρ) / (18μ)`),
        ecu.sust(`${i('K')} = 9.81 × (2650 − 997.05) / (18 × 0.00089) = ${fmt(d.K, 0)} 1/(m·s)`),
        hayFlujo
          ? ecu.sust(`Se queda si ${i('v')}<sub>s</sub> ≥ ${i('q')}:  ${fmt(d.K, 0)}·${i('d')}² − ${fmt(d.q, 5)} = 0  ⇒  ${i('d')} = √(${fmt(d.q, 5)} / ${fmt(d.K, 0)}) = ${fmt(dmm, 4)} mm`)
          : '',
        ecu.nota('Un grano se queda si cae la profundidad h antes de recorrer la longitud L, es decir si v<sub>s</sub> ≥ h·V<sub>h</sub>/L = Q/(B·L): la profundidad se cancela. Al bombear más o acortar el desarenador, la recta sube, corta la parábola más a la derecha y pasa arena más gruesa hacia la bomba. En la escena, los granos más finos que ese tamaño llegan al pozo de succión.'),
      ].join(''),
      leyenda: 'Costo mensual en función del volumen bombeado. La recta corta el eje vertical en el cargo fijo.',
      grafica(g) {
        const vMax = techoRedondo(Math.max(1000, r.Vmes * 2));
        const recta = [0, vMax].map((v) => ({ x: v, y: c.m * v + c.b }));
        actualizarGrafica(g, [
          serieLinea('C(V)', recta, paleta().agua),
          seriePuntos('Mes actual', [{ x: r.Vmes, y: c.costo }], paleta().ocre),
        ], { x: { min: 0, max: vMax }, y: { min: 0 } });
      },
      ejes: { xTitulo: 'Volumen bombeado (m³/mes)', yTitulo: 'Costo (COP)', formatoX: (v) => fmt(v, 0), formatoY: (v) => fmt(v, 0) },
      extra: {
        leyenda: 'Velocidad de caída de los granos según su diámetro (ley de Stokes). La recta es la carga superficial q: los granos cuya velocidad queda por encima de la recta se quedan en el desarenador.',
        grafica(g) {
          const col = paleta();
          const dMax = Math.max(0.1, Math.ceil(dmm * 2.4 * 100) / 100);
          const pts = Array.from({ length: 61 }, (_, k) => {
            const dm = (dMax * k) / 60;
            return { x: dm, y: M.velocidadSedimentacion(dm / 1000) * 1000 };
          });
          const qmm = d.q * 1000;
          actualizarGrafica(g, [
            serieLinea('vs = K·d²', pts, col.ocre),
            serieLinea('Carga superficial q', [{ x: 0, y: qmm }, { x: dMax, y: qmm }], col.agua, { punteada: true }),
            seriePuntos('Grano más fino retenido', hayFlujo ? [{ x: dmm, y: qmm }] : [], col.ok, 5),
          ], { x: { min: 0, max: dMax }, y: { min: 0, max: Math.max(qmm * 2.2, 0.5) } });
        },
        ejes: { xTitulo: 'Diámetro del grano d (mm)', yTitulo: 'Caída vs (mm/s)', formatoX: (v) => fmt(v, 3), formatoY: (v) => fmt(v, 1) },
      },
    };
  },

  tuberias() {
    const a = r.aduccion;
    const d = r.conduccion;
    const e = r.especs;
    const hazen = p.metodoPerdidas === 'hazen';
    const fila = (nombre, t, Q, es) => [
      [`<b>${nombre}</b>`, '', ''],
      ['Tubería', `${es.nombre}, ${es.dn} ${es.clase}`, ''],
      ['Diámetro interno', fmt(es.DI * 1000, 1), 'mm'],
      ['Presión de trabajo', `${fmt(es.pnMPa, 2)} MPa = ${fmt(es.pnMca, 0)}`, 'm.c.a.'],
      ['Caudal', fmt(M.m3sAlps(Q)), 'L/s'],
      ['Velocidad media', fmt(t.V), 'm/s', t.V < p.Vmin || t.V > p.Vmax ? 'aviso' : 'ok'],
      ['Número de Reynolds', `${fmt(t.Re, 0)} (${t.regimen})`, '', t.regimen === 'laminar' ? 'ok' : 'aviso'],
      ['Pérdida con la recta laminar', fmt(t.hfLineal), 'm'],
      [hazen ? 'Pérdida real (Hazen-Williams)' : 'Pérdida real (Darcy-Weisbach)', fmt(t.hfReal), 'm'],
    ];
    const turbulento = d.regimen !== 'laminar';
    const g = r.golpe;
    return {
      metricas: metricas([
        ...fila('Aducción (bomba encendida)', a, lps(p.Qbombeo), e.Aduccion),
        ['Celeridad de la onda de presión', fmt(g.a, 0), 'm/s'],
        ['Golpe de ariete al apagar la bomba', `+${fmt(g.dH, 1)}`, 'm'],
        ['Presión máxima en la aducción', `${fmt(r.alturaBombeo + g.dH, 1)} de ${fmt(e.Aduccion.pnMca, 0)}`, 'm.c.a.', r.alturaBombeo + g.dH <= e.Aduccion.pnMca ? 'ok' : 'alerta'],
        ...fila('Conducción (caudal de este instante)', d, r.Qsal, e.Conduccion),
      ]),
      revision: r.checks.filter((c) => /Succión|Aducción|Conducción/.test(c.texto)),
      ecuacion: [
        ecu.tipo('Decimales: diámetro interno y continuidad en la conducción'),
        ecu.formula(`${i('D')}<sub>i</sub> = ${i('D')}<sub>e</sub> − 2${i('e')},  ${i('V')} = ${i('Q')} / ${i('A')},  ${i('A')} = π${i('D')}<sub>i</sub>²/4`),
        ecu.sust(`${i('D')}<sub>i</sub> = ${fmt(e.Conduccion.DE * 1000, 2)} − 2 × ${fmt(e.Conduccion.e * 1000, 2)} = ${fmt(e.Conduccion.DI * 1000, 2)} mm;  ${i('V')} = ${fmt(r.Qsal, 5)} / ${fmt(M.areaCircular(p.Ddistribucion), 6)} = ${fmt(d.V)} m/s`),
        ecu.tipo('Ecuación lineal: pérdida en régimen laminar (Hagen-Poiseuille)'),
        ecu.formula(`${i('h')}<sub>f</sub> = ${i('k')} · ${i('Q')},  ${i('k')} = 128 μ${i('L')} / (π ρ ${i('g')} ${i('D')}⁴)`),
        ecu.sust(`${i('k')} = 128 × 0.00089 × ${fmt(p.Ldistribucion)} / (π × 997.05 × 9.81 × ${fmt(p.Ddistribucion, 4)}⁴) = ${fmt(d.k)} s/m²;  ${i('h')}<sub>f</sub> = ${fmt(d.k)} × ${fmt(r.Qsal, 5)} = ${fmt(d.hfLineal)} m`),
        hazen
          ? ecu.tipo('Hazen-Williams: pérdida con el coeficiente C del material')
          : ecu.tipo('Darcy-Weisbach: pérdida con la rugosidad del material'),
        hazen
          ? ecu.formula(`${i('h')}<sub>f</sub> = 10.67 · ${i('L')} · ${i('Q')}<sup>1.852</sup> / (${i('C')}<sup>1.852</sup> · ${i('D')}<sup>4.87</sup>)`)
          : ecu.formula(`${i('h')}<sub>f</sub> = ${i('f')} (${i('L')}/${i('D')}) ${i('V')}²/2${i('g')},  ${i('f')} = 0.25 / [log(ε/3.7${i('D')} + 5.74/${i('Re')}<sup>0.9</sup>)]²`),
        hazen
          ? ecu.sust(`${i('h')}<sub>f</sub> = 10.67 × ${fmt(p.Ldistribucion)} × ${fmt(r.Qsal, 5)}<sup>1.852</sup> / (${e.Conduccion.C}<sup>1.852</sup> × ${fmt(p.Ddistribucion, 4)}<sup>4.87</sup>) = ${fmt(d.hfReal)} m`)
          : ecu.sust(`${i('f')} = ${fmt(d.f, 4)} (ε = ${fmt(e.Conduccion.rugosidad * 1000, 4)} mm);  ${i('h')}<sub>f</sub> = ${fmt(d.f, 4)} × (${fmt(p.Ldistribucion)} / ${fmt(p.Ddistribucion, 4)}) × ${fmt(d.V)}² / 19.62 = ${fmt(d.hfReal)} m`),
        turbulento ? ecu.nota(`Con Re = ${fmt(d.Re, 0)} el flujo es ${d.regimen}: la recta laminar subestima la pérdida.`, true) : ecu.nota('El flujo es laminar (Re < 2000): la recta de Hagen-Poiseuille es la pérdida real.'),
        ecu.tipo('Decimales: golpe de ariete al apagar la bomba (Joukowsky)'),
        ecu.formula(`${i('a')} = √(${i('K')}/ρ) / √(1 + ${i('K')}${i('D')}/(${i('E')}${i('e')})),  Δ${i('H')} = ${i('a')}·${i('V')}/${i('g')}`),
        ecu.sust(`${i('a')} = 1486 / √(1 + 2.2×10⁹ × ${fmt(e.Aduccion.DI, 4)} / (${(e.Aduccion.E / 1e9).toFixed(1)}×10⁹ × ${fmt(e.Aduccion.e, 4)})) = ${fmt(g.a, 0)} m/s;  Δ${i('H')} = ${fmt(g.a, 0)} × ${fmt(a.V, 3)} / 9.81 = ${fmt(g.dH, 1)} m`),
        ecu.nota('Cada vez que el interruptor de nivel apaga la bomba, el agua de la aducción se frena y aparece una onda de presión. Δ<i>H</i> es el caso más severo (paro instantáneo): en la práctica se reduce con cierre lento de la válvula de retención o con una válvula anticipadora. El material cambia mucho la celeridad: el PEAD, flexible, la baja; el hierro dúctil, rígido, la sube.'),
      ].join(''),
      leyenda: `Pérdida en la tubería de conducción según el caudal. La recta es el modelo laminar; la curva es la pérdida real con ${hazen ? 'Hazen-Williams' : 'Darcy-Weisbach'}.`,
      grafica(gr) {
        const c = paleta();
        const L = p.Ldistribucion;
        const Dd = p.Ddistribucion;
        const qs = Array.from({ length: 61 }, (_, k) => 0.5 * k);
        const lineal = [0, 30].map((q) => ({ x: q, y: M.perdidaLaminar(lps(q), L, Dd) }));
        const real = qs.map((q) => ({ x: q, y: D.tramo(lps(q), L, e.Conduccion, p.metodoPerdidas).hfReal }));
        actualizarGrafica(gr, [
          serieLinea('Recta laminar h = kQ', lineal, c.agua),
          serieLinea('Pérdida real', real, c.piezo, { punteada: true }),
          seriePuntos('Caudal actual', [{ x: M.m3sAlps(r.Qsal), y: d.hfReal }], c.ocre),
        ], { x: { min: 0, max: 30 }, y: { min: 0 } });
      },
      ejes: { xTitulo: 'Caudal (L/s)', yTitulo: 'Pérdida de carga (m)', formatoX: (v) => fmt(v, 0), formatoY: (v) => fmt(v, 1) },
      experimento: datosExperimento(),
    };
  },

  tanque() {
    const m = r.pendienteNivel;
    const balance = M.m3sAlps(r.Qent - r.Qsal);
    const auto = p.controlBomba === 'automatico';
    let tiempo = ['Tiempo para llegar a la parada', fmtTiempo(r.tLleno), ''];
    if (m < 0) tiempo = [auto && !r.bomba ? 'Tiempo para que la bomba arranque' : 'Tiempo para vaciarse', fmtTiempo(r.tVacio), '', !auto || r.bomba ? 'aviso' : ''];
    if (m === 0) tiempo = ['Tendencia del nivel', r.vacio ? 'vacío, sin reserva' : (r.lleno ? 'lleno y rebosando' : 'estable'), '', r.vacio ? 'alerta' : ''];
    const ci = r.ciclo;
    const dm = r.demanda;
    const hh = Math.floor(r.hora);
    const mm = Math.floor((r.hora - hh) * 60);
    return {
      metricas: metricas([
        ['<b>Bomba</b>', '', ''],
        ['Estado de la bomba', r.bomba ? 'Encendida' : 'Apagada', '', r.bomba ? 'ok' : 'aviso'],
        ...(auto ? [
          ['Se apaga al llegar a', fmt(p.nivelParada), 'm'],
          ['Vuelve a arrancar al bajar a', fmt(p.nivelArranque), 'm'],
          ['Volumen entre arranque y parada', fmt(ci.dV, 1), 'm³'],
          ['Ciclo con consumo igual al QMD', `${fmtTiempo(ci.tLlenado)} encendida + ${fmtTiempo(ci.tVaciado)} apagada`, ''],
          ['Arranques por hora', fmt(ci.arranquesHora, 2), '', ci.arranquesHora <= p.arranquesMax ? 'ok' : 'aviso'],
          ['Horas de bombeo al día (promedio)', fmt(ci.horasDia, 1), 'h'],
          ['Arranques en esta simulación', String(sim.arranques), ''],
        ] : [['Horas de bombeo al día', '24', 'h']]),
        ['<b>Nivel y caudales</b>', '', ''],
        ['Nivel actual', fmt(sim.nivel), 'm', r.vacio ? 'alerta' : ''],
        ['Volumen almacenado', `${fmt(r.volumen)} de ${fmt(r.volumenMax)}`, 'm³'],
        ['Caudal que entra', fmt(M.m3sAlps(r.Qent)), 'L/s'],
        ['Caudal que sale', fmt(M.m3sAlps(r.Qsal)), 'L/s'],
        ['Balance (entra − sale)', fmt(balance), 'L/s', balance < 0 ? 'aviso' : 'ok'],
        ['Cambio del nivel', fmt(m * 3600 * 100), 'cm/h'],
        tiempo,
        ...(r.rebose > 0 ? [['Rebose por el aliviadero', fmt(M.m3sAlps(r.rebose)), 'L/s', 'aviso']] : []),
        ['<b>Consumo</b>', '', ''],
        ['Hora del día', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, ''],
        ['Factor de consumo de esta hora', fmt(r.factor, 2), '× QMD'],
        ['Caudal medio diario Qmd', fmt(M.m3sAlps(dm.Qmd)), 'L/s'],
        ['Caudal máximo diario QMD = k1·Qmd', fmt(M.m3sAlps(dm.QMD)), 'L/s'],
        ['Caudal máximo horario QMH = k2·QMD', fmt(M.m3sAlps(dm.QMH)), 'L/s'],
        ...(p.curvaDemanda === 'horaria' ? [['Volumen de regulación necesario', `${fmt(r.regulacion.V, 1)} (${fmt(r.regulacion.fraccion * 100, 1)} % del QMD diario)`, 'm³', r.regulacion.V <= r.volumenMax ? 'ok' : 'alerta']] : []),
      ]),
      ecuacion: [
        ecu.tipo('Decimales: caudales de diseño'),
        ecu.formula(`${i('Q')}<sub>md</sub> = QMD / ${i('k')}<sub>1</sub>,  QMH = ${i('k')}<sub>2</sub> · QMD`),
        ecu.sust(`${i('Q')}<sub>md</sub> = ${fmt(p.Qdemanda)} / ${fmt(p.k1)} = ${fmt(M.m3sAlps(dm.Qmd))} L/s;  QMH = ${fmt(p.k2)} × ${fmt(p.Qdemanda)} = ${fmt(M.m3sAlps(dm.QMH))} L/s`),
        ecu.tipo('Ecuación lineal: nivel en el tiempo'),
        ecu.formula(`${i('h')}(${i('t')}) = ${i('h')}₀ + ${i('m')} · ${i('t')},  ${i('m')} = (${i('Q')}<sub>e</sub> − ${i('Q')}<sub>s</sub>) / ${i('A')}`),
        ecu.sust(`${i('m')} = (${fmt(r.Qent, 5)} − ${fmt(r.Qsal, 5)}) / ${fmt(r.At)} = ${fmt(m * 3600, 4)} m/h`),
        ...(auto ? [
          ecu.tipo('Ecuación lineal: ciclo de la bomba'),
          ecu.formula(`${i('t')}<sub>enc</sub> = Δ${i('V')} / (${i('Q')}<sub>b</sub> − ${i('Q')}<sub>s</sub>),  ${i('t')}<sub>apag</sub> = Δ${i('V')} / ${i('Q')}<sub>s</sub>,  Δ${i('V')} = ${i('A')}(${i('h')}<sub>parada</sub> − ${i('h')}<sub>arranque</sub>)`),
          ecu.sust(`Δ${i('V')} = ${fmt(r.At)} × (${fmt(p.nivelParada)} − ${fmt(p.nivelArranque)}) = ${fmt(ci.dV, 1)} m³;  ${i('t')}<sub>enc</sub> = ${fmtTiempo(ci.tLlenado)},  ${i('t')}<sub>apag</sub> = ${fmtTiempo(ci.tVaciado)}`),
        ] : []),
        ecu.nota('Entre los dos interruptores el nivel sube con pendiente (Q<sub>b</sub> − Q<sub>s</sub>)/A con la bomba encendida y baja con pendiente −Q<sub>s</sub>/A con la bomba apagada: el nivel dibuja un diente de sierra. Separar más los niveles alarga el ciclo y reduce los arranques del motor. En la segunda gráfica, el área por debajo del QMD es el agua que el tanque guarda y la que queda por encima es la que entrega en las horas pico; las dos áreas son iguales en el día.'),
      ].join(''),
      leyenda: 'Proyección del nivel para las próximas 48 horas con el control de la bomba y la curva de consumo. Las líneas punteadas son los niveles de arranque y parada; la franja inferior indica cuándo está encendida la bomba.',
      grafica(g) {
        const c = paleta();
        const pts = [];
        const enc = [];
        let st = { nivel: sim.nivel, bomba: r.bomba, t: sim.t };
        for (let hora = 0; hora <= 48; hora += 0.25) {
          pts.push({ x: hora, y: st.nivel });
          enc.push({ x: hora, y: st.bomba ? 0.25 : 0 });
          st = D.avanzarTanque(p, st, 900);
        }
        actualizarGrafica(g, [
          serieLinea('Nivel h(t)', pts, c.agua),
          serieLinea('Bomba encendida', enc, c.ok, { ancho: 1.5, escalon: true, relleno: 'origin', colorRelleno: `${c.ok}55` }),
          ...(auto ? [
            serieLinea('Parada', [{ x: 0, y: p.nivelParada }, { x: 48, y: p.nivelParada }], c.alerta, { punteada: true, ancho: 1 }),
            serieLinea('Arranque', [{ x: 0, y: p.nivelArranque }, { x: 48, y: p.nivelArranque }], c.ok, { punteada: true, ancho: 1 }),
          ] : []),
          serieLinea('Altura útil', [{ x: 0, y: p.hMax }, { x: 48, y: p.hMax }], c.tinta2, { punteada: true, ancho: 1 }),
          seriePuntos('Ahora', [{ x: 0, y: sim.nivel }], c.ocre),
        ], { x: { min: 0, max: 48 }, y: { min: 0, max: Math.ceil(p.hMax + 0.5) } });
      },
      ejes: { xTitulo: 'Horas desde ahora', yTitulo: 'Nivel (m)', formatoX: (v) => fmt(v, 0), formatoY: (v) => fmt(v, 1) },
      extra: {
        leyenda: 'Consumo del sector a lo largo del día frente al caudal máximo diario (QMD). Azul: el consumo es menor y el tanque sube; naranja: el consumo es mayor y el tanque baja. El pico es el caudal máximo horario (QMH).',
        grafica(g) {
          const col = paleta();
          const QMD = p.Qdemanda;
          const curva = [];
          for (let k = 0; k <= 96; k++) {
            const h = k / 4;
            curva.push({ x: h, y: QMD * (p.curvaDemanda === 'horaria' ? D.factorConsumo(h, p.k2) : 1) });
          }
          const base = curva.map((pt) => ({ x: pt.x, y: QMD }));
          actualizarGrafica(g, [
            serieLinea('QMD', base, col.tinta2, { punteada: true, ancho: 1.5 }),
            serieLinea('Tanque subiendo', curva.map((pt) => ({ x: pt.x, y: Math.min(pt.y, QMD) })), 'transparent', { ancho: 0, relleno: 0, colorRelleno: `${col.agua}55` }),
            serieLinea('Tanque bajando', curva.map((pt) => ({ x: pt.x, y: Math.max(pt.y, QMD) })), 'transparent', { ancho: 0, relleno: 0, colorRelleno: `${col.piezo}66` }),
            serieLinea('Consumo Q(h)', curva, col.agua),
            serieLinea('QMH', [{ x: 0, y: M.m3sAlps(r.demanda.QMH) }, { x: 24, y: M.m3sAlps(r.demanda.QMH) }], col.alerta, { punteada: true, ancho: 1 }),
            serieLinea('Qmd', [{ x: 0, y: M.m3sAlps(r.demanda.Qmd) }, { x: 24, y: M.m3sAlps(r.demanda.Qmd) }], col.ok, { punteada: true, ancho: 1 }),
            seriePuntos('Ahora', [{ x: r.hora, y: M.m3sAlps(r.QsalDem) }], col.ocre),
          ], { x: { min: 0, max: 24 }, y: { min: 0, max: Math.ceil(M.m3sAlps(r.demanda.QMH) * 1.15) } });
        },
        ejes: { xTitulo: 'Hora del día', yTitulo: 'Caudal (L/s)', formatoX: (v) => fmt(v, 0), formatoY: (v) => fmt(v, 1) },
      },
    };
  },

  red() {
    const rd = r.redDiseno;
    const ra = r.red;
    const e = r.especs;
    const nC = rd.N * rd.K;
    const pMin = p.presionMinima;
    return {
      metricas: metricas([
        ['Viviendas', `${nC} (${rd.N} ramales × ${rd.K})`, ''],
        ['Demanda media por vivienda', fmt(r.qMedCasa * 1000, 4), 'L/s'],
        ['QMH por vivienda', fmt(r.qCasaQMH * 1000, 4), 'L/s'],
        ['Caudal de diseño de la red (QMH)', fmt(rd.Qred * 1000, 3), 'L/s'],
        ['Parte del QMH de todo el sector', fmt(100 * rd.Qred / (r.demanda.QMH || 1), 1), '%'],
        ...(rd.qIncendio > 0 ? [['Incluye el hidrante', fmt(rd.qIncendio * 1000, 1), 'L/s', 'aviso']] : []),
        ['Presión mínima con QMH', `${fmt(rd.presionMin, 1)} (${rd.critica.id})`, 'm.c.a.', rd.presionMin >= pMin ? 'ok' : 'alerta'],
        ['Presión estática máxima', fmt(rd.estaticaMax, 1), 'm.c.a.', rd.estaticaMax <= p.presionMaxRed ? 'ok' : 'aviso'],
        ['Presión mínima en este instante', fmt(ra.presionMin, 1), 'm.c.a.'],
        ['Velocidad máxima en la red', fmt(rd.Vmax, 3), 'm/s'],
        ['Punto alto (válvula de aire)', `${rd.puntoAlto.id}, cota ${fmt(rd.puntoAlto.cota)}`, 'm'],
        ['Punto bajo (válvula de purga)', `${rd.puntoBajo.id}, cota ${fmt(rd.puntoBajo.cota)}`, 'm'],
        ['Tubería principal', `${e.Principal.dn} ${e.Principal.clase}, ${fmt(rd.longitudPrincipal, 0)}`, 'm'],
        ['Ramales', `${e.Ramal.dn} ${e.Ramal.clase}, ${fmt(rd.longitudRamales, 0)}`, 'm'],
      ]),
      revision: r.checks.filter((c) => /Red|Acometida|Válvula|compuerta/.test(c.texto)),
      ecuacion: [
        ecu.tipo('Decimales: demanda de una vivienda'),
        ecu.formula(`${i('q')}<sub>md</sub> = hab · dotación / (1 − pérdidas) / 86 400,  QMH = ${i('k')}<sub>1</sub>${i('k')}<sub>2</sub> · ${i('q')}<sub>md</sub>`),
        ecu.sust(`${i('q')}<sub>md</sub> = ${fmt(p.habitantes, 1)} × ${fmt(p.dotacion, 0)} / (1 − ${fmt(p.perdidas)}) / 86 400 = ${fmt(r.qMedCasa * 1000, 4)} L/s;  QMH = ${fmt(p.k1)} × ${fmt(p.k2)} × ${fmt(r.qMedCasa * 1000, 4)} = ${fmt(r.qCasaQMH * 1000, 4)} L/s`),
        ecu.tipo('Ecuación lineal: caudal acumulado en una red ramificada'),
        ecu.formula(`${i('Q')}<sub>tramo</sub> = Σ ${i('q')} de las viviendas aguas abajo (+ hidrante)`),
        ecu.sust(`Primer tramo de la principal: ${i('Q')} = ${nC} × ${fmt(r.qCasaQMH * 1000, 4)}${rd.qIncendio ? ` + ${fmt(rd.qIncendio * 1000, 1)}` : ''} = ${fmt(rd.tramos[0].Q * 1000, 3)} L/s`),
        ecu.tipo('Decimales: presión en cada nodo'),
        ecu.formula(`${i('p')}/γ = ${i('H')}<sub>entrada</sub> − Σ ${i('h')}<sub>f</sub> − ${i('z')}<sub>nodo</sub>`),
        ecu.sust(`Vivienda ${rd.critica.id}: ${fmt(rd.critica.Hn)} − ${fmt(rd.critica.cota)} = ${fmt(rd.critica.presion)} m.c.a.`),
        ecu.nota('El peor caso de diseño es la hora pico (QMH) con el tanque en el nivel de arranque de la bomba. La presión estática máxima se revisa con el tanque lleno y sin consumo, y debe quedar por debajo de la presión de trabajo de la tubería. Los criterios son valores de referencia editables; contrastarlos con el RAS (Resolución 0330 de 2017).'),
      ].join(''),
      leyenda: 'Perfil desde la entrada del barrio hasta la vivienda de análisis: cota piezométrica (línea de energía) y cota del terreno. La distancia vertical entre ellas es la presión.',
      grafica(g) {
        const c = paleta();
        const id = r.casa.id;
        const [j, k] = id.split('-').map(Number);
        const camino = ['E', ...Array.from({ length: j }, (_, x) => `P${x + 1}`), ...Array.from({ length: k }, (_, x) => `R${j}-${x + 1}`)];
        let dist = 0;
        let prev = null;
        const piezo = [];
        const terreno = [];
        for (const nid of camino) {
          const n = ra.nodos[nid];
          if (prev) dist += Math.hypot(n.x - prev.x, n.s - prev.s);
          piezo.push({ x: dist, y: n.H });
          terreno.push({ x: dist, y: n.cota });
          prev = n;
        }
        actualizarGrafica(g, [
          serieLinea('Cota piezométrica', piezo, c.piezo),
          serieLinea('Terreno', terreno, c.ocre, { relleno: 'origin', colorRelleno: `${c.ocre}33` }),
          serieLinea(`Presión mínima (${fmt(pMin, 0)} m)`, terreno.map((t) => ({ x: t.x, y: t.y + pMin })), c.alerta, { punteada: true, ancho: 1 }),
        ], { x: { min: 0 }, y: { min: Math.floor(Math.min(...terreno.map((t) => t.y)) - 2) } });
      },
      ejes: { xTitulo: 'Distancia desde la entrada del barrio (m)', yTitulo: 'Cota (m)', formatoX: (v) => fmt(v, 0), formatoY: (v) => fmt(v, 0) },
      red: { plano: planoRed(), zanja: zanjaSVG(), cantidades: tablaCantidades() },
    };
  },

  vivienda() {
    const H = r.Hcasa;
    const gfo = r.grifo;
    const K = p.K0 / (p.apertura * p.apertura);
    const k = M.coeficientesChorro(p.alturaGrifo, Math.max(r.vGrifo, 1e-9));
    const nivelPresion = r.Hnodo < p.presionMinima ? 'aviso' : 'ok';
    const estados = {
      normal: ['Servicio normal', 'ok'],
      'baja-presion': ['Presión en la red por debajo de la referencia', 'aviso'],
      deficit: ['Desabastecimiento: tanque vacío', 'alerta'],
      'sin-agua': ['No llega agua', 'alerta'],
    };
    const [txtEstado, nivelEstado] = r.casa.cerrada ? ['Ramal cerrado: la vivienda no recibe agua', 'alerta'] : estados[r.estado];
    const ea = r.especs.Acometida;
    return {
      metricas: metricas([
        ['Vivienda de análisis', `Ramal ${r.casa.j}, vivienda ${r.casa.k}${p.casaAnalisis === 'auto' ? ' (la crítica)' : ''}`, ''],
        ['Estado del servicio', txtEstado, '', nivelEstado],
        ['Presión en la red frente a la vivienda', fmt(r.Hnodo), 'm.c.a.', nivelPresion],
        ['Pérdida en la tubería de servicio', fmt(gfo.hf, 2), 'm'],
        ['Pérdida en el medidor', fmt(gfo.hm, 2), 'm'],
        ['Pérdida en la llave de paso', fmt(gfo.hl, 3), 'm'],
        ['Carga disponible en el grifo', fmt(H), 'm.c.a.', H <= 0 ? 'alerta' : 'ok'],
        ['Presión en el grifo', fmt(r.presionCasa), 'kPa'],
        ['Velocidad de salida', fmt(r.vGrifo), 'm/s'],
        ['Caudal en el grifo', `${fmt(r.qGrifo * 1000)} L/s, ${fmt(r.qGrifo * 60000, 1)}`, 'L/min'],
        ['Alcance del chorro', fmt(r.alcance), 'm'],
        ['Tubería de servicio', `${D.MATERIALES[ea.mat].corto} ${ea.dn} ${ea.clase}, DI ${fmt(ea.DI * 1000, 1)}`, 'mm'],
      ]),
      ecuacion: [
        ecu.tipo('Decimales: carga disponible en el grifo'),
        ecu.formula(`${i('H')} = ${i('H')}<sub>red</sub> − ${i('z')}<sub>grifo</sub> − ${i('h')}<sub>f,servicio</sub> − ${i('h')}<sub>medidor</sub> − ${i('h')}<sub>llave</sub>`),
        ecu.sust(`${i('H')} = ${fmt(r.casa.Hn)} − (${fmt(r.casa.cota)} + ${fmt(p.alturaGrifo)}) − ${fmt(gfo.hf)} − ${fmt(gfo.hm)} − ${fmt(gfo.hl, 3)} = ${fmt(H)} m.c.a.`),
        ecu.tipo('Ecuación cuadrática: pérdida del medidor'),
        ecu.formula(`${i('h')}<sub>medidor</sub> = Δ${i('h')}<sub>máx</sub> · (${i('q')} / ${i('q')}<sub>máx</sub>)²`),
        ecu.sust(`${i('h')}<sub>medidor</sub> = ${fmt(p.medidorDh, 1)} × (${fmt(r.qGrifo * 3600, 3)} / ${fmt(p.medidorQmax, 1)})² = ${fmt(gfo.hm)} m`),
        ecu.tipo('Ecuación cuadrática: velocidad de salida'),
        ecu.formula(`((1 + ${i('K')}) / 2${i('g')}) · ${i('v')}² − ${i('H')} = 0,  ${i('K')} = ${i('K')}₀ / ${i('a')}²`),
        H > 0
          ? ecu.sust(`${i('K')} = ${fmt(p.K0, 0)} / ${fmt(p.apertura)}² = ${fmt(K)};  ${i('v')} = √(2 × 9.81 × ${fmt(H)} / ${fmt(1 + K)}) = ${fmt(r.vGrifo)} m/s`)
          : ecu.nota('La carga es cero o negativa: la ecuación no tiene raíz positiva y el grifo queda seco.', true),
        ecu.tipo('Ecuación cuadrática: trayectoria del chorro'),
        ecu.formula(`${i('y')}(${i('x')}) = −(${i('g')} / 2${i('v')}²) · ${i('x')}² + ${i('h')}₀`),
        r.vGrifo > 0
          ? ecu.sust(`${i('y')}(${i('x')}) = ${fmt(k.a, 4)}${i('x')}² + ${fmt(p.alturaGrifo)};  ${i('y')} = 0 cuando ${i('x')} = ${fmt(r.vGrifo)} × √(2 × ${fmt(p.alturaGrifo)} / 9.81) = ${fmt(r.alcance)} m`)
          : '',
        ecu.nota(`Las pérdidas de la acometida dependen del caudal que sale por el grifo, y ese caudal depende de la carga que queda: se resuelven juntas. La presión mínima de ${fmt(p.presionMinima, 1)} m.c.a. se exige en la red, frente a la vivienda; es un valor de referencia editable.`),
      ].join(''),
      leyenda: 'Trayectoria parabólica del chorro que sale horizontalmente del grifo hasta tocar el suelo.',
      grafica(g) {
        const c = paleta();
        const alc = Math.max(r.alcance, 0.01);
        const pts = Array.from({ length: 41 }, (_, j) => {
          const x = (alc * j) / 40;
          return { x, y: r.vGrifo > 0 ? M.trayectoriaChorro(x, p.alturaGrifo, r.vGrifo) : p.alturaGrifo };
        });
        actualizarGrafica(g, [
          serieLinea('y(x)', r.vGrifo > 0 ? pts : [], c.agua),
          seriePuntos('Salida', [{ x: 0, y: p.alturaGrifo }], c.tinta2, 4),
          seriePuntos('Punto de caída', r.vGrifo > 0 ? [{ x: r.alcance, y: 0 }] : [], c.ocre),
        ], { x: { min: 0, max: Math.max(1, Math.ceil(alc * 1.15 * 2) / 2) }, y: { min: 0, max: Math.ceil(p.alturaGrifo * 1.2 * 2) / 2 } });
      },
      ejes: { xTitulo: 'Distancia horizontal (m)', yTitulo: 'Altura (m)', formatoX: (v) => fmt(v, 1), formatoY: (v) => fmt(v, 1) },
    };
  },

  rio() {
    const rv = r.rio;
    const b = rv.boc;
    const cal = rv.calidad;
    const ini = cal.inicio;
    const sed = rv.sed;
    const tipo = cal.tipo;
    const nivelOD = (od) => (od < p.odMin ? 'alerta' : (od < p.odMin + 1 ? 'aviso' : 'ok'));
    const nivelCF = (cf) => (cf > p.cfMax ? 'alerta' : 'ok');
    const zonaMin = R.ZONAS[R.zonaDeKm(Math.min(cal.odMin.km, 49.99))].nombre.toLowerCase();
    const zonaV = ini ? ini.zona : 'baja';
    const h = cal.hid[zonaV];
    const crit = cal.critico;
    const textoCritico = ini && crit.tc > 0
      ? `si el tramo siguiera igual, el punto crítico estaría a ${fmt(crit.tc, 2)} días, en el km ${fmt(crit.km, 1)}${crit.km > R.KM_DESEMBOCADURA ? ' (después de la desembocadura)' : ''}, con ${i('D')}<sub>c</sub> = ${fmt(crit.Dc)} mg/L`
      : 'el déficit solo disminuye: el río se airea más rápido de lo que se consume el oxígeno';
    return {
      metricas: metricas([
        ['<b>El río en la bocatoma (km 44)</b>', '', ''],
        ['Escenario de lluvia', R.LLUVIAS[p.lluvia]?.nombre ?? 'Personalizado', ''],
        ...(Math.abs(r.represa.dQ) > 1e-9 ? [
          ['Cota de la lámina sin la represa', p.cotaRio, 'm.s.n.m.'],
          [r.represa.dQ > 0 ? 'La represa suelta de más' : 'La represa guarda', Math.abs(r.represa.dQ), 'm³/s', '', 3],
          ['Cota de la lámina con la represa', cotaEf(), 'm.s.n.m.'],
        ] : [['Cota de la lámina', p.cotaRio, 'm.s.n.m.']]),
        ['Profundidad del agua', b.y, 'm'],
        ['Caudal del río', b.Q, 'm³/s'],
        ['Velocidad media', b.V, 'm/s'],
        ['Lámina sobre la rejilla', rv.capta ? fmt(rv.lamina) : `${fmt(rv.lamina)} (no capta)`, 'm', rv.capta ? 'ok' : 'alerta'],
        ['Parte del río que se bombea', fmt((100 * lps(p.Qbombeo)) / Math.max(b.Q, 1e-9), 2), '%'],
        ['Agua sobre la vega del cultivo de la llanura', r.huella.loteBaja.profRio > 0 ? fmt(r.huella.loteBaja.profRio) : `no llega (la vega está a la cota ${fmt(H.COTA_VEGA)} m)`, r.huella.loteBaja.profRio > 0 ? 'm' : '', r.huella.loteBaja.profRio > 0 ? 'alerta' : 'ok'],
        ['<b>Sedimento que traen las lluvias</b>', '', ''],
        ['Sedimento en suspensión', p.sedimento, 'mg/L', '', 0],
        ['Sedimento que entra al desarenador', sed.Mentra, 'kg/día', '', 1],
        ['Se queda en el desarenador', fmt(sed.f * 100, 0), '%'],
        ['Sedimento que sigue al tanque', sed.Cpasa, 'mg/L', sed.Cpasa <= 500 ? 'ok' : 'aviso', 0],
        ['Limpieza de la tolva cada', Number.isFinite(sed.dias) ? fmt(sed.dias, 1) : 'no se llena', Number.isFinite(sed.dias) ? 'días' : '', sed.dias >= 7 ? 'ok' : 'aviso'],
        ['<b>Vertimiento</b>', '', ''],
        ['Tipo', tipo.nombre, ''],
        ...(ini ? [
          ['Dónde entra', R.PUNTOS_VERTIMIENTO[p.vertZona], ''],
          ['Caudal del vertimiento', p.Qvert, 'L/s', '', 1],
          ['Dilución (caudal del río / vertimiento)', fmt(ini.Qrio / ini.Qv, 0), 'veces'],
          ['DBO después de la mezcla', ini.L0, 'mg/L'],
          ['Oxígeno disuelto después de la mezcla', ini.OD0, 'mg/L', nivelOD(ini.OD0)],
          ['Coliformes fecales después de la mezcla', R.miles(ini.N0), 'NMP/100 mL', nivelCF(ini.N0)],
          ['Nitratos después de la mezcla', ini.NO30, 'mg/L de N'],
        ] : []),
        ['<b>Calidad a lo largo del río</b>', '', ''],
        ['Oxígeno disuelto mínimo', `${fmt(cal.odMin.od)} (km ${fmt(cal.odMin.km, 1)}, ${zonaMin})`, 'mg/L', nivelOD(cal.odMin.od)],
        ['Bocatoma: oxígeno disuelto', cal.bocatoma.OD, 'mg/L', nivelOD(cal.bocatoma.OD)],
        ['Bocatoma: DBO', cal.bocatoma.DBO, 'mg/L'],
        ['Bocatoma: coliformes fecales', R.miles(cal.bocatoma.CF), 'NMP/100 mL', nivelCF(cal.bocatoma.CF)],
        ['Bocatoma: nitratos', cal.bocatoma.NO3, 'mg/L de N', cal.bocatoma.NO3 <= 10 ? 'ok' : 'alerta'],
        ...(ini && cal.bocatoma.tViaje != null ? [['Tiempo de viaje del vertimiento a la bocatoma', fmtTiempo(cal.bocatoma.tViaje * 86400), '']] : []),
        ['Desembocadura: oxígeno disuelto', cal.desembocadura.OD, 'mg/L', nivelOD(cal.desembocadura.OD)],
        ['Desembocadura: coliformes fecales', R.miles(cal.desembocadura.CF), 'NMP/100 mL'],
      ]),
      revision: rv.checks,
      perfil: perfilRio(),
      tablas: tablaZonasRio(),
      ecuacion: [
        ecu.tipo('Ecuación de Manning: curva de descarga del río en la bocatoma'),
        ecu.formula(`${i('Q')} = (1/${i('n')})·${i('A')}·${i('R')}<sup>2/3</sup>·${i('S')}<sup>1/2</sup>,  ${i('A')} = ${i('B')}·${i('y')},  ${i('R')} = ${i('A')}/(${i('B')} + 2${i('y')}),  ${i('y')} = ${i('z')}<sub>río</sub> − ${i('z')}<sub>fondo</sub>`),
        ecu.sust(`${i('y')} = ${fmt(cotaEf())} − ${fmt(R.CAUCE.fondo)} = ${fmt(b.y)} m;  ${i('Q')} = (1/${fmt(R.CAUCE.n, 3)}) × ${fmt(b.A)} × ${fmt(b.R, 3)}<sup>2/3</sup> × ${fmt(R.CAUCE.pendiente, 4)}<sup>1/2</sup> = ${fmt(b.Q)} m³/s`),
        ...(ini ? [
          ecu.tipo('Decimales: mezcla del vertimiento (balance de masa)'),
          ecu.formula(`${i('C')} = (${i('Q')}<sub>r</sub>·${i('C')}<sub>r</sub> + ${i('Q')}<sub>v</sub>·${i('C')}<sub>v</sub>) / (${i('Q')}<sub>r</sub> + ${i('Q')}<sub>v</sub>)`),
          ecu.sust(`DBO = (${fmt(ini.Qrio, 3)} × ${fmt(ini.antes.L)} + ${fmt(ini.Qv, 4)} × ${R.miles(tipo.DBO)}) / (${fmt(ini.Qrio, 3)} + ${fmt(ini.Qv, 4)}) = ${fmt(ini.L0)} mg/L`),
          ecu.tipo('Función exponencial: la DBO y los coliformes decaen río abajo'),
          ecu.formula(`${i('L')} = ${i('L')}<sub>0</sub>·e<sup>−${i('k')}<sub>d</sub>${i('t')}</sup>,  ${i('N')} = ${i('N')}<sub>0</sub>·e<sup>−${i('k')}<sub>b</sub>${i('t')}</sup>,  ${i('k')}<sub>T</sub> = ${i('k')}<sub>20</sub>·θ<sup>${i('T')} − 20</sup>,  ${i('t')} = distancia/${i('u')}`),
          ecu.sust(`${R.ZONAS[zonaV].nombre}, ${h.T} °C: ${i('k')}<sub>d</sub> = ${fmt(R.K20.kd)} × ${R.THETA.kd}<sup>${h.T - 20}</sup> = ${fmt(h.kd, 3)} 1/día;  ${i('k')}<sub>b</sub> = ${fmt(R.K20.kb)} × ${R.THETA.kb}<sup>${h.T - 20}</sup> = ${fmt(h.kb, 3)} 1/día`),
          ecu.tipo('Streeter-Phelps: déficit de oxígeno disuelto'),
          ecu.formula(`${i('D')}(${i('t')}) = ${i('k')}<sub>d</sub>${i('L')}<sub>0</sub>/(${i('k')}<sub>a</sub> − ${i('k')}<sub>d</sub>)·(e<sup>−${i('k')}<sub>d</sub>${i('t')}</sup> − e<sup>−${i('k')}<sub>a</sub>${i('t')}</sup>) + ${i('D')}<sub>0</sub>·e<sup>−${i('k')}<sub>a</sub>${i('t')}</sup>,  OD = OD<sub>sat</sub> − ${i('D')}`),
          ecu.formula(`${i('k')}<sub>a</sub> = 3.93·${i('u')}<sup>0.5</sup>/${i('H')}<sup>1.5</sup> (O'Connor y Dobbins),  ${i('t')}<sub>c</sub> = ln[(${i('k')}<sub>a</sub>/${i('k')}<sub>d</sub>)·(1 − ${i('D')}<sub>0</sub>(${i('k')}<sub>a</sub> − ${i('k')}<sub>d</sub>)/(${i('k')}<sub>d</sub>${i('L')}<sub>0</sub>))] / (${i('k')}<sub>a</sub> − ${i('k')}<sub>d</sub>)`),
          ecu.sust(`${i('k')}<sub>a</sub> = 3.93 × ${fmt(h.u, 3)}<sup>0.5</sup> / ${fmt(h.y, 3)}<sup>1.5</sup> = ${fmt(h.ka20, 2)} 1/día a 20 °C (${fmt(h.ka, 2)} a ${h.T} °C);  ${i('L')}<sub>0</sub> = ${fmt(ini.L0)}, ${i('D')}<sub>0</sub> = ${fmt(ini.D0)} mg/L: ${textoCritico}`),
          ecu.nota('El perfil del panel se calcula paso a paso cada 100 m: en cada cambio de zona entran afluentes limpios que diluyen, y cambian la temperatura, la velocidad y la reaireación.'),
        ] : []),
        ecu.nota('Valores de referencia: coliformes fecales ≤ 2 000 NMP/100 mL y nitratos ≤ 10 mg/L de N en el agua que se potabiliza con tratamiento convencional, y oxígeno disuelto ≥ 4 mg/L para la vida acuática en aguas cálidas (Decreto 1594 de 1984, compilado en el Decreto 1076 de 2015). La Resolución 0565 de 2026 del Ministerio de Ambiente fija nuevos criterios de calidad que rigen desde mayo de 2027. Los límites del panel son editables.'),
      ].join(''),
      leyenda: 'Oxígeno disuelto y DBO del nacimiento (km 0) a la desembocadura (km 50). El vertimiento sube la DBO; las bacterias que la consumen gastan el oxígeno, y el río lo recupera del aire.',
      grafica(g) {
        const c = paleta();
        const P = cal.puntos;
        const yMax = Math.max(10, Math.min(40, Math.ceil(Math.max(...P.map((x) => Math.max(x.DBO, x.ODsat))) + 1)));
        actualizarGrafica(g, [
          serieLinea('Oxígeno disuelto', P.map((x) => ({ x: x.km, y: x.OD })), c.agua, { ancho: 2.5 }),
          serieLinea('Saturación', P.map((x) => ({ x: x.km, y: x.ODsat })), c.tinta2, { punteada: true, ancho: 1 }),
          serieLinea('DBO', P.map((x) => ({ x: x.km, y: Math.min(x.DBO, yMax) })), c.ocre),
          serieLinea(`Mínimo para la vida acuática (${fmt(p.odMin, 1)})`, [{ x: 0, y: p.odMin }, { x: 50, y: p.odMin }], c.alerta, { punteada: true, ancho: 1 }),
          serieLinea('Límites de zona', [{ x: 15, y: 0 }, { x: 15, y: yMax }, { x: 15, y: null }, { x: 35, y: yMax }, { x: 35, y: 0 }], c.linea, { ancho: 1, sinLeyenda: true }),
          seriePuntos('Bocatoma', [{ x: R.KM_BOCATOMA, y: cal.bocatoma.OD }], c.agua),
          ...(ini ? [seriePuntos('Vertimiento', [{ x: cal.kmV, y: Math.min(ini.L0, yMax) }], c.alerta)] : []),
        ], { x: { min: 0, max: 50 }, y: { min: 0, max: yMax } });
      },
      ejes: { xTitulo: 'Distancia desde el nacimiento (km)', yTitulo: 'Concentración (mg/L)', formatoX: (v) => fmt(v, 0), formatoY: (v) => fmt(v, 1) },
      extra: {
        leyenda: 'Coliformes fecales a lo largo del río, en escala logarítmica: cada raya horizontal es diez veces la anterior. El vertimiento los sube de golpe y luego mueren poco a poco río abajo.',
        grafica(g) {
          const c = paleta();
          const P = cal.puntos;
          const lg = (v) => Math.log10(Math.max(1, v));
          const yMax = Math.max(5, Math.ceil(Math.max(...P.map((x) => lg(x.CF))) + 0.5));
          actualizarGrafica(g, [
            serieLinea('Coliformes fecales', P.map((x) => ({ x: x.km, y: lg(x.CF) })), c.ocre, { ancho: 2.5 }),
            serieLinea(`Para potabilizar (${R.miles(p.cfMax)})`, [{ x: 0, y: lg(p.cfMax) }, { x: 50, y: lg(p.cfMax) }], c.alerta, { punteada: true, ancho: 1 }),
            serieLinea(`Para regar lo que se come crudo (${R.miles(G.CF_RIEGO_CRUDO)})`, [{ x: 0, y: lg(G.CF_RIEGO_CRUDO) }, { x: 50, y: lg(G.CF_RIEGO_CRUDO) }], c.ok, { punteada: true, ancho: 1 }),
            seriePuntos('Bocatoma', [{ x: R.KM_BOCATOMA, y: lg(cal.bocatoma.CF) }], c.agua),
          ], { x: { min: 0, max: 50 }, y: { min: 0, max: yMax, paso: 1 } });
        },
        ejes: { xTitulo: 'Distancia desde el nacimiento (km)', yTitulo: 'Coliformes fecales (NMP/100 mL)', formatoX: (v) => fmt(v, 0), formatoY: potencia10 },
      },
    };
  },

  represa() {
    const rep = r.represa;
    const ano = r.anoRepresa;
    const pct = (100 * rep.V) / rep.Vmax;
    const subeDia = rep.pendienteNivel * 86400;
    const tendencia = subeDia > 1e-6 ? `sube ${fmt(subeDia, 3)} m al día` : (subeDia < -1e-6 ? `baja ${fmt(-subeDia, 3)} m al día` : 'estable');
    const tiempo = rep.neto > 1e-9 ? (rep.llena ? 'lleno: lo que sobra sale por el aliviadero' : `se llena en ${fmtTiempo(rep.tLlenar)}`)
      : (rep.neto < -1e-9 ? `llega al nivel mínimo en ${fmtTiempo(rep.tVaciar)}` : 'no cambia: sale lo mismo que entra');
    const hayEnergia = rep.Eent > 0;
    const Qestrella = Math.sqrt(Math.max(0, rep.Hb) / (3 * P.PRESA.kForzada));
    // Caudal en las tres zonas con la represa y sin ella
    const ids = Object.keys(R.ZONAS);
    const hid = r.rio.calidad.hid;
    const tablaZonas = tablaHTML('Caudal del río en las tres zonas, con la represa y sin ella', ['', 'Alta', 'Media', 'Baja'], [
      ['Sin la represa', ...ids.map((z) => `${fmt(rep.zonas[z].natural)} m³/s`)],
      ['Con la represa', ...ids.map((z) => ({ v: `${fmt(rep.zonas[z].conRepresa)} m³/s`, clase: rep.zonas[z].cambio < -0.005 ? 'mal' : (rep.zonas[z].cambio > 0.005 ? 'bien' : '') }))],
      ['Cambio', ...ids.map((z) => `${rep.zonas[z].cambio > 0 ? '+' : ''}${fmt(100 * rep.zonas[z].cambio, 1)} %`)],
      ['Profundidad con la represa', ...ids.map((z) => `${fmt(hid[z].y)} m`)],
      ['Velocidad con la represa', ...ids.map((z) => `${fmt(hid[z].u)} m/s`)],
    ], { numericas: [1, 2, 3], nota: 'La presa está en el km 7 de la zona alta: el caudal que guarda o suelta cambia el río de ahí hasta el mar. El mismo caudal pesa más en la zona alta, donde el río es más pequeño.' });
    const tensiones = P.TENSIONES.map((kV) => {
      const l = P.perdidasLinea(rep.P, kV);
      const Eent = rep.Emes - (l.perdidas / 1000) * rep.horasMes;
      return { kV, l, Eent, costo: Eent > 0 ? (p.costoGeneracion * rep.Emes) / Eent + p.costoLinea : Infinity };
    });
    const marcarT = P.TENSIONES.indexOf(p.tensionLinea) + 1;
    const tablaEnergia = tablaHTML('Producir la energía y llevarla a la ciudad', ['', ...P.TENSIONES.map((kV) => `${fmt(kV, 1)} kV`)], [
      ['Potencia de la central', ...tensiones.map(() => `${fmt(rep.P / 1000, 1)} kW`)],
      ['Corriente en la línea', ...tensiones.map((t) => `${fmt(t.l.I, 2)} A`)],
      ['Pérdidas en la línea', ...tensiones.map((t) => ({ v: `${fmt(t.l.perdidas / 1000, 2)} kW (${fmt(100 * t.l.fraccion, 2)} %)`, clase: t.l.fraccion > 0.05 ? 'mal' : '' }))],
      ['Energía que llega al mes', ...tensiones.map((t) => `${R.miles(t.Eent)} kWh`)],
      ['Producirla (al mes)', ...tensiones.map(() => `$ ${R.miles(rep.costoGenerar)}`)],
      ['Llevarla por la línea (al mes)', ...tensiones.map((t) => `$ ${R.miles(p.costoLinea * t.Eent)}`)],
      ['kWh puesto en la ciudad', ...tensiones.map((t) => (Number.isFinite(t.costo) ? `${fmt(t.costo, 2)} COP` : '—'))],
      ['Tarifa de la red', ...tensiones.map(() => `${fmt(p.tarifaKWh, 0)} COP`)],
    ], { numericas: [1, 2], marcar: marcarT, nota: `Con más tensión la corriente baja en proporción y las pérdidas, con su cuadrado: de ${fmt(P.TENSIONES[0], 1)} a ${fmt(P.TENSIONES[1], 1)} kV se pierde ${fmt((P.TENSIONES[1] / P.TENSIONES[0]) ** 2, 1)} veces menos. Son costos de operación: no incluyen construir la presa ni la línea.` });
    const formas = [
      ['Bombear del río con energía de la red', rep.agua.red],
      ['Bombear del río con energía de la represa', hayEnergia ? rep.agua.represa : Infinity],
      ['Bajarla del embalse por gravedad', rep.agua.gravedad],
    ];
    const menor = Math.min(...formas.map(([, v]) => v));
    const tablaAgua = tablaHTML('Agua para la ciudad: tres formas de operar', ['Forma', 'Al mes', 'Por m³'], formas.map(([t, v]) => ({
      clase: v === menor ? 'elegida' : '',
      celdas: [t, Number.isFinite(v) ? `$ ${R.miles(v)}` : 'sin energía', Number.isFinite(v) ? `${fmt(v / Math.max(r.Vmes, 1e-9), 1)} COP` : '—'],
    })), { numericas: [1, 2], nota: `La ciudad usa ${R.miles(r.Vmes)} m³ al mes. Por gravedad no se paga energía, pero hay que operar ${P.PRESA.distanciaCiudad} km de tubería con ${rep.camaras} cámaras de quiebre de presión (una cada ${P.PRESA.presionTramo} m de desnivel: el embalse está ${R.miles(rep.desnivel)} m por encima del tanque). La fila resaltada es la más barata.` });
    const tablaAno = tablaHTML(`Un año de operación: ${P.OPERACIONES[p.operacionPresa].toLowerCase()}`, ['Mes', 'Entra', 'Sale', 'Nivel al final', 'Energía'],
      ano.meses.map((m) => [m.mes, `${fmt(m.Qin)} m³/s`, `${fmt(m.Qout)} m³/s`, { v: `${fmt(m.h, 1)} m`, clase: m.h <= rep.hMin + 0.05 ? 'mal' : '' }, `${R.miles(m.E / 1000)} MWh`]),
      { numericas: [1, 2, 3, 4], nota: `Caudal medio de cada mes (secas de diciembre a abril, lluvias en mayo y de septiembre a noviembre), empezando en enero con el nivel de ahora. En el año: ${R.miles(ano.Eano / 1000)} MWh.` });
    const A0 = P.PRESA.aValle;
    return {
      metricas: metricas([
        ['<b>Embalse</b>', '', ''],
        ['Nivel del agua sobre el lecho', rep.nivel, 'm', rep.nivel >= rep.hMin - 1e-6 ? 'ok' : 'aviso'],
        ['Niveles de operación', `de ${fmt(rep.hMin, 1)} a ${fmt(rep.hMax, 1)} m`, ''],
        ['Volumen guardado', rep.V / 1e6, 'millones de m³', '', 3],
        ['Lleno al', fmt(pct, 1), '%'],
        ['Área del espejo de agua', rep.A / 1e4, 'ha', '', 1],
        ['Caudal que entra', rep.Qin, 'm³/s', '', 3],
        ['Caudal que suelta la presa', rep.Qsale, 'm³/s', rep.Qsale >= rep.Qamb - 1e-9 ? 'ok' : 'alerta', 3],
        ['Caudal ambiental (mínimo)', rep.Qamb, 'm³/s', '', 3],
        ['El nivel', tendencia, ''],
        ['Con este balance', tiempo, ''],
        ['Evaporación del espejo de agua', rep.Qevap * 1000, 'L/s', '', 1],
        ['<b>Central hidroeléctrica</b>', '', ''],
        ['Caudal por las turbinas', rep.Qturb, 'm³/s', rep.Qturb > 0 ? 'ok' : 'aviso', 3],
        ['Caudal por el aliviadero o el desagüe', rep.Qvert, 'm³/s', '', 3],
        ['Salto bruto (embalse − río al pie)', rep.Hb, 'm'],
        ['Pérdida en la tubería forzada', rep.hf, 'm', '', 3],
        ['Salto neto', rep.Hn, 'm'],
        ['Potencia eléctrica', rep.P / 1000, 'kW', '', 1],
        ['Potencia instalada (turbinas llenas, nivel máximo)', rep.PinstW / 1000, 'kW', '', 1],
        ['Energía al mes', rep.Emes, 'kWh', '', 0],
        ['Energía en un año (mes a mes)', ano.Eano / 1000, 'MWh', '', 0],
        ['<b>Línea eléctrica a la ciudad</b>', '', ''],
        ['Tensión y longitud', `${fmt(p.tensionLinea, 1)} kV, ${P.PRESA.distanciaCiudad} km`, ''],
        ['Corriente', rep.linea.I, 'A'],
        ['Potencia que se pierde', `${fmt(rep.linea.perdidas / 1000, 2)} kW (${fmt(100 * rep.linea.fraccion, 2)} %)`, '', rep.linea.fraccion <= 0.05 ? 'ok' : 'aviso'],
        ['Energía que llega a la ciudad al mes', rep.Eent, 'kWh', '', 0],
        ['Viviendas que abastece', rep.viviendas, 'viviendas', '', 0],
        ['<b>Costos de operación de la energía (al mes)</b>', '', ''],
        ['Producirla', rep.costoGenerar, 'COP', '', 0],
        ['Llevarla a la ciudad por la línea', p.costoLinea * rep.Eent, 'COP', '', 0],
        ['kWh puesto en la ciudad', hayEnergia ? rep.costoPuesto : 'sin energía', hayEnergia ? 'COP/kWh' : '', hayEnergia && rep.costoPuesto <= p.tarifaKWh ? 'ok' : 'aviso'],
        ['Tarifa de la energía de la red', p.tarifaKWh, 'COP/kWh', '', 0],
        ['<b>Agua para la ciudad (al mes)</b>', '', ''],
        ['Bombear del río con energía de la red', rep.agua.red, 'COP', '', 0],
        ['Bombear del río con energía de la represa', hayEnergia ? rep.agua.represa : 'sin energía', hayEnergia ? 'COP' : '', '', 0],
        ['Bajarla del embalse por gravedad', rep.agua.gravedad, 'COP', '', 0],
        ['Desnivel del embalse al tanque', rep.desnivel, 'm', '', 0],
        ['Cámaras de quiebre de presión', rep.camaras, '', '', 0],
      ]),
      revision: rep.checks,
      figura: presaSVG(),
      tablas: tablaZonas + tablaEnergia + tablaAgua + tablaAno,
      ecuacion: [
        ecu.tipo('Ecuación cuadrática: volumen del embalse'),
        ecu.formula(`${i('V')} = ${i('a')}·${i('h')}²,  ${i('h')} = √(${i('V')}/${i('a')}),  ${i('A')} = d${i('V')}/d${i('h')} = 2·${i('a')}·${i('h')}`),
        ecu.sust(`${i('V')} = ${R.miles(A0)} × ${fmt(rep.nivel)}² = ${R.miles(rep.V)} m³;  ${i('A')} = 2 × ${R.miles(A0)} × ${fmt(rep.nivel)} = ${R.miles(rep.A)} m²`),
        ecu.nota('El valle tiene forma de V: con el doble de nivel el embalse guarda cuatro veces más agua.'),
        ecu.tipo('Ecuación lineal: balance del embalse'),
        ecu.formula(`d${i('V')}/d${i('t')} = ${i('Q')}<sub>entra</sub> − ${i('Q')}<sub>sale</sub>,  d${i('h')}/d${i('t')} = (${i('Q')}<sub>entra</sub> − ${i('Q')}<sub>sale</sub>)/${i('A')}`),
        ecu.sust(`d${i('h')}/d${i('t')} = (${fmt(rep.Qin, 3)} − ${fmt(rep.Qsale, 3)}) × 86 400 / ${R.miles(rep.A)} = ${fmt(subeDia, 4)} m/día`),
        ecu.tipo('Función cúbica: potencia de la central'),
        ecu.formula(`${i('P')} = ρ${i('g')}·${i('Q')}·${i('H')}<sub>n</sub>·η,  ${i('H')}<sub>n</sub> = ${i('h')} − ${i('y')} − ${i('k')}·${i('Q')}²  ⇒  ${i('P')}(${i('Q')}) = ρ${i('g')}η·(${i('H')}<sub>b</sub>·${i('Q')} − ${i('k')}·${i('Q')}³)`),
        ecu.sust(`${i('H')}<sub>n</sub> = ${fmt(rep.nivel)} − ${fmt(rep.yAbajo, 3)} − ${P.PRESA.kForzada} × ${fmt(rep.Qturb, 3)}² = ${fmt(rep.Hn, 3)} m;  ${i('P')} = 997.05 × 9.81 × ${fmt(rep.Qturb, 3)} × ${fmt(rep.Hn, 3)} × ${fmt(rep.eta)} = ${fmt(rep.P / 1000, 1)} kW`),
        ecu.nota(`La derivada se anula en ${i('Q')}* = √(${i('H')}<sub>b</sub>/(3${i('k')})) = ${fmt(Qestrella, 2)} m³/s: con más caudal la pérdida de la tubería forzada se come el salto y la potencia baja.`),
        ecu.tipo('Ecuación cuadrática: pérdidas de la línea'),
        ecu.formula(`${i('I')} = ${i('P')}/(√3·${i('U')}·fp),  ${i('P')}<sub>p</sub> = 3·${i('I')}²·${i('r')}·${i('L')}`),
        ecu.sust(`${i('I')} = ${R.miles(rep.P)} / (√3 × ${R.miles(p.tensionLinea * 1000)} × ${P.PRESA.fp}) = ${fmt(rep.linea.I, 2)} A;  ${i('P')}<sub>p</sub> = 3 × ${fmt(rep.linea.I, 2)}² × ${P.PRESA.rLinea} × ${P.PRESA.distanciaCiudad} = ${fmt(rep.linea.perdidas / 1000, 3)} kW`),
        ecu.tipo('Función racional: costo del kWh puesto en la ciudad'),
        ecu.formula(`${i('c')} = ${i('c')}<sub>prod</sub>·${i('E')}/${i('E')}<sub>ciudad</sub> + ${i('c')}<sub>línea</sub>,  ${i('E')}<sub>ciudad</sub> = (${i('P')} − ${i('P')}<sub>p</sub>)·24·30`),
        hayEnergia
          ? ecu.sust(`${i('c')} = ${fmt(p.costoGeneracion, 0)} × ${R.miles(rep.Emes)} / ${R.miles(rep.Eent)} + ${fmt(p.costoLinea, 0)} = ${fmt(rep.costoPuesto, 2)} COP/kWh`)
          : ecu.sust('La central no produce energía con el nivel o el caudal de ahora.'),
        ecu.nota('Costos de operación de referencia (editables): no incluyen la inversión. Como comparación, el costo nivelado de la energía de las hidroeléctricas nuevas en el mundo, que sí la incluye, fue de unos 0.057 dólares por kWh en 2024 (IRENA, 2025). El consumo de una vivienda es el de subsistencia por debajo de 1 000 m.s.n.m.: 173 kWh al mes (UPME).'),
      ].join(''),
      leyenda: 'Potencia de la central según el caudal que pasa por las turbinas, con el embalse en tres niveles. La pérdida de la tubería forzada crece con Q²: la potencia es una función cúbica con un máximo. La raya vertical es la capacidad de las turbinas.',
      grafica(g) {
        const c = paleta();
        const Qmax = Math.max(1.5 * p.QturbMax, Math.sqrt(rep.hMax / P.PRESA.kForzada));
        const curva = (h) => Array.from({ length: 81 }, (_, k) => {
          const Q = (Qmax * k) / 80;
          return { x: Q, y: P.central(Q, h, Q, rep.eta).P / 1000 };
        });
        const pMax = P.central(Math.sqrt(rep.hMax / (3 * P.PRESA.kForzada)), rep.hMax, Math.sqrt(rep.hMax / (3 * P.PRESA.kForzada)), rep.eta).P / 1000;
        const yTope = Math.max(100, Math.ceil((1.1 * pMax) / 200) * 200);
        actualizarGrafica(g, [
          serieLinea(`Nivel de ahora (${fmt(rep.nivel, 1)} m)`, curva(rep.nivel), c.agua, { ancho: 2.5 }),
          serieLinea(`Nivel máximo (${fmt(rep.hMax, 1)} m)`, curva(rep.hMax), c.ok, { punteada: true, ancho: 1.5 }),
          serieLinea(`Nivel mínimo (${fmt(rep.hMin, 1)} m)`, curva(rep.hMin), c.ocre, { punteada: true, ancho: 1.5 }),
          serieLinea('Capacidad de las turbinas', [{ x: p.QturbMax, y: 0 }, { x: p.QturbMax, y: yTope }], c.tinta2, { punteada: true, ancho: 1 }),
          seriePuntos('Ahora', [{ x: rep.Qturb, y: rep.P / 1000 }], c.alerta),
        ], { x: { min: 0, max: Math.ceil(Qmax) }, y: { min: 0, max: yTope } });
      },
      ejes: { xTitulo: 'Caudal por las turbinas (m³/s)', yTitulo: 'Potencia (kW)', formatoX: (v) => fmt(v, 1), formatoY: (v) => fmt(v, 0) },
      extra: {
        leyenda: `Un año de operación con la presa en «${P.OPERACIONES[p.operacionPresa].toLowerCase()}»: caudal medio de cada mes que entra al embalse y que suelta la presa, y el río en la bocatoma con la represa y sin ella.`,
        grafica(g) {
          const c = paleta();
          const M12 = ano.meses.map((m, k) => ({ ...m, x: k + 1 }));
          const yMax = techoRedondo(Math.max(...M12.map((m) => Math.max(m.bocNatural, m.bocConRepresa, m.Qout))) * 1.05);
          actualizarGrafica(g, [
            serieLinea('Entra al embalse', M12.map((m) => ({ x: m.x, y: m.Qin })), c.ocre, { ancho: 2 }),
            serieLinea('Sale de la presa', M12.map((m) => ({ x: m.x, y: m.Qout })), c.agua, { ancho: 2.5 }),
            serieLinea('Río en la bocatoma sin represa', M12.map((m) => ({ x: m.x, y: m.bocNatural })), c.tinta2, { punteada: true, ancho: 1.5 }),
            serieLinea('Río en la bocatoma con represa', M12.map((m) => ({ x: m.x, y: m.bocConRepresa })), c.ok, { ancho: 2 }),
          ], { x: { min: 1, max: 12, paso: 1 }, y: { min: 0, max: yMax } });
        },
        ejes: { xTitulo: 'Mes', yTitulo: 'Caudal (m³/s)', formatoX: (v) => P.MESES[Math.round(v) - 1]?.nombre ?? '', formatoY: (v) => fmt(v, 1) },
      },
    };
  },

  bombas() {
    const esA = esBombaA();
    const d = esA ? r.bombas.acueducto : r.bombas.riego;
    const apt = esA ? r.bombas.aptitudA : r.bombas.aptitudR;
    const rec = B.tipoRecomendado(apt);
    const s = d.succion;
    const kW = (w) => w / 1000;
    const rango = d.HestMax > d.HestMin + 1e-6;
    const horas = esA ? r.horasDia : r.riego.horasAct;
    const Emes = esA ? r.costo.energia : r.riego.Emes;
    const costoMes = esA ? r.costo.costo : r.riego.costoMes;
    const nqBien = d.nq >= d.tipo.nq[0] && d.nq <= d.tipo.nq[1];
    const cargaBien = d.factorCarga >= 0.6 && d.factorCarga <= 1;
    const npshBien = s.sumergida || s.NPSHd >= 1.3 * s.NPSHr;
    const operacionBien = d.opMin.x >= 0.7 - 1e-9 && d.opMax.x <= 1.2 + 1e-9;
    const filasTipos = apt.map((a) => ({
      clase: a.id === d.tipoId ? 'elegida' : '',
      celdas: [
        { v: `${a.tipo.corto}${rec && a.id === rec.id ? ' · recomendada' : ''}`, nota: a.tipo.uso },
        a.etapas,
        fmt(a.nq, 0),
        `${fmt(a.tipo.eta[0] * 100, 0)} a ${fmt(a.tipo.eta[1] * 100, 0)} %`,
        a.apta ? { v: '✓ sirve', clase: 'bien' } : { v: '✗ no', clase: 'mal', nota: a.motivos.join('; ') },
      ],
    }));
    return {
      metricas: metricas([
        ['<b>Punto de diseño</b>', '', ''],
        ['Estación de bombeo', esA ? 'Acueducto: del río al tanque' : `Riego: del río al cultivo (${r.riego.zona.nombre.toLowerCase()})`, ''],
        ['Caudal de diseño', M.m3sAlps(d.Q), 'L/s'],
        ['Bombas', `${d.N} en paralelo${d.reserva ? ' + 1 de reserva' : ''}`, ''],
        ['Caudal por bomba', M.m3sAlps(d.qd), 'L/s'],
        ['Altura estática', esA && rango ? `${fmt(d.Hest)} (de ${fmt(d.HestMin)} a ${fmt(d.HestMax)})` : fmt(d.Hest), 'm'],
        ['Pérdidas por fricción', d.hf, 'm', '', 3],
        ['Altura dinámica de diseño', d.H, 'm'],
        ['<b>Potencias</b>', '', ''],
        ['Potencia hidráulica (útil) ρgQH', kW(d.Ph), 'kW', '', 3],
        ['Potencia al freno (en el eje) por bomba', kW(d.Pb1), 'kW', '', 3],
        ['Potencia eléctrica real por bomba', kW(d.Pe1), 'kW', '', 3],
        ['Potencia eléctrica real de la estación', kW(d.Pe), 'kW', '', 3],
        ['Motor comercial por bomba (capacidad)', `${d.motor.hp} HP = ${fmt(d.motor.kW)} kW`, ''],
        ['Margen de seguridad del motor', fmt(d.motor.margen * 100, 0), '%'],
        ['Eficiencia del motor η<sub>m</sub>', fmt(d.motor.eta * 100, 1), '%'],
        ['Factor de carga del motor', fmt(d.factorCarga * 100, 0), '%', cargaBien ? 'ok' : 'aviso'],
        ['Capacidad instalada de la estación', `${fmt(kW(d.instaladaW))} kW (${d.unidades} × ${d.motor.hp} HP)`, ''],
        ['Eficiencia global η<sub>b</sub>·η<sub>m</sub>', fmt(d.etaGlobal * 100, 1), '%'],
        ['<b>Tipo de bomba</b>', '', ''],
        ['Tipo elegido', d.tipo.nombre, ''],
        ['Etapas (rodetes en serie)', d.etapas, '', '', 0],
        ['Velocidad de giro', `${d.rpm} rpm (${d.motor.polos} polos)`, ''],
        ['Velocidad específica n<sub>q</sub>', `${fmt(d.nq, 1)} (rodete ${d.clase})`, '', nqBien ? 'ok' : 'aviso'],
        ['Tipo recomendado', rec ? rec.tipo.nombre : 'ninguno: conviene repartir el caudal o cambiar la velocidad', '', rec && rec.id === d.tipoId ? 'ok' : 'aviso'],
        ['<b>Curvas y punto de operación</b>', '', ''],
        ['Altura a válvula cerrada H<sub>0</sub>', d.curva.H0, 'm'],
        ...(rango ? [
          ['Caudal con el tanque en el arranque', M.m3sAlps(d.opMax.Q), 'L/s'],
          ['Caudal con el tanque en la parada', M.m3sAlps(d.opMin.Q), 'L/s'],
        ] : [['Caudal en el punto de operación', M.m3sAlps(d.opDis.Q), 'L/s']]),
        ['Trabaja entre (del caudal óptimo)', `${fmt(d.opMin.x * 100, 0)} % y ${fmt(d.opMax.x * 100, 0)} %`, '', operacionBien ? 'ok' : 'aviso'],
        ['<b>Succión y cavitación</b>', '', ''],
        ...(s.sumergida ? [['Instalación', `sumergida ${fmt(B.SUMERGENCIA, 1)} m bajo el agua: no hay succión`, '']] : [
          ['Altura de succión (eje sobre el agua)', s.zs, 'm', s.zs <= 6 ? 'ok' : 'aviso'],
          ['Pérdida en la succión', s.hfs, 'm', '', 3],
        ]),
        ['Presión atmosférica del sitio', s.Patm, 'kPa', '', 1],
        ['Presión de vapor del agua', s.Pv, 'kPa'],
        ['NPSH disponible', s.NPSHd, 'm', npshBien ? 'ok' : 'alerta'],
        ['NPSH requerido', s.NPSHr, 'm'],
        ['<b>Energía al mes</b>', '', ''],
        ['Horas de bombeo al día', horas, 'h', '', 1],
        ['Energía eléctrica al mes', Emes, 'kWh', '', 1],
        ['Costo de la energía al mes', costoMes, 'COP', '', 0],
      ]),
      revision: esA ? r.bombas.checksA : r.bombas.checksR,
      tablas: tablaHTML('Tipos de bomba para este punto de diseño', ['Tipo', 'Etapas', 'n<sub>q</sub>', 'η típica', '¿Sirve?'], filasTipos, {
        numericas: [1, 2],
        nota: `Para ${fmt(M.m3sAlps(d.qd))} L/s por bomba y ${fmt(d.H)} m a ${d.rpm} rpm. La fila resaltada es el tipo elegido.`,
      }),
      ecuacion: [
        ecu.tipo('Decimales: potencias de la bomba'),
        ecu.formula(`${i('P')}<sub>h</sub> = ρ${i('g')}${i('QH')},  ${i('P')}<sub>b</sub> = ${i('P')}<sub>h</sub>/η<sub>b</sub>,  ${i('P')}<sub>e</sub> = ${i('P')}<sub>b</sub>/η<sub>m</sub>`),
        ecu.sust(`${i('P')}<sub>h</sub> = 997.05 × 9.81 × ${fmt(d.Q, 5)} × ${fmt(d.H)} = ${fmt(kW(d.Ph), 3)} kW;  ${i('P')}<sub>b</sub> = ${fmt(kW(d.Ph), 3)} / ${fmt(d.etaB)} = ${fmt(kW(d.Pb), 3)} kW;  ${i('P')}<sub>e</sub> = ${fmt(kW(d.Pb), 3)} / ${fmt(d.motor.eta, 3)} = ${fmt(kW(d.Pe), 3)} kW`),
        ecu.tipo('Decimales: capacidad del motor (potencia al freno más un margen)'),
        ecu.formula(`${i('P')}<sub>motor</sub> ≥ ${i('P')}<sub>b,máx</sub>·(1 + margen)  →  tamaño comercial siguiente`),
        ecu.sust(`${fmt(d.motor.hpFreno, 2)} HP × (1 + ${fmt(d.motor.margen)}) = ${fmt(d.motor.hpMin, 2)} HP  →  motor de ${d.motor.hp} HP (${fmt(d.motor.kW)} kW);  carga = ${fmt(kW(d.Pb1), 3)} / ${fmt(d.motor.kW)} = ${fmt(d.factorCarga * 100, 0)} %`),
        ecu.nota('La potencia al freno se toma en el punto más exigente del rango de operación (P<sub>b,máx</sub>). El margen es mayor en los motores pequeños: 50 % hasta 2 HP, 30 % hasta 5 HP, 20 % hasta 10 HP, 15 % hasta 20 HP y 10 % en los mayores. 1 HP = 0.7457 kW.'),
        ecu.tipo('Decimales: velocidad específica'),
        ecu.formula(`${i('n')}<sub>q</sub> = ${i('n')}·√(${i('q')}/ojos) / (${i('H')}/etapas)<sup>0.75</sup>`),
        ecu.sust(`${i('n')}<sub>q</sub> = ${d.rpm} × √${fmt(d.qd / d.tipo.ojos, 5)} / ${fmt(d.H / d.etapas)}<sup>0.75</sup> = ${fmt(d.nq, 1)}  →  rodete ${d.clase}`),
        ecu.nota('Menos de 40: rodete radial (centrífugo); de 40 a 160: de flujo mixto; más de 160: axial, como una hélice.'),
        ecu.tipo('Ecuación cuadrática: punto de operación'),
        ecu.formula(`${i('H')}<sub>0</sub> − ${i('a')}·(${i('Q')}/${i('N')})² = ${i('H')}<sub>est</sub> + ${i('K')}·${i('Q')}²  ⇒  ${i('Q')} = √[(${i('H')}<sub>0</sub> − ${i('H')}<sub>est</sub>) / (${i('a')}/${i('N')}² + ${i('K')})]`),
        ecu.sust(`${i('H')}<sub>0</sub> = ${fmt(d.curva.H0)} m, ${i('a')} = ${fmt(d.curva.a, 0)} s²/m⁵, ${i('K')} = ${fmt(d.curva.K, 0)} s²/m⁵, ${i('N')} = ${d.N}:  con ${i('H')}<sub>est</sub> = ${fmt(d.HestMin)} m, ${i('Q')} = ${fmt(M.m3sAlps(d.opMax.Q))} L/s${rango ? `; con ${fmt(d.HestMax)} m, ${fmt(M.m3sAlps(d.opMin.Q))} L/s` : ''}`),
        ecu.tipo('Decimales: NPSH y cavitación'),
        ecu.formula(`NPSH<sub>d</sub> = (${i('P')}<sub>atm</sub> − ${i('P')}<sub>v</sub>)/(ρ${i('g')}) − ${i('z')}<sub>s</sub> − ${i('h')}<sub>fs</sub>,  NPSH<sub>r</sub> = (${i('n')}·√(${i('q')}/ojos) / ${i('S')})<sup>4/3</sup>`),
        ecu.sust(`NPSH<sub>d</sub> = (${fmt(s.Patm, 1)} − ${fmt(s.Pv)}) × 1000 / (997.05 × 9.81) − (${fmt(s.zs)}) − ${fmt(s.hfs, 3)} = ${fmt(s.NPSHd)} m;  NPSH<sub>r</sub> = (${d.rpm} × √${fmt(d.qd / d.tipo.ojos, 5)} / ${B.S_SUCCION})<sup>4/3</sup> = ${fmt(s.NPSHr)} m`),
        ecu.nota('La presión atmosférica baja con la altitud y la de vapor sube con la temperatura del agua: en la zona alta, o con agua caliente, la bomba cavita con más facilidad. Las curvas son las de una bomba escogida para que su punto óptimo coincida con el de diseño; en un proyecto real se usan las del fabricante.'),
      ].join(''),
      leyenda: rango
        ? 'Curva de la bomba y curvas del sistema con el tanque en el nivel de arranque y en el de parada. Donde se cortan está el punto de operación: al subir el tanque, la bomba entrega un poco menos.'
        : 'Curva de la bomba y curva del sistema: donde se cortan está el punto de operación.',
      grafica(g) {
        const c = paleta();
        const cv = B.curvas(d);
        actualizarGrafica(g, [
          serieLinea(d.N > 1 ? `${d.N} bombas en paralelo` : 'Curva de la bomba', cv.bomba, c.agua, { ancho: 2.5 }),
          serieLinea(rango ? 'Sistema, tanque en la parada' : 'Curva del sistema', cv.sistemaMax, c.ocre),
          ...(rango ? [serieLinea('Sistema, tanque en el arranque', cv.sistemaMin, c.ocre, { punteada: true })] : []),
          seriePuntos('Punto de diseño', [{ x: M.m3sAlps(d.Q), y: d.H }], c.alerta),
          ...(rango ? [seriePuntos('Operación', [{ x: M.m3sAlps(d.opMin.Q), y: d.opMin.H }, { x: M.m3sAlps(d.opMax.Q), y: d.opMax.H }], c.ok, 4)] : []),
        ], { x: { min: 0, max: cv.QmaxL }, y: { min: 0, max: techoRedondo(d.curva.H0 * 1.1) } });
      },
      ejes: { xTitulo: 'Caudal total (L/s)', yTitulo: 'Altura (m)', formatoX: (v) => fmt(v, 1), formatoY: (v) => fmt(v, 0) },
      extra: {
        leyenda: 'Potencia de una bomba según el caudal: al freno (en el eje) y eléctrica (la real, la que se paga). La línea horizontal es la potencia nominal del motor, su capacidad, que se mide en el eje: la potencia al freno debe quedar por debajo en todo el rango de operación.',
        grafica(g) {
          const c = paleta();
          const cv = B.curvas(d);
          const tope = Math.max(d.motor.kW, ...cv.electrica.map((x) => x.y));
          actualizarGrafica(g, [
            serieLinea('Potencia al freno', cv.freno, c.agua),
            serieLinea('Potencia eléctrica', cv.electrica, c.ocre, { ancho: 2.5 }),
            serieLinea(`Motor de ${d.motor.hp} HP (capacidad)`, [{ x: 0, y: d.motor.kW }, { x: cv.QmaxL, y: d.motor.kW }], c.alerta, { punteada: true }),
            seriePuntos('Punto de diseño', [{ x: M.m3sAlps(d.Q), y: kW(d.Pe1) }], c.ok),
          ], { x: { min: 0, max: cv.QmaxL }, y: { min: 0, max: techoRedondo(tope * 1.15) } });
        },
        ejes: { xTitulo: 'Caudal total (L/s)', yTitulo: 'Potencia por bomba (kW)', formatoX: (v) => fmt(v, 1), formatoY: (v) => fmt(v, 1) },
      },
    };
  },

  riego() {
    const rg = r.riego;
    const d = rg.dis;
    const a = rg.act;
    const e = r.especs.Riego;
    const b = r.bombas.riego;
    const z = rg.zona;
    const lluviosa = p.epoca === 'lluviosa';
    const ahora = rg.horasAct <= 0
      ? 'No hace falta regar: la lluvia cubre la necesidad'
      : (rg.regando ? `Regando (de 06:00 a ${horaTexto(rg.inicio + rg.horasAct)})` : `En espera: riega de 06:00 a ${horaTexto(rg.inicio + rg.horasAct)}`);
    const velocidadBien = rg.tubo.V >= p.Vmin && rg.tubo.V <= p.Vmax;
    const zonas = G.compararZonas(p, e);
    const metodos = G.compararMetodos(p, e);
    const ids = Object.keys(R.ZONAS);
    const marcar = ids.indexOf(p.zonaRiego) + 1;
    const tablaZonas = tablaHTML(`${d.c.nombre} con ${d.m.nombre.toLowerCase()} en cada zona (época seca)`, ['', 'Alta', 'Media', 'Baja'], [
      ['Altitud y clima', ...zonas.map((x) => `${R.miles(x.zona.elevacion)} m, ${x.zona.Tmed} °C`)],
      ['ET<sub>0</sub>', ...zonas.map((x) => `${fmt(x.n.ET0)} mm/día`)],
      ['ET<sub>c</sub>', ...zonas.map((x) => `${fmt(x.n.ETc)} mm/día`)],
      ['Lluvia efectiva', ...zonas.map((x) => `${fmt(x.n.Pe, 1)} mm/día`)],
      ['Necesidad bruta', ...zonas.map((x) => `${fmt(x.n.Nb)} mm/día`)],
      ['Caudal', ...zonas.map((x) => `${fmt(M.m3sAlps(x.n.Q))} L/s`)],
      ['Desnivel río → cultivo', ...zonas.map((x) => `${fmt(x.zona.desnivelCampo, 0)} m`)],
      ['Altura de bombeo', ...zonas.map((x) => `${fmt(x.H, 1)} m`)],
      ['Potencia eléctrica', ...zonas.map((x) => `${fmt(x.Pe / 1000)} kW`)],
      ['Energía al mes', ...zonas.map((x) => `${R.miles(x.Emes)} kWh`)],
      ['¿Se da el cultivo?', ...zonas.map((x) => (x.apto ? { v: '✓ sí', clase: 'bien' } : { v: '✗ no', clase: 'mal' }))],
    ], { numericas: [1, 2, 3], marcar, nota: 'Abajo hace más calor y llueve menos: el cultivo pide más agua, pero el río está más cerca. Arriba la bomba sube el agua más alto.' });
    const tablaMetodos = tablaHTML(`Métodos de riego para ${d.c.nombre.toLowerCase()} en la ${z.nombre.toLowerCase()}`, ['Método', 'E<sub>a</sub>', 'Presión', 'Caudal', 'kWh al mes'],
      metodos.map((m) => ({
        clase: m.id === p.metodoRiego ? 'elegida' : '',
        celdas: [
          { v: m.m.nombre, nota: m.adecuado ? 'usual para este cultivo' : 'no es usual para este cultivo', clase: m.adecuado ? '' : 'tenue' },
          `${fmt(m.m.Ea * 100, 0)} %`, `${fmt(m.m.presion, 0)} m`, `${fmt(M.m3sAlps(m.n.Q))} L/s`, R.miles(m.Emes),
        ],
      })), { numericas: [1, 2, 3, 4], nota: 'Un método más eficiente gasta menos agua; uno con más presión (aspersión) gasta más energía en la bomba.' });
    const tablaCultivos = tablaHTML('Qué se puede cultivar en cada zona', ['Cultivo', 'K<sub>c</sub>', 'Alta', 'Media', 'Baja'],
      Object.entries(G.CULTIVOS).map(([id, c]) => ({
        clase: id === p.cultivo ? 'elegida' : '',
        celdas: [
          { v: c.nombre, nota: `de ${R.miles(c.altitud[0])} a ${R.miles(c.altitud[1])} m.s.n.m.` }, fmt(c.Kc),
          ...ids.map((zid) => (G.cultivoApto(id, zid) ? { v: '✓', clase: 'bien' } : { v: '—', clase: 'tenue' })),
        ],
      })), { numericas: [1], marcar: marcar + 1, nota: 'Rango de altitud de referencia para cada cultivo. Los valores de K<sub>c</sub> son los de mitad de temporada (FAO-56).' });
    return {
      metricas: metricas([
        ['<b>Zona y cultivo</b>', '', ''],
        ['Zona', `${z.nombre}: ${z.lugar}, ${R.miles(z.elevacion)} m.s.n.m.`, ''],
        ['Temperatura media y oscilación diaria', `${z.Tmed} °C, ΔT = ${fmt(d.dT, 0)} °C`, ''],
        ['Cultivo', `${d.c.nombre}, K<sub>c</sub> = ${fmt(d.c.Kc)}`, ''],
        ['¿Se da en esta zona?', rg.apto ? 'Sí' : `No: se da de ${R.miles(d.c.altitud[0])} a ${R.miles(d.c.altitud[1])} m`, '', rg.apto ? 'ok' : 'aviso'],
        ['<b>Necesidad de agua (época seca, diseño)</b>', '', ''],
        ['Evapotranspiración de referencia ET<sub>0</sub>', d.ET0, 'mm/día'],
        ['Evapotranspiración del cultivo ET<sub>c</sub>', d.ETc, 'mm/día'],
        ['Lluvia efectiva', d.Pe, 'mm/día', '', 1],
        ['Necesidad neta', d.Nn, 'mm/día'],
        ['Método y eficiencia de aplicación', `${d.m.nombre}, E<sub>a</sub> = ${fmt(d.m.Ea * 100, 0)} %`, '', rg.adecuado ? '' : 'aviso'],
        ['Necesidad bruta', d.Nb, 'mm/día'],
        ['Volumen al día', d.Vdia, 'm³', '', 1],
        ['Caudal de diseño', M.m3sAlps(d.Q), 'L/s'],
        ['Módulo de riego', d.modulo, 'L/s por ha', '', 3],
        ['<b>Operación en la época elegida</b>', '', ''],
        ['Época', lluviosa ? 'De lluvias' : 'Seca', ''],
        ...(lluviosa ? [['Necesidad neta en lluvias', a.Nn, 'mm/día']] : []),
        ['Horas de riego al día', rg.horasAct, 'h', '', 1],
        ['Ahora', ahora, '', rg.regando ? 'ok' : ''],
        ['Volumen al mes', rg.Vmes, 'm³', '', 0],
        ['<b>Tubería y bombeo</b>', '', ''],
        ['Tubería', `${e.nombre}, ${e.dn} ${e.clase}, ${fmt(p.Lriego, 0)} m`, ''],
        ['Velocidad en la tubería', rg.tubo.V, 'm/s', velocidadBien ? 'ok' : 'aviso'],
        ['Pérdida por fricción (tubería y succión)', rg.hf, 'm', '', 3],
        ['Desnivel del río al cultivo', z.desnivelCampo, 'm', '', 1],
        ['Presión que necesita el emisor', d.m.presion, 'm.c.a.', '', 0],
        ['Altura dinámica de la bomba', rg.H, 'm'],
        ['Potencia eléctrica real', b.Pe / 1000, 'kW', '', 3],
        ['Motores instalados (capacidad)', `${b.N} × ${b.motor.hp} HP${b.reserva ? ' + 1 de reserva' : ''}`, ''],
        ['Energía eléctrica al mes', rg.Emes, 'kWh', '', 1],
        ['Costo de la energía al mes', rg.costoMes, 'COP', '', 0],
        ['<b>El campo frente a la ciudad</b>', '', ''],
        ['Agua del riego al día', `${R.miles(d.Vdia)} m³ (${fmt(rg.fraccionCiudad * 100, 0)} % del consumo de la ciudad)`, ''],
        ['Equivale al consumo de', `${R.miles(rg.viviendas)} viviendas`, ''],
        ['Caudal del río en la toma', rg.Qrio, 'm³/s'],
        ['Parte del río que se capta', fmt(rg.fraccionRio * 100, 2), '%', rg.fraccionRio <= G.FRACCION_MAX_RIO ? 'ok' : 'aviso'],
        ['<b>Calidad del agua en la toma de riego</b>', '', ''],
        ['Toma de riego', `km ${fmt(z.kmToma, 1)} del río`, ''],
        ['Coliformes fecales', R.miles(rg.agua.CF), 'NMP/100 mL', d.c.crudo ? (rg.agua.CF <= G.CF_RIEGO_CRUDO ? 'ok' : 'alerta') : ''],
        ['Nitratos', rg.agua.NO3, 'mg/L de N'],
        ['Nitrógeno que aporta el agua de riego', rg.nitrogeno, 'kg/ha al mes'],
      ]),
      revision: rg.checks,
      tablas: tablaZonas + tablaMetodos + tablaCultivos,
      ecuacion: [
        ecu.tipo('Decimales: evapotranspiración de referencia (Hargreaves)'),
        ecu.formula(`ET<sub>0</sub> = 0.0023·(${i('T')} + 17.8)·√Δ${i('T')}·${i('R')}<sub>a</sub>`),
        ecu.sust(`ET<sub>0</sub> = 0.0023 × (${z.Tmed} + 17.8) × √${fmt(d.dT, 0)} × ${G.RA} = ${fmt(d.ET0, 3)} mm/día`),
        ecu.tipo('Ecuación lineal: necesidad de agua del cultivo'),
        ecu.formula(`ET<sub>c</sub> = ${i('K')}<sub>c</sub>·ET<sub>0</sub>,  ${i('N')}<sub>n</sub> = ET<sub>c</sub> − ${i('P')}<sub>e</sub>,  ${i('N')}<sub>b</sub> = ${i('N')}<sub>n</sub> / ${i('E')}<sub>a</sub>`),
        ecu.sust(`ET<sub>c</sub> = ${fmt(d.c.Kc)} × ${fmt(d.ET0, 3)} = ${fmt(d.ETc, 3)};  ${i('N')}<sub>n</sub> = ${fmt(d.ETc, 3)} − ${fmt(d.Pe, 1)} = ${fmt(d.Nn, 3)};  ${i('N')}<sub>b</sub> = ${fmt(d.Nn, 3)} / ${fmt(d.m.Ea)} = ${fmt(d.Nb, 3)} mm/día`),
        ecu.tipo('Ecuación lineal: caudal de riego en función del área'),
        ecu.formula(`${i('Q')} = ${i('N')}<sub>b</sub>·${i('A')}·10 / (horas·3600)  (1 mm sobre 1 ha son 10 m³)`),
        ecu.sust(`${i('Q')} = ${fmt(d.Nb, 3)} × ${fmt(p.areaRiego, 1)} × 10 / (${fmt(p.horasRiego, 1)} × 3600) = ${fmt(d.Q, 5)} m³/s = ${fmt(M.m3sAlps(d.Q))} L/s`),
        ecu.tipo('Decimales: altura y potencia de la bomba de riego'),
        ecu.formula(`${i('H')} = Δ${i('z')} + ${i('p')}<sub>emisor</sub> + ${i('h')}<sub>f</sub>,  ${i('P')}<sub>e</sub> = ρ${i('g')}${i('QH')} / (η<sub>b</sub>·η<sub>m</sub>)`),
        ecu.sust(`${i('H')} = ${fmt(z.desnivelCampo, 1)} + ${fmt(d.m.presion, 0)} + ${fmt(rg.hf, 3)} = ${fmt(rg.H)} m;  ${i('P')}<sub>e</sub> = 997.05 × 9.81 × ${fmt(d.Q, 5)} × ${fmt(rg.H)} / (${fmt(p.eficienciaR)} × ${fmt(b.motor.eta, 3)}) = ${fmt(b.Pe / 1000, 3)} kW`),
        ecu.nota('Valores de referencia: K<sub>c</sub> de mitad de temporada (FAO-56), lluvia efectiva típica de cada zona y radiación media a 11° de latitud norte. En la época de lluvias el cielo nublado reduce la oscilación de temperatura y la lluvia cubre parte de la necesidad: se riega menos horas con la misma tubería y la misma bomba.'),
      ].join(''),
      leyenda: `Caudal de riego según el área cultivada, para ${d.c.nombre.toLowerCase()} con ${d.m.nombre.toLowerCase()} en las tres zonas (época seca). Cada recta pasa por el origen y su pendiente es el módulo de riego.`,
      grafica(g) {
        const c = paleta();
        const Amax = techoRedondo(Math.max(20, p.areaRiego * 1.6));
        const colores = { alta: c.ok, media: c.ocre, baja: c.agua };
        actualizarGrafica(g, [
          ...zonas.map((x) => serieLinea(x.zona.nombre, [{ x: 0, y: 0 }, { x: Amax, y: (M.m3sAlps(x.n.Q) * Amax) / p.areaRiego }], colores[x.id], { punteada: x.id !== p.zonaRiego, ancho: x.id === p.zonaRiego ? 2.5 : 1.5 })),
          seriePuntos('Diseño actual', [{ x: p.areaRiego, y: M.m3sAlps(d.Q) }], c.alerta),
        ], { x: { min: 0, max: Amax }, y: { min: 0 } });
      },
      ejes: { xTitulo: 'Área cultivada (ha)', yTitulo: 'Caudal de riego (L/s)', formatoX: (v) => fmt(v, 0), formatoY: (v) => fmt(v, 1) },
    };
  },

  huella() {
    const h = r.huella;
    const hh = h.hh;
    const d = h.d;
    const c = h.carbono;
    const cultivo = G.CULTIVOS[h.cultivo];
    const zona = R.ZONAS[h.zona];
    const suma = (x) => (x ? x.verde + x.azul + x.gris : 0);
    const ref = suma(d.ref);
    const relacion = ref ? hh.total / ref : null;
    const ids = Object.keys(R.ZONAS);
    const marcar = ids.indexOf(h.zona) + 1;
    const pct = (x) => `${fmt(100 * x, 0)} %`;
    const barra = (x) => {
      const t = Math.max(1e-9, x.verde + x.azul + x.gris);
      return `<span class="barra-hh" aria-hidden="true"><i class="v" style="width:${((100 * x.verde) / t).toFixed(1)}%"></i><i class="a" style="width:${((100 * x.azul) / t).toFixed(1)}%"></i><i class="g" style="width:${((100 * x.gris) / t).toFixed(1)}%"></i></span>`;
    };
    const tablaCultivos = tablaHTML(`Huella hídrica de cada cultivo en la ${zona.nombre.toLowerCase()} (m³/t)`, ['Cultivo', 'Verde', 'Azul', 'Gris', 'Total', 'Mundial'],
      h.porCultivo.map((x) => ({
        clase: x.id === h.cultivo ? 'elegida' : '',
        celdas: [
          { v: `${x.nombre.split(' (')[0]}${barra(x.hh)}`, nota: x.apto ? '' : 'no se da en esta zona', clase: x.apto ? '' : 'tenue' },
          R.miles(x.hh.verde), R.miles(x.hh.azul), R.miles(x.hh.gris),
          { v: R.miles(x.hh.total), clase: x.ref && x.hh.total > 1.5 * suma(x.ref) ? 'mal' : '' }, x.ref ? R.miles(suma(x.ref)) : '—',
        ],
      })), { numericas: [1, 2, 3, 4, 5], nota: 'La barra de colores muestra qué parte de la huella es verde (lluvia), azul (riego) y gris (dilución del nitrógeno). El café y el cacao rinden poco por hectárea: necesitan mucha agua por tonelada. Promedio mundial: Mekonnen y Hoekstra (2011).' });
    const tablaZonas = tablaHTML(`${cultivo.nombre} en las tres zonas`, ['', 'Alta', 'Media', 'Baja'], [
      ['Huella verde', ...h.porZona.map((x) => `${R.miles(x.hh.verde)} m³/t`)],
      ['Huella azul', ...h.porZona.map((x) => `${R.miles(x.hh.azul)} m³/t`)],
      ['Huella gris', ...h.porZona.map((x) => `${R.miles(x.hh.gris)} m³/t`)],
      ['Huella total', ...h.porZona.map((x) => `${R.miles(x.hh.total)} m³/t`)],
      ['Distancia a la ciudad', ...h.porZona.map((x) => `${x.carbono.dist} km`)],
      ['Viajes de camión al año', ...h.porZona.map((x) => R.miles(x.carbono.viajes))],
      ['CO₂ del transporte', ...h.porZona.map((x) => `${fmt(x.carbono.porTonelada, 2)} kg/t`)],
      ['Costo del carbono al año', ...h.porZona.map((x) => `$ ${R.miles(x.carbono.costo)}`)],
      ['¿Se da el cultivo?', ...h.porZona.map((x) => (x.apto ? { v: '✓ sí', clase: 'bien' } : { v: '✗ no', clase: 'mal' }))],
    ], { numericas: [1, 2, 3], marcar, nota: 'Arriba llueve más y hace menos calor: el cultivo necesita menos riego (huella azul). Pero la cosecha viaja más lejos y por vías de montaña: más CO₂ por tonelada.' });
    const tablaInundacion = tablaHTML('Cuánto aguanta cada cultivo encharcado', ['Cultivo', 'Aguanta', 'Creciente', 'Arroyo', 'CO₂ kg/t'],
      h.porCultivo.map((x) => ({
        clase: x.id === h.cultivo ? 'elegida' : '',
        celdas: [x.nombre.split(' (')[0], textoDias(H.DATOS_CULTIVO[x.id].tolerancia),
          { v: pct(x.danoRio), clase: x.danoRio > 0.005 ? 'mal' : '' }, { v: pct(x.danoArroyo), clase: x.danoArroyo > 0.005 ? 'mal' : '' }, fmt(x.carbono.porTonelada, 2)],
      })), {
        numericas: [1, 2, 3, 4],
        nota: h.zona === 'baja'
          ? `Cosecha que se pierde con el agua de ahora sobre el lote: ${fmt(h.profRio)} m de la creciente del río durante ${fmt(p.diasInundacion, 1)} días y ${fmt(h.profArroyo)} m del desborde del arroyo durante unas ${fmt(H.DIAS_ARROYO * 24, 0)} horas. El daño crece con la profundidad (completo desde ${fmt(H.PROF_DANO)} m) y con los días frente a lo que aguanta cada cultivo.`
          : 'En la zona alta y en la media el lote está en la ladera, por encima de la creciente: no se inunda. En la zona baja el lote está en la vega del río y junto al canal del arroyo.',
      });
    const relTexto = relacion !== null ? `${fmt(relacion, 2)} veces` : 'sin dato';
    return {
      metricas: metricas([
        ['<b>Cultivo</b>', '', ''],
        ['Cultivo y zona', `${cultivo.nombre} en la ${zona.nombre.toLowerCase()}`, '', G.cultivoApto(h.cultivo, h.zona) ? '' : 'aviso'],
        ['Rendimiento (promedio nacional)', d.rend, `t/ha de ${d.producto}`, '', 1],
        ['Cosechas al año', d.ciclos, '', '', 0],
        ['Evapotranspiración del ciclo ET<sub>c</sub>', hh.agua.ETc, 'mm', '', 0],
        ['· la cubre la lluvia (verde)', hh.agua.verde, 'mm', '', 0],
        ['· la cubre el riego (azul)', hh.agua.azul, 'mm', '', 0],
        ['Nitrógeno aplicado', hh.N, 'kg/ha por cosecha', '', 0],
        ['<b>Huella hídrica por tonelada</b>', '', ''],
        ['Verde: lluvia que usa el cultivo', hh.verde, 'm³/t', '', 0],
        ['Azul: riego que consume', hh.azul, 'm³/t', '', 0],
        ['Gris: agua para diluir el nitrógeno', hh.gris, 'm³/t', '', 0],
        ['Total', hh.total, 'm³/t', relacion !== null && relacion > 1.5 ? 'aviso' : 'ok', 0],
        ['Promedio mundial', ref || 'sin dato', ref ? 'm³/t' : '', '', 0],
        ['Frente al promedio mundial', relTexto, ''],
        ['<b>Agua al año</b>', '', ''],
        ['Cosecha al año', h.produccion, 't', '', 1],
        ['Agua verde (lluvia)', h.aguaAno.verde, 'm³', '', 0],
        ['Agua azul (riego que se consume)', h.aguaAno.azul, 'm³', '', 0],
        ['Agua gris (para diluir el nitrógeno)', h.aguaAno.gris, 'm³', '', 0],
        ['El agua azul frente a lo que bombea el acueducto', `${fmt((100 * h.aguaAno.azul) / Math.max(1, 12 * r.Vmes), 1)} %`, ''],
        ['<b>Huella de carbono del transporte</b>', '', ''],
        ['Distancia por carretera a la ciudad', c.dist, 'km', '', 0],
        ['Viajes de camión al año (ida y vuelta)', c.viajes, '', '', 0],
        ['ACPM al año', c.litros, 'L', '', 0],
        ['CO₂ al año', c.kgCO2, 'kg', '', 0],
        ['CO₂ por tonelada', c.porTonelada, 'kg/t'],
        ['Costo del carbono al año', c.costo, 'COP', '', 0],
        ['<b>Inundación del lote</b>', '', ''],
        ['Dónde está el lote', h.zona === 'baja' ? `En la vega del río (cota ${fmt(H.COTA_VEGA)} m) y junto al canal del arroyo` : 'En la ladera, por encima de la creciente', ''],
        ['Agua del río sobre el lote', h.profRio, 'm', h.profRio > 0 ? 'alerta' : 'ok'],
        ['Agua del arroyo sobre el lote', h.profArroyo, 'm', h.profArroyo > 0 ? 'alerta' : 'ok'],
        ['El cultivo aguanta encharcado', textoDias(d.tolerancia), ''],
        ['Cosecha perdida', 100 * h.perdida, '%', h.perdida > 0.005 ? 'alerta' : 'ok', 1],
        ['Toneladas perdidas al año', h.perdidaT, 't', '', 1],
        h.perdida >= 0.999
          ? ['Huella con la cosecha que queda', 'no queda cosecha', '', 'alerta']
          : ['Huella con la cosecha que queda', h.hhInund.total, 'm³/t', h.perdida > 0.005 ? 'aviso' : '', 0],
      ]),
      revision: h.checks,
      tablas: tablaCultivos + tablaZonas + tablaInundacion,
      ecuacion: [
        ecu.tipo('Función racional: huella verde y azul'),
        ecu.formula(`HH<sub>verde</sub> = 10·ET<sub>verde</sub>/${i('Y')},  HH<sub>azul</sub> = 10·ET<sub>azul</sub>/${i('Y')}  (1 mm sobre 1 ha son 10 m³)`),
        ecu.sust(`HH<sub>verde</sub> = 10 × ${fmt(hh.agua.verde, 1)} / ${fmt(d.rend, 1)} = ${fmt(hh.verde, 1)};  HH<sub>azul</sub> = 10 × ${fmt(hh.agua.azul, 1)} / ${fmt(d.rend, 1)} = ${fmt(hh.azul, 1)} m³/t`),
        ecu.nota('Cada día del ciclo la lluvia efectiva cubre lo que puede de la evapotranspiración del cultivo (verde); el resto lo pone el riego (azul). Lo que se pierde al regar vuelve a la cuenca y no cuenta.'),
        ecu.tipo('Ecuación lineal: huella gris (nitrógeno que se lava)'),
        ecu.formula(`HH<sub>gris</sub> = (α·${i('N')} / (${i('c')}<sub>máx</sub> − ${i('c')}<sub>nat</sub>)) / ${i('Y')}`),
        ecu.sust(`HH<sub>gris</sub> = (${H.ALFA_N} × ${fmt(hh.N, 0)} / (${H.CMAX_N} − ${H.CNAT_N}) mg/L) / ${fmt(d.rend, 1)} = ${R.miles(hh.grisHa)} m³/ha / ${fmt(d.rend, 1)} = ${fmt(hh.gris, 1)} m³/t`),
        ecu.tipo('Función escalonada: viajes y CO₂ del transporte'),
        ecu.formula(`viajes = ⌈${i('T')}/${i('C')}⌉,  ACPM = viajes·${i('d')}·(${i('c')}<sub>ida</sub> + ${i('c')}<sub>vuelta</sub>)·${i('f')},  CO₂ = ${H.FACTOR_ACPM}·ACPM,  costo = CO₂·tarifa`),
        ecu.sust(`viajes = ⌈${fmt(h.produccion, 1)} / ${fmt(p.capacidadCamion, 0)}⌉ = ${c.viajes};  ACPM = ${c.viajes} × ${c.dist} × (${H.CAMION.consumoCargado} + ${H.CAMION.consumoVacio}) × ${fmt(c.f, 2)} = ${fmt(c.litros, 1)} L;  CO₂ = ${fmt(c.kgCO2, 1)} kg;  costo = $ ${fmt(c.costo, 0)}`),
        ecu.tipo('Función por tramos: daño por inundación'),
        ecu.formula(`daño = mín(1, días/tolerancia) · mín(1, ${i('h')}/${fmt(H.PROF_DANO)}),  pérdida = 1 − (1 − daño<sub>río</sub>)·(1 − daño<sub>arroyo</sub>)`),
        ecu.formula(`${i('h')}<sub>río</sub> = ${i('z')}<sub>río</sub> − ${fmt(H.COTA_VEGA)},  ${i('h')}<sub>arroyo</sub> = (${i('Q')}<sub>exceso</sub>/(1.7·${H.L_DESBORDE}))<sup>2/3</sup> (vertedero de cresta ancha)`),
        ecu.sust(`${i('h')}<sub>río</sub> = ${fmt(h.profRio)} m (${fmt(h.dias, 1)} días);  ${i('h')}<sub>arroyo</sub> = ${fmt(h.profArroyo)} m (${fmt(H.DIAS_ARROYO * 24, 0)} h);  pérdida = 1 − (1 − ${fmt(h.danoRio, 3)}) × (1 − ${fmt(h.danoArroyo, 3)}) = ${fmt(100 * h.perdida, 1)} %`),
        ecu.nota('Fuentes: método de la huella hídrica de Hoekstra y otros (2011), promedios mundiales de Mekonnen y Hoekstra (2011), rendimientos de las Evaluaciones Agropecuarias de 2025 (UPRA, 2026, preliminares), factor de emisión del ACPM del IPCC (2006) y tarifa del impuesto al carbono de 2026 (DIAN). Los días que aguanta cada cultivo encharcado son aproximados.'),
      ].join(''),
      leyenda: `Huella hídrica de ${cultivo.nombre.toLowerCase()} según el rendimiento: con el mismo clima, la misma agua repartida en más toneladas da una huella menor (función racional, una hipérbola).`,
      grafica(g) {
        const cc = paleta();
        const Ys = Array.from({ length: 81 }, (_, k) => d.rend * (0.3 + (1.9 * k) / 80));
        const aguaHa = 10 * (hh.agua.verde + hh.agua.azul);
        const yMax = techoRedondo(Math.max(2.4 * hh.total, 1.2 * ref, hh.hhInund?.total ?? 0));
        const conPerdida = h.perdida > 0.005 && h.perdida < 0.999;
        actualizarGrafica(g, [
          serieLinea('Huella total', Ys.map((Y) => ({ x: Y, y: Math.min(yMax, (aguaHa + hh.grisHa) / Y) })), cc.agua, { ancho: 2.5 }),
          serieLinea('Verde + azul (sin la gris)', Ys.map((Y) => ({ x: Y, y: Math.min(yMax, aguaHa / Y) })), cc.ok, { punteada: true, ancho: 1.5 }),
          ...(ref ? [serieLinea(`Promedio mundial (${R.miles(ref)})`, [{ x: Ys[0], y: ref }, { x: Ys[80], y: ref }], cc.tinta2, { punteada: true, ancho: 1 })] : []),
          seriePuntos('Rendimiento nacional', [{ x: d.rend, y: hh.total }], cc.alerta),
          ...(conPerdida ? [seriePuntos('Con la cosecha que deja la inundación', [{ x: d.rend * (1 - h.perdida), y: Math.min(yMax, h.hhInund.total) }], cc.ocre)] : []),
        ], { x: { min: 0, max: Math.ceil(Ys[80]) }, y: { min: 0, max: yMax } });
      },
      ejes: { xTitulo: 'Rendimiento (t/ha por cosecha)', yTitulo: 'Huella hídrica (m³/t)', formatoX: (v) => fmt(v, v < 10 ? 1 : 0), formatoY: (v) => fmt(v, 0) },
      extra: {
        leyenda: `Cosecha que se pierde según el agua sobre el lote, con una creciente de ${fmt(p.diasInundacion, 1)} días: depende de cuánto aguanta cada cultivo encharcado. El punto es la creciente de ahora.`,
        grafica(g) {
          const cc = paleta();
          const hs = Array.from({ length: 61 }, (_, k) => (0.6 * k) / 60);
          const curva = (id, dias) => hs.map((x) => ({ x, y: 100 * H.danoInundacion(id, x, dias) }));
          const otros = ['arroz', 'palma'].filter((id) => id !== h.cultivo);
          actualizarGrafica(g, [
            serieLinea(`${cultivo.nombre.split(' (')[0]} (${textoDias(d.tolerancia)})`, curva(h.cultivo, p.diasInundacion), cc.alerta, { ancho: 2.5 }),
            ...otros.map((id, k) => serieLinea(`${G.CULTIVOS[id].nombre.split(' (')[0]} (${textoDias(H.DATOS_CULTIVO[id].tolerancia)})`, curva(id, p.diasInundacion), k ? cc.ok : cc.ocre, { punteada: true, ancho: 1.5 })),
            serieLinea(`${cultivo.nombre.split(' (')[0]} con el arroyo (${fmt(H.DIAS_ARROYO * 24, 0)} h)`, curva(h.cultivo, H.DIAS_ARROYO), cc.agua, { ancho: 1.5 }),
            seriePuntos('Creciente del río ahora', [{ x: Math.min(0.6, h.profRio), y: 100 * h.danoRio }], cc.alerta),
          ], { x: { min: 0, max: 0.6 }, y: { min: 0, max: 100 } });
        },
        ejes: { xTitulo: 'Agua sobre el lote (m)', yTitulo: 'Cosecha perdida (%)', formatoX: (v) => fmt(v, 2), formatoY: (v) => fmt(v, 0) },
      },
    };
  },

  acuifero() {
    const a = r.acuifero;
    const est = a.est;
    const v = a.vert;
    const libre = !est.tipo.capa;
    const suelo = R.SUELOS[p.sueloAcuifero] ?? R.SUELOS.arena;
    const regimen = {
      perdedor: 'El río pierde agua: recarga el acuífero',
      ganador: 'El río gana agua: el acuífero lo alimenta',
      equilibrio: 'En equilibrio: casi no hay intercambio',
    }[a.regimen];
    const via = {
      bombeo: 'Sí: el cono del pozo alcanza el río y lo atrae',
      natural: 'Sí, por el flujo natural del río al acuífero',
      ninguna: 'No: el acuífero corre hacia el río',
    }[a.via];
    const nivelCF = (cf) => (cf <= 1 ? 'ok' : 'aviso');
    const tViajeTxt = a.llega ? fmtTiempo(a.tViaje * 86400) : 'no llega';
    return {
      metricas: metricas([
        ['<b>Zona y capas del terreno</b>', '', ''],
        ['Zona del río', `${R.ZONAS[a.zona].nombre}: ${DESCRIPCION_ACUIFERO[a.zona]}`, ''],
        ...(a.zona === 'baja' ? [] : [['Terreno junto al río', `${fmt(a.terreno - R.CAUCE.fondo, 1)} m sobre el lecho`, '']]),
        [libre ? 'Zona no saturada (sobre el agua)' : 'Suelo', `${suelo.nombre}, ${fmt(est.d, 1)} m`, ''],
        ...(libre ? [] : [['Capa de arcilla (confina el acuífero)', fmt(est.e, 1), 'm']]),
        ['Acuífero', `${a.mat.nombre}, ${fmt(est.b, 1)} m`, ''],
        ['Conductividad hidráulica K', a.K, 'm/día', '', a.K < 10 ? 2 : 0],
        ['Porosidad efectiva n<sub>e</sub>', a.mat.ne, ''],
        ['Transmisividad T = K·b', a.K * est.b, 'm²/día', '', 0],
        ['<b>El río y el acuífero</b>', '', ''],
        [a.zona === 'baja' ? 'Nivel del río' : 'Nivel del río (lecho a la cota 1.00 m)', a.hRio, 'm.s.n.m.'],
        [libre ? 'Nivel freático lejos del río' : 'Nivel piezométrico lejos del río', est.nivel, 'm.s.n.m.'],
        ['Diferencia río − acuífero', a.dh, 'm'],
        ['Intercambio', regimen, '', a.regimen === 'ganador' ? 'aviso' : 'ok'],
        ['Gradiente hidráulico i', a.i, 'm/m', '', 4],
        ['Velocidad del agua subterránea', fmt(a.vNat, a.vNat < 1 ? 3 : 2), 'm/día'],
        ['Caudal por metro de orilla', fmt(a.qOrilla, 3), 'm³/día por m'],
        ['<b>Pozo de una finca</b>', '', ''],
        ['Caudal del pozo', p.Qpozo, 'L/s', '', 1],
        ['Distancia al río', a.L, 'm', '', 0],
        ['Abatimiento en el pozo', a.Q > 0 ? fmt(a.cono.s) : 'sin bombeo', a.Q > 0 ? 'm' : '', a.seco ? 'alerta' : 'ok'],
        ['Radio del cono de abatimiento', a.Q > 0 ? fmt(a.cono.R, 1) : '—', a.Q > 0 ? 'm' : ''],
        ['Nivel del agua dentro del pozo', a.Q > 0 ? (a.seco ? 'el pozo se seca' : fmt(a.nivelPozo)) : fmt(A.nivelNatural(a, a.L)), a.Q > 0 && a.seco ? '' : 'm.s.n.m.', a.seco ? 'alerta' : ''],
        ['Abatimiento bajo el río', a.sRio, 'm', '', 3],
        ['¿Llega agua del río al pozo?', via, ''],
        ['Tiempo de viaje del río al pozo', tViajeTxt, '', a.llega ? (a.tViaje >= A.DIAS_PROTECCION ? 'ok' : 'aviso') : 'ok'],
        ...(a.via === 'bombeo' ? [['Velocidad media hacia el pozo', fmt(a.vMedia, a.vMedia < 1 ? 3 : 2), 'm/día']] : []),
        ['<b>Calidad del agua</b>', '', ''],
        ['Agua del río que recarga: coliformes', R.miles(a.agua.CF), 'NMP/100 mL'],
        ['Agua del río que recarga: nitratos', a.agua.NO3, 'mg/L de N'],
        ['Pozo: coliformes fecales', a.CFpozo < 1 ? fmt(a.CFpozo, 3) : R.miles(a.CFpozo), 'NMP/100 mL', nivelCF(a.CFpozo)],
        ['Pozo: nitratos', a.NO3pozo, 'mg/L de N', a.NO3pozo <= 10 ? 'ok' : 'alerta'],
        ['<b>Infiltración desde la superficie</b>', '', ''],
        ['Velocidad de infiltración v = K/n<sub>e</sub>', fmt(v.v, v.v < 1 ? 3 : 2), 'm/día'],
        ['Tiempo para llegar al agua subterránea', fmtTiempo(v.t * 86400), ''],
        ['Coliformes que llegan', v.CF < 1 ? fmt(v.CF, 3) : R.miles(v.CF), 'NMP/100 mL', nivelCF(v.CF)],
        ['Nitratos que llegan', v.NO3, 'mg/L de N', v.NO3 <= 10 ? 'ok' : 'alerta'],
        ['Índice de vulnerabilidad GOD', `${fmt(v.god)} (${v.clase})`, '', v.god < 0.5 ? 'ok' : 'aviso'],
      ]),
      revision: a.checks,
      corte: corteAcuifero(),
      ecuacion: [
        ecu.tipo('Decimales: ley de Darcy (cuánto se mueve el agua subterránea)'),
        ecu.formula(`${i('v')} = ${i('K')}·${i('i')}/${i('n')}<sub>e</sub>,  ${i('i')} = Δ${i('h')}/${i('L')}<sub>c</sub>,  Δ${i('h')} = ${i('h')}<sub>río</sub> − ${i('h')}<sub>acuífero</sub>`),
        ecu.sust(`${i('i')} = (${fmt(a.hRio)} − ${fmt(est.nivel)}) / ${A.L_CONEXION} = ${fmt(a.dh / A.L_CONEXION, 5)};  ${i('v')} = ${fmt(a.K, a.K < 10 ? 2 : 0)} × ${fmt(a.i, 5)} / ${fmt(a.mat.ne)} = ${fmt(a.vNat, 3)} m/día`),
        ecu.nota('Si el río está más alto que el agua subterránea le entrega agua (río perdedor, común en temporada de lluvias); si está más bajo, el acuífero alimenta al río (río ganador, común en la época seca). El agua subterránea avanza metros por día, mientras el río avanza kilómetros por hora.'),
        ecu.tipo('Función logarítmica: cono de abatimiento del pozo (Thiem)'),
        ecu.formula(`${i('s')}(${i('r')}) = ${i('Q')}/(2π${i('T')})·ln(${i('R')}/${i('r')}),  ${i('T')} = ${i('K')}·${i('b')},  ${i('R')} = 3000·${i('s')}<sub>w</sub>·√${i('K')} (Sichardt, ${i('K')} en m/s)`),
        a.Q > 0
          ? ecu.sust(`${i('T')} = ${fmt(a.K / 86400, 6)} × ${fmt(est.b, 1)} = ${fmt(a.T, 5)} m²/s;  ${i('s')}<sub>w</sub> = ${fmt(a.Q, 4)} / (2π × ${fmt(a.T, 5)}) × ln(${fmt(a.cono.R, 1)} / ${A.RADIO_POZO}) = ${fmt(a.cono.s)} m`)
          : ecu.sust('Sin bombeo no hay cono: el nivel del pozo es el del acuífero.'),
        ecu.tipo('Ecuación cuadrática: tiempo de viaje del río al pozo'),
        ecu.formula(`${i('t')} = π·${i('b')}·${i('n')}<sub>e</sub>·${i('L')}² / ${i('Q')}  (si el cono alcanza el río),  ${i('t')} = ${i('L')}/${i('v')}  (solo con el flujo natural)`),
        a.via === 'bombeo'
          ? ecu.sust(`${i('t')} = π × ${fmt(est.b, 1)} × ${fmt(a.mat.ne)} × ${fmt(a.L, 0)}² / (${fmt(a.Q, 4)} × 86 400) = ${fmt(a.tHoriz, 1)} días${a.tCapa ? ` + ${fmt(a.tCapa, 1)} días para cruzar la arcilla = ${fmt(a.tViaje, 1)} días` : ''}`)
          : (a.via === 'natural'
            ? ecu.sust(`${i('t')} = ${fmt(a.L, 0)} / ${fmt(a.vNat, 3)} = ${fmt(a.tHoriz, 0)} días${a.tCapa ? ` + ${fmt(a.tCapa, 1)} (arcilla)` : ''}`)
            : ecu.sust('El agua del río no llega al pozo: el acuífero corre hacia el río y el cono no lo alcanza.')),
        ecu.nota(`Al doble de distancia, el agua tarda cuatro veces más: por eso los pozos se alejan del río. Se suele pedir que el agua tarde al menos ${A.DIAS_PROTECCION} días en llegar, para que las bacterias y los virus mueran en el camino.`),
        ecu.tipo('Decimales: infiltración desde la superficie y vulnerabilidad (GOD)'),
        ecu.formula(`${i('v')} = ${i('K')}/${i('n')}<sub>e</sub>,  ${i('t')} = ${i('d')}/${i('v')},  GOD = ${i('G')}·${i('O')}·${i('D')}`),
        ecu.sust(`${i('v')} = ${suelo.K} / ${suelo.ne} = ${fmt(v.v, v.v < 1 ? 3 : 2)} m/día;  ${i('t')} = ${fmt(v.d, 1)} / ${fmt(v.v, v.v < 1 ? 3 : 2)}${v.tipo.capa ? ' + capa de arcilla' : ''} = ${fmt(v.t, 2)} días;  GOD = ${v.G} × ${v.O} × ${v.D} = ${fmt(v.god)}`),
        ecu.nota(`En el suelo los coliformes mueren (${R.K_SUELO.coliformes} 1/día) y se filtran (${suelo.remocion} unidades logarítmicas por metro); los nitratos no se degradan. Se toma la peor agua del río en la ${R.ZONAS[a.zona].nombre.toLowerCase()}, que es la que recarga el acuífero${a.zona === 'baja' ? '' : '; en esta zona las cotas se miden desde un lecho a la cota 1.00 m, como en la bocatoma, para comparar las tres zonas'}. El radio de Sichardt es una aproximación para un pozo que lleva tiempo bombeando; en un estudio real se hace una prueba de bombeo.`),
      ].join(''),
      leyenda: 'Nivel del agua subterránea desde el río (a la izquierda) hasta más allá del pozo: sin bombear y con el pozo bombeando. El hueco alrededor del pozo es el cono de abatimiento.',
      grafica(g) {
        const c = paleta();
        const xMax = Math.max(100, Math.min(600, Math.ceil((Math.max(2.3 * a.L, a.L + 30)) / 10) * 10));
        const xs = Array.from({ length: 161 }, (_, k) => -20 + ((xMax + 20) * k) / 160);
        if (!xs.includes(a.L)) { xs.push(a.L); xs.sort((m, n) => m - n); }
        // Se muestra la parte de arriba (suelo, nivel y cono); el fondo del acuífero está en el corte
        const piso = Math.max(est.fondo, Math.floor(Math.min(a.nivelPozo, est.nivel, R.CAUCE.fondo) - 1.5));
        actualizarGrafica(g, [
          serieLinea('Terreno (zona sin agua)', xs.map((x) => ({ x, y: terrenoCorte(x) })), c.ocre, { relleno: '+1', colorRelleno: `${c.ocre}38` }),
          serieLinea('Nivel con el pozo (agua debajo)', xs.map((x) => ({ x, y: Math.max(piso, nivelCorte(a, x)) })), c.agua, { ancho: 2.5, relleno: 'start', colorRelleno: `${c.agua}2e` }),
          serieLinea('Nivel sin bombear', xs.map((x) => ({ x, y: x < 0 ? nivelCorte(a, x) : A.nivelNatural(a, x) })), c.agua, { punteada: true, ancho: 1 }),
          serieLinea('Pozo', [{ x: a.L, y: a.terreno + 0.5 }, { x: a.L, y: piso }], c.alerta, { ancho: 1.5 }),
          seriePuntos('Nivel del río', [{ x: RIO_CORTE.centro, y: a.hRio }], c.agua),
        ], { x: { min: -20, max: xMax }, y: { min: piso, max: Math.ceil(a.terreno + 1.5) } });
      },
      ejes: { xTitulo: 'Distancia desde la orilla del río (m)', yTitulo: 'Cota (m.s.n.m.)', formatoX: (x) => fmt(x, 0), formatoY: (y) => fmt(y, 1) },
      extra: {
        leyenda: a.llega
          ? `Agua del río que va llegando al pozo con el paso de los días. A los ${fmt(a.tViaje, 0)} días llega la mitad; los nitratos llegan completos y los coliformes casi no llegan porque mueren en el camino.`
          : 'Con el acuífero corriendo hacia el río y el cono lejos de él, el agua del río no llega al pozo: el pozo saca agua del acuífero.',
        grafica(g) {
          const c = paleta();
          const tMax = a.llega ? Math.max(60, Math.ceil((2.6 * a.tViaje) / 10) * 10) : 365;
          const ts = Array.from({ length: 121 }, (_, k) => (tMax * k) / 120);
          const atenuacion = a.llega ? Math.exp(-A.K_COLIFORMES_ACUIFERO * a.tViaje) * 10 ** -a.logs : 0;
          actualizarGrafica(g, [
            serieLinea('Nitratos (no se degradan)', ts.map((t) => ({ x: t, y: 100 * A.curvaLlegada(a.tViaje, t) })), c.ocre, { ancho: 2.5 }),
            serieLinea('Coliformes (mueren y se filtran)', ts.map((t) => ({ x: t, y: 100 * atenuacion * A.curvaLlegada(a.tViaje, t) })), c.alerta),
            serieLinea(`Criterio de ${A.DIAS_PROTECCION} días`, [{ x: A.DIAS_PROTECCION, y: 0 }, { x: A.DIAS_PROTECCION, y: 100 }], c.tinta2, { punteada: true, ancho: 1 }),
            ...(a.llega ? [seriePuntos('Mitad del agua del río', [{ x: a.tViaje, y: 50 }], c.agua)] : []),
          ], { x: { min: 0, max: tMax }, y: { min: 0, max: 100 } });
        },
        ejes: { xTitulo: 'Días desde que el agua del río entra al acuífero', yTitulo: 'Llega al pozo (%)', formatoX: (x) => fmt(x, 0), formatoY: (y) => fmt(y, 0) },
      },
    };
  },

  arroyo() {
    const c = r.canal;
    const kc = c.coef;
    const z = c.talud;
    const k = M.factorParedes(z);
    const R = c.A / p.perimetro;
    const uso = (p.Qcrecida / c.Qcap) * 100;
    const kChorro = M.coeficientesChorro(p.alturaCaida, Math.max(c.vCanal, 1e-9));
    const signo = (v) => (v < 0 ? '−' : '+');
    return {
      metricas: metricas([
        ['Estado', c.desborde ? 'Desborde' : `Sin desborde (${fmt(uso, 0)} %)`, '', c.desborde ? 'alerta' : (uso > 85 ? 'aviso' : 'ok')],
        ['Tirante de diseño y', fmt(c.yDiseno), 'm'],
        ['Ancho en la superficie T = b + 2zy', fmt(c.Tdiseno), 'm'],
        ['Área de flujo A(b)', fmt(c.A), 'm²'],
        ['Área máxima posible (vértice)', fmt(c.optimo.A), 'm²'],
        ['Ancho óptimo del fondo b*', fmt(c.optimo.b), 'm'],
        ['Capacidad del canal (Manning)', fmt(c.Qcap), 'm³/s'],
        ['Capacidad con la sección óptima', fmt(c.QcapOptimo), 'm³/s'],
        ['Tirante que necesita la crecida', fmt(c.yNormal), 'm', c.desborde ? 'alerta' : ''],
        ['Velocidad en el canal', fmt(c.vCanal), 'm/s'],
        ['Régimen del flujo (Re = VR/ν)', `${fmt(c.Re, 0)} (${c.regimen})`, ''],
        ['Alcance del chorro en la compuerta', fmt(c.alcanceCompuerta), 'm'],
      ]),
      ecuacion: [
        ecu.tipo('Decimales: geometría de la sección trapezoidal'),
        ecu.formula(`${i('P')} = ${i('b')} + 2${i('y')}√(1 + ${i('z')}²),  ${i('A')} = (${i('b')} + ${i('z')}${i('y')})·${i('y')},  ${i('T')} = ${i('b')} + 2${i('z')}${i('y')}`),
        ecu.sust(`${i('y')} = (${fmt(p.perimetro)} − ${fmt(p.anchoCanal)}) / (2√(1 + ${fmt(z)}²)) = ${fmt(p.perimetro - p.anchoCanal)} / ${fmt(k, 4)} = ${fmt(c.yDiseno, 4)} m`),
        ecu.sust(`${i('A')} = (${fmt(p.anchoCanal)} + ${fmt(z)} × ${fmt(c.yDiseno, 4)}) × ${fmt(c.yDiseno, 4)} = ${fmt(c.A)} m²;  ${i('T')} = ${fmt(c.Tdiseno)} m`),
        ecu.tipo('Ecuación cuadrática: área con perímetro mojado fijo'),
        ecu.formula(`${i('y')} = (${i('P')} − ${i('b')})/${i('k')}, ${i('k')} = 2√(1+${i('z')}²)  ⇒  ${i('A')}(${i('b')}) = ((${i('z')} − ${i('k')})/${i('k')}²)${i('b')}² + (${i('P')}(${i('k')} − 2${i('z')})/${i('k')}²)${i('b')} + ${i('z')}${i('P')}²/${i('k')}²`),
        ecu.sust(`${i('A')}(${i('b')}) = ${fmt(kc.a, 4)}${i('b')}² ${signo(kc.b)} ${fmt(Math.abs(kc.b), 4)}${i('b')} ${signo(kc.c)} ${fmt(Math.abs(kc.c), 4)};  ${i('A')}(${fmt(p.anchoCanal)}) = ${fmt(c.A)} m²`),
        ecu.sust(`Vértice: ${i('b')}* = −${fmt(kc.b, 4)} / (2 × (${fmt(kc.a, 4)})) = ${fmt(c.optimo.b)} m,  ${i('y')}* = ${fmt(c.optimo.y)} m,  ${i('A')}<sub>máx</sub> = ${fmt(c.optimo.A)} m²`),
        ecu.tipo('Decimales: capacidad con la ecuación de Manning'),
        ecu.formula(`${i('Q')} = (1/${i('n')}) · ${i('A')} · ${i('R')}<sup>2/3</sup> · ${i('S')}<sup>1/2</sup>,  ${i('R')} = ${i('A')}/${i('P')}`),
        ecu.sust(`${i('Q')} = (1/${fmt(p.nManning, 3)}) × ${fmt(c.A)} × ${fmt(R, 3)}<sup>2/3</sup> × ${fmt(p.pendiente, 4)}<sup>1/2</sup> = ${fmt(c.Qcap)} m³/s`),
        ecu.tipo('Decimales: régimen del flujo en el canal'),
        ecu.formula(`${i('Re')} = ρ${i('VR')} / μ,  ${i('R')} = ${i('A')} / ${i('P')}  (laminar < 500, turbulento > 2000)`),
        ecu.sust(`${i('Re')} = 997.05 × ${fmt(c.vCanal)} × ${fmt(c.Rflujo, 3)} / 0.00089 = ${fmt(c.Re, 0)} → ${c.regimen}`),
        ecu.tipo('Ecuación cuadrática: chorro bajo la compuerta'),
        c.vCanal > 0
          ? ecu.sust(`${i('y')}(${i('x')}) = ${fmt(kChorro.a, 4)}${i('x')}² + ${fmt(p.alturaCaida)};  alcance = ${fmt(c.vCanal)} × √(2 × ${fmt(p.alturaCaida)} / 9.81) = ${fmt(c.alcanceCompuerta)} m`)
          : '',
        ecu.nota(c.desborde
          ? `La crecida de ${fmt(p.Qcrecida)} m³/s supera la capacidad en ${fmt(p.Qcrecida - c.Qcap)} m³/s y el agua sale a la calle. Prueba la sección óptima, un material más liso o más perímetro.`
          : `Con el mismo perímetro de concreto, el vértice de la parábola da la sección que más agua conduce; en ella b/y = 2(√(1+z²) − z) = ${fmt(2 * (Math.sqrt(1 + z * z) - z), 3)}. Con z = 0 se recupera el canal rectangular (b = P/2).`, c.desborde),
      ].join(''),
      leyenda: 'Área de flujo según el ancho del fondo, con el perímetro mojado y el talud fijos. El vértice marca la sección óptima.',
      grafica(g) {
        const col = paleta();
        const P = p.perimetro;
        const pts = Array.from({ length: 61 }, (_, j) => {
          const b = (P * j) / 60;
          return { x: b, y: M.areaCanal(P, b, z) };
        });
        actualizarGrafica(g, [
          serieLinea('A(b)', pts, col.agua),
          seriePuntos('Vértice (óptimo)', [{ x: c.optimo.b, y: c.optimo.A }], col.ok, 5),
          seriePuntos('Ancho actual', [{ x: p.anchoCanal, y: c.A }], col.ocre, 6),
        ], { x: { min: 0, max: P }, y: { min: 0, max: Math.ceil(c.optimo.A * 1.15 * 2) / 2 } });
      },
      ejes: { xTitulo: 'Ancho del fondo b (m)', yTitulo: 'Área A (m²)', formatoX: (v) => fmt(v, 1), formatoY: (v) => fmt(v, 1) },
    };
  },
};

function pintarDiseno(f, datos) {
  if (f.revision && datos.revision) setHTML(f.revision, revisionHTML(datos.revision));
  if (f.tablas && datos.tablas) setHTML(f.tablas, datos.tablas);
  if (f.perfil && datos.perfil) setHTML(f.perfil, datos.perfil);
  if (f.corte && datos.corte) setHTML(f.corte, datos.corte);
  if (f.figura && datos.figura) {
    setHTML(f.figura, datos.figura.svg);
    const pie = f.figura.parentElement.querySelector('figcaption');
    if (pie.textContent !== datos.figura.leyenda) pie.textContent = datos.figura.leyenda;
  }
  if (datos.red) {
    setHTML(f.plano, datos.red.plano);
    setHTML(f.zanja, datos.red.zanja.svg);
    if (f.leyendaZanja.textContent !== datos.red.zanja.leyenda) f.leyendaZanja.textContent = datos.red.zanja.leyenda;
    setHTML(f.cantidades, datos.red.cantidades);
  }
}

function pintarTab(id) {
  if (id === 'datos') { pintarDatos(true); return; }
  const datos = PINTORES[id]();
  const f = fichas[id];
  setHTML(f.metricas, datos.metricas);
  setHTML(f.ecuacion, datos.ecuacion);
  pintarDiseno(f, datos);
  if (f.leyenda.textContent !== datos.leyenda) f.leyenda.textContent = datos.leyenda;
  if (!graficas[id] && window.Chart) graficas[id] = crearGrafica(f.canvas, datos.ejes);
  if (graficas[id]) datos.grafica(graficas[id]);
  pintarExtras(id, datos);
}

function pintarExtras(id, datos) {
  const f = fichas[id];
  if (datos.extra && f.canvas2) {
    if (f.leyenda2.textContent !== datos.extra.leyenda) f.leyenda2.textContent = datos.extra.leyenda;
    const k = `${id}-extra`;
    if (!graficas[k] && window.Chart) graficas[k] = crearGrafica(f.canvas2, datos.extra.ejes);
    if (graficas[k]) datos.extra.grafica(graficas[k]);
  }
  if (datos.experimento && f.exp) {
    setHTML(f.exp.metricas, datos.experimento.metricas);
    setHTML(f.exp.ecuacion, datos.experimento.ecuacion);
    if (f.exp.leyenda.textContent !== datos.experimento.leyenda) f.exp.leyenda.textContent = datos.experimento.leyenda;
    experimento?.configurar(datos.experimento.config);
  }
}

// ── Pestaña Datos: registro, escenarios y exportación a Excel ───────────────
/** Escapa texto escrito por el usuario antes de ponerlo en el HTML. */
const escaparHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Texto plano de una etiqueta con HTML: V<sub>h</sub> → V_h. */
const textoPlano = (s) => String(s)
  .replace(/<sub>(.*?)<\/sub>/g, '_$1')
  .replace(/<sup>(.*?)<\/sup>/g, '^$1')
  .replace(/<[^>]+>/g, '')
  .replace(/[\u00a0\u2009\u202f]/g, ' ')
  .trim();

/** Número de un texto formateado por fmt (espacio para miles, − y $): '4 569 170' → 4569170. */
function numeroDeTexto(texto) {
  const t = textoPlano(texto);
  const m = t.match(/^\$?\s?([−-])?(\d{1,3}(?: \d{3})+|\d+)(\.\d+)?$/);
  if (!m) return null;
  return { v: parseFloat(`${m[1] ? '-' : ''}${m[2].replace(/ /g, '')}${m[3] ?? ''}`), dec: m[3] ? m[3].length - 1 : 0 };
}

function crearFichaDatos(t, f) {
  f.innerHTML = `
    <p class="intro">${t.intro}</p>
    <div class="acciones exportar">
      <button type="button" class="boton primario" data-accion="excel">Descargar Excel (.xlsx)</button>
    </div>
    <p class="nota-datos" data-rol="estado-excel" aria-live="polite">El libro trae doce hojas: resumen, parámetros y resultados, serie de tiempo, arranques y paradas, ciclo y costo con fórmulas, revisión del diseño, cantidades de obra, perfil de calidad del río, represa y energía con fórmulas, el embalse mes a mes, la huella hídrica con fórmulas y la huella por cultivo.</p>
    <h3>Registro de la simulación</h3>
    <div class="control">
      <label for="c-intervalo">Registrar una fila cada</label>
      <select id="c-intervalo">${INTERVALOS.map((x) => `<option value="${x.valor}">${x.nombre} de tiempo simulado</option>`).join('')}</select>
    </div>
    <dl class="metricas"></dl>
    <div class="acciones"><button type="button" class="boton" data-accion="nuevo">Empezar un registro nuevo</button></div>
    <h3>Escenarios para comparar</h3>
    <p class="nota-datos">Un escenario guarda todos los parámetros y resultados de este momento. En el Excel cada escenario queda en una columna, al lado del estado al exportar.</p>
    <form class="guardar-escenario">
      <label class="sr" for="c-nombre-escenario">Nombre del escenario</label>
      <input type="text" id="c-nombre-escenario" maxlength="40" autocomplete="off" placeholder="Escenario 1">
      <button type="submit" class="boton">Guardar escenario</button>
    </form>
    <ul class="escenarios"></ul>
    <figure class="grafica"><div class="lienzo"><canvas aria-label="Gráfica del nivel registrado"></canvas></div><figcaption></figcaption></figure>
    <h3>Últimos registros</h3>
    <div class="tabla-registro"></div>`;
  elFichas.appendChild(f);
  const d = {
    raiz: f,
    metricas: f.querySelector('.metricas'),
    canvas: f.querySelector('canvas'),
    leyenda: f.querySelector('figcaption'),
    intervalo: f.querySelector('#c-intervalo'),
    estadoExcel: f.querySelector('[data-rol="estado-excel"]'),
    form: f.querySelector('form'),
    nombre: f.querySelector('#c-nombre-escenario'),
    lista: f.querySelector('.escenarios'),
    tabla: f.querySelector('.tabla-registro'),
  };
  fichas[t.id] = d;
  d.intervalo.value = String(registro.intervalo);
  d.intervalo.addEventListener('change', () => {
    registro.cambiarIntervalo(parseFloat(d.intervalo.value), sim.t);
    pintarDatos(true);
  });
  f.querySelector('[data-accion="excel"]').addEventListener('click', (e) => exportarExcel(e.currentTarget));
  f.querySelector('[data-accion="nuevo"]').addEventListener('click', () => {
    registro.reiniciar(sim.t);
    tomarMuestra();
    pintarDatos(true);
  });
  d.form.addEventListener('submit', (e) => {
    e.preventDefault();
    recalcular();
    const nombre = d.nombre.value.trim() || `Escenario ${registro.escenarios.length + 1}`;
    registro.guardarEscenario(instantanea(nombre));
    d.nombre.value = '';
    d.estadoExcel.textContent = `Se guardó «${nombre}». Aparecerá como una columna en la hoja Parámetros y resultados.`;
    pintarDatos(true);
  });
  d.lista.addEventListener('click', (e) => {
    const boton = e.target.closest('button[data-indice]');
    if (!boton) return;
    registro.quitarEscenario(Number(boton.dataset.indice));
    pintarDatos(true);
  });
}

/** Puntos del registro y de los cambios de la bomba en orden de tiempo. */
function lineaRegistrada() {
  const filas = registro.filas;
  const fin = filas.length ? filas[filas.length - 1].t : registro.inicio;
  return [
    ...filas.map((x) => ({ t: x.t, nivel: x.nivel, bomba: x.bomba })),
    // En un cambio, el estado anterior vale hasta ese instante (la franja es escalonada)
    ...registro.eventos.filter((e) => e.t >= registro.inicio && e.t <= fin).map((e) => ({ t: e.t, nivel: e.nivel, bomba: !e.bomba })),
  ].sort((a, b) => a.t - b.t);
}

function pintarDatos(conGrafica = false) {
  const f = fichas.datos;
  if (!f) return;
  const ultima = registro.filas[registro.filas.length - 1];
  setHTML(f.metricas, metricas([
    ['Filas registradas', registro.filas.length, '', '', 0],
    ['Desde', relojSimulado(registro.inicio).texto, ''],
    ['Hasta', ultima ? relojSimulado(ultima.t).texto : '—', ''],
    ['Arranques y paradas de la bomba', registro.eventos.length, '', '', 0],
    ['Horas con la bomba encendida', registro.segundosBomba / 3600, 'h'],
    ['Energía consumida en el registro', registro.energia, 'kWh'],
    ['Costo de esa energía (sin cargo fijo)', registro.energia * p.tarifaKWh, 'COP', '', 0],
  ]));
  setHTML(f.lista, registro.escenarios.length
    ? registro.escenarios.map((e, k) => `<li><span class="nombre">${escaparHTML(e.nombre)}</span>`
      + `<span class="detalle">${escaparHTML(e.momento)}${e.detalle ? ` · ${escaparHTML(e.detalle)}` : ''}</span>`
      + `<button type="button" class="quitar" data-indice="${k}" aria-label="Quitar ${escaparHTML(e.nombre)}" title="Quitar">×</button></li>`).join('')
    : '<li class="vacia">Todavía no hay escenarios guardados.</li>');
  const ultimas = registro.filas.slice(-6).reverse();
  setHTML(f.tabla, ultimas.length
    ? `<table><thead><tr><th>Momento</th><th>Nivel (m)</th><th>Bomba</th><th>Grifo (m.c.a.)</th></tr></thead><tbody>${ultimas.map((x) => `<tr><td>${relojSimulado(x.t).texto}</td><td>${fmt(x.nivel)}</td><td>${x.bomba ? 'Encendida' : 'Apagada'}</td><td>${fmt(x.Hcasa)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="nota-datos">Aún no hay registros: deja correr el reloj de la simulación.</p>');
  f.nombre.placeholder = `Escenario ${registro.escenarios.length + 1}`;
  if (String(registro.intervalo) !== f.intervalo.value) f.intervalo.value = String(registro.intervalo);
  const leyenda = 'Nivel del tanque registrado desde el inicio del registro; la franja inferior indica cuándo estuvo encendida la bomba.';
  if (f.leyenda.textContent !== leyenda) f.leyenda.textContent = leyenda;
  if (!conGrafica) return;
  if (!graficas.datos && window.Chart) {
    graficas.datos = crearGrafica(f.canvas, { xTitulo: 'Horas desde el inicio del registro', yTitulo: 'Nivel (m)', formatoX: (v) => fmt(v, 1), formatoY: (v) => fmt(v, 1) });
  }
  if (!graficas.datos) return;
  const c = paleta();
  const t0 = registro.inicio;
  const puntos = lineaRegistrada();
  actualizarGrafica(graficas.datos, [
    serieLinea('Nivel registrado', puntos.map((x) => ({ x: (x.t - t0) / 3600, y: x.nivel })), c.agua),
    serieLinea('Bomba encendida', puntos.map((x) => ({ x: (x.t - t0) / 3600, y: x.bomba ? 0.25 : 0 })), c.ok, { ancho: 1.5, escalon: true, relleno: 'origin', colorRelleno: `${c.ok}55` }),
  ], { x: { min: 0, max: techoRedondo(Math.max(1, registro.horasRegistradas)) }, y: { min: 0, max: Math.ceil(p.hMax + 0.5) } });
}

/** Fila de la serie de tiempo con el estado actual de la simulación. */
function filaSerie() {
  return {
    t: sim.t,
    nivel: sim.nivel,
    volumen: r.volumen,
    llenado: (sim.nivel / p.hMax) * 100,
    bomba: sim.bomba,
    Qin: M.m3sAlps(r.Qin),
    factor: r.factor,
    Qsal: M.m3sAlps(r.Qsal),
    Hb: r.alturaBombeo,
    potencia: sim.bomba ? r.potencia / 1000 : 0,
    presionRed: r.red.presionMin,
    casa: r.casa.id,
    Hcasa: r.Hcasa,
    estado: r.casa.cerrada ? `Ramal ${r.casa.j} cerrado` : ESTADOS_SERVICIO[r.estado],
    horasBomba: registro.segundosBomba / 3600,
    energia: registro.energia,
    costoEnergia: registro.energia * p.tarifaKWh,
    usoCanal: (p.Qcrecida / r.canal.Qcap) * 100,
  };
}

function tomarMuestra() {
  recalcular();
  registro.agregarFila(filaSerie());
}

/** Parámetros fijos del modelo que no tienen control en el panel. */
const CONSTANTES = [
  ['cotaTanque', 'Cota del fondo del tanque', 'm.s.n.m.', 2, (q) => q.cotaTanque],
  ['cotaCasa', 'Cota de la entrada del barrio', 'm.s.n.m.', 2, (q) => q.cotaCasa],
  ['K0', 'Coeficiente de pérdida de la llave abierta K₀', '', 1, (q) => q.K0],
  ['dBoquilla', 'Diámetro de la boquilla del grifo', 'mm', 1, (q) => q.dBoquilla * 1000],
  ['medidorQmax', 'Caudal máximo del medidor', 'm³/h', 1, (q) => q.medidorQmax],
  ['Kllave', 'Coeficiente de la llave de paso', '', 2, (q) => q.Kllave],
  ['VmaxSuccion', 'Velocidad máxima en la succión', 'm/s', 2, (q) => q.VmaxSuccion],
  ['arranquesMax', 'Arranques por hora admisibles', '1/h', 0, (q) => q.arranquesMax],
  ['cauceAncho', 'Ancho del cauce del río en la bocatoma', 'm', 1, () => R.CAUCE.ancho],
  ['cauceN', 'Coeficiente de Manning del cauce', '', 3, () => R.CAUCE.n],
  ['caucePendiente', 'Pendiente del cauce en la zona baja', 'm/m', 4, () => R.CAUCE.pendiente],
  ['cauceFondo', 'Cota del fondo del cauce en la bocatoma', 'm.s.n.m.', 2, () => R.CAUCE.fondo],
  ['rejilla', 'Cota del fondo de la rejilla de la bocatoma', 'm.s.n.m.', 2, () => R.REJILLA.fondo],
  ['kd20', 'Constante de la DBO a 20 °C, k_d', '1/día', 2, () => R.K20.kd],
  ['kb20', 'Muerte de coliformes a 20 °C, k_b', '1/día', 2, () => R.K20.kb],
  ['Ssuccion', 'Velocidad específica de succión de referencia S', '', 0, () => B.S_SUCCION],
  ['Ra', 'Radiación extraterrestre media (11° N)', 'mm/día', 1, () => G.RA],
  ['cotaLlanura', 'Cota de la llanura junto al río', 'm.s.n.m.', 2, () => A.COTA_LLANURA],
  ['Lconexion', 'Distancia en la que el nivel freático se une al río', 'm', 0, () => A.L_CONEXION],
  ['radioPozo', 'Radio del pozo', 'm', 2, () => A.RADIO_POZO],
  ['kAcuifero', 'Muerte de coliformes en el agua subterránea', '1/día', 2, () => A.K_COLIFORMES_ACUIFERO],
  ['presaKm', 'Sitio de la presa (km del río)', 'km', 0, () => P.PRESA.km],
  ['presaLecho', 'Cota del lecho del río en la presa', 'm.s.n.m.', 0, () => P.PRESA.cotaLecho],
  ['aValle', 'Coeficiente del valle del embalse a (V = a·h²)', 'm³/m²', 0, () => P.PRESA.aValle],
  ['kForzada', 'Pérdida de la tubería forzada k (h = k·Q²)', 's²/m⁵', 2, () => P.PRESA.kForzada],
  ['Lciudad', 'Longitud de la línea y de la tubería hasta la ciudad', 'km', 0, () => P.PRESA.distanciaCiudad],
  ['rLinea', 'Resistencia del conductor de la línea', 'Ω/km', 2, () => P.PRESA.rLinea],
  ['fp', 'Factor de potencia de la línea', '', 2, () => P.PRESA.fp],
  ['consumoVivienda', 'Consumo de subsistencia de una vivienda', 'kWh/mes', 0, () => P.PRESA.consumoVivienda],
  ['cotaVega', 'Cota de la vega del lote de la zona baja', 'm.s.n.m.', 2, () => H.COTA_VEGA],
  ['alfaN', 'Fracción del nitrógeno que se lava α', '', 2, () => H.ALFA_N],
  ['cmaxN', 'Concentración máxima de nitratos (como N)', 'mg/L', 1, () => H.CMAX_N],
  ['factorACPM', 'Factor de emisión del ACPM', 'kg CO₂/L', 2, () => H.FACTOR_ACPM],
  ['rho', 'Densidad del agua ρ (25 °C)', 'kg/m³', 2, () => M.RHO],
  ['mu', 'Viscosidad del agua μ (25 °C)', 'Pa·s', 5, () => M.MU],
  ['g', 'Gravedad g', 'm/s²', 2, () => M.G],
];

/** Agrega a la instantánea las filas de una pestaña; las filas <b>…</b> abren un grupo. */
function agregarResultados(salida, nombreTab, filasTab, grupoFijo = null) {
  let grupo = grupoFijo ?? nombreTab;
  for (const [dt, valor, unidad = '', , dec = 2] of filasTab) {
    const etiqueta = textoPlano(dt);
    if (valor === '' && /^<b>/.test(dt)) {
      if (!grupoFijo) grupo = `${nombreTab} · ${etiqueta}`;
      continue;
    }
    let v = valor;
    let d = dec;
    if (typeof valor !== 'number') {
      const n = numeroDeTexto(valor);
      if (n) ({ v, dec: d } = n);
      else v = textoPlano(valor);
    }
    salida.push({ clave: `r|${grupo}|${etiqueta}`, bloque: 'Resultados', grupo, etiqueta, unidad: textoPlano(unidad), valor: v, dec: d });
  }
}

/** Todos los parámetros y resultados de este momento (un escenario o el estado al exportar). */
function instantanea(nombre) {
  const filas = [];
  const vistos = new Set();
  let grupo = '';
  const agregar = (clave, tab, g, etiqueta, unidad, valor, dec) => {
    filas.push({ clave: `p|${clave}`, bloque: 'Parámetros', grupo: `${tab} · ${g}`, etiqueta, unidad, valor, dec });
  };
  for (const c of CONTROLES) {
    if (c.grupo) { grupo = c.grupo; continue; }
    if (c.accion) continue;
    const id = c.clave ?? c.tubo ?? c.id;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const tab = TABS.find((x) => x.id === c.tab).nombre;
    const g = c.contenedor === 'experimento' ? 'Experimento de Reynolds' : grupo;
    if (c.tipo === 'tubo') {
      const e = r.especs[c.tubo];
      agregar(`${id}-material`, tab, g, `${c.etiqueta}: material`, '', D.MATERIALES[p[`mat${c.tubo}`]].nombre);
      agregar(`${id}-dn`, tab, g, `${c.etiqueta}: diámetro nominal`, '', e.dn);
      agregar(`${id}-clase`, tab, g, `${c.etiqueta}: clase de presión`, '', e.clase);
      agregar(`${id}-di`, tab, g, `${c.etiqueta}: diámetro interno`, 'mm', e.DI * 1000, 1);
      continue;
    }
    let valor;
    if (c.tipo === 'material') valor = MATERIALES.find((m) => m.n === p.nManning)?.nombre ?? String(p.nManning);
    else if (c.tipo === 'opciones') {
      const opciones = typeof c.opciones === 'function' ? c.opciones() : c.opciones;
      valor = opciones.find((o) => String(o.valor) === String(p[c.clave]))?.nombre ?? String(p[c.clave]);
    } else if (c.tipo === 'casilla') valor = p[c.clave] ? 'Sí' : 'No';
    else valor = leerControl(c);
    agregar(id, tab, g, c.etiqueta, c.unidad ?? '', valor, c.dec);
  }
  for (const [clave, etiqueta, unidad, dec, valor] of CONSTANTES) {
    filas.push({ clave: `p|${clave}`, bloque: 'Parámetros', grupo: 'Constantes del modelo', etiqueta, unidad, valor: valor(p), dec });
  }
  for (const t of TABS) {
    if (!PINTORES[t.id]) continue;
    captura = [];
    try {
      PINTORES[t.id]();
    } finally {
      const capturadas = captura;
      captura = null;
      agregarResultados(filas, t.nombre, capturadas[0] ?? []);
      if (capturadas[1]) agregarResultados(filas, t.nombre, capturadas[1], `${t.nombre} · Experimento de Reynolds`);
    }
  }
  return {
    nombre,
    momento: relojSimulado(sim.t).texto,
    detalle: `Q bombeo ${fmt(p.Qbombeo)} L/s · grifo ${fmt(r.Hcasa)} m.c.a. · $\u00a0${fmt(r.costo.costo, 0)} al mes`,
    filas,
  };
}

async function exportarExcel(boton) {
  const estado = fichas.datos.estadoExcel;
  boton.disabled = true;
  estado.textContent = 'Preparando el libro de Excel…';
  try {
    // Se deja pintar el aviso antes de armar el libro (es un cálculo síncrono)
    await new Promise((listo) => setTimeout(listo, 30));
    recalcular();
    const ahora = new Date();
    const ci = r.ciclo;
    const c = r.canal;
    const cumplen = r.revisionTotal.filter((x) => x.nivel === 'ok').length;
    const cal = r.rio.calidad;
    const bA = r.bombas.acueducto;
    const rg = r.riego;
    const bytes = crearLibro({
      meta: {
        fecha: ahora.toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' }),
        fechaObjeto: ahora,
        reloj: relojSimulado(sim.t).texto,
      },
      resumen: [
        ['Estado del servicio en la vivienda de análisis', r.casa.cerrada ? `Ramal ${r.casa.j} cerrado` : ESTADOS_SERVICIO[r.estado]],
        ['Vivienda de análisis', `Ramal ${r.casa.id.replace('-', ', vivienda ')}`],
        ['Carga disponible en el grifo', r.Hcasa, 'm.c.a.'],
        ['Presión mínima en la red (diseño, hora pico)', r.redDiseno.presionMin, 'm.c.a.'],
        ['Nivel del tanque', sim.nivel, 'm'],
        ['Bomba', r.bomba ? `Encendida${p.controlBomba === 'automatico' ? ` (se apaga a ${fmt(p.nivelParada)} m)` : ''}` : `Apagada (arranca a ${fmt(p.nivelArranque)} m)`],
        ['Horas de bombeo al día', r.horasDia, 'h'],
        ['Costo mensual de bombeo', r.costo.costo, 'COP'],
        ['Bomba del acueducto', `${bA.N} × ${bA.motor.hp} HP${bA.reserva ? ' + 1 de reserva' : ''}, ${B.TIPOS_BOMBA[bA.tipoId].corto.toLowerCase()}`],
        ['Potencia eléctrica real al bombear', r.potenciaElectrica / 1000, 'kW'],
        ['Criterios de diseño que se cumplen', `${cumplen} de ${r.revisionTotal.length}`],
        ['Río en la bocatoma', `cota ${fmt(cotaEf())} m, ${fmt(r.rio.boc.Q)} m³/s, ${R.miles(p.sedimento)} mg/L de sedimento`],
        ['Coliformes fecales en la bocatoma', Math.round(cal.bocatoma.CF), 'NMP/100 mL', 0],
        ['Oxígeno disuelto mínimo del río', cal.odMin.od, 'mg/L'],
        ['Vertimiento', cal.inicio ? `${cal.tipo.nombre}, ${fmt(p.Qvert, 1)} L/s, ${R.PUNTOS_VERTIMIENTO[p.vertZona].toLowerCase()}` : cal.tipo.nombre],
        ['Riego', `${fmt(p.areaRiego, 1)} ha de ${rg.dis.c.nombre.toLowerCase()} en la ${rg.zona.nombre.toLowerCase()}, ${rg.dis.m.nombre.toLowerCase()}: ${fmt(M.m3sAlps(rg.dis.Q))} L/s`],
        ['Río y acuífero', { perdedor: 'el río recarga el acuífero', ganador: 'el acuífero alimenta al río', equilibrio: 'en equilibrio' }[r.acuifero.regimen]],
        ['Pozo de la finca', r.acuifero.Q > 0 ? `${fmt(p.Qpozo, 1)} L/s a ${fmt(p.distanciaPozo, 0)} m del río: abatimiento ${fmt(r.acuifero.cono.s)} m; el agua del río ${r.acuifero.llega ? `llega en ${fmt(r.acuifero.tViaje, 1)} días` : 'no llega'}` : 'sin bombear'],
        ['Arroyo', c.desborde ? `Desborde: faltan ${fmt(p.Qcrecida - c.Qcap)} m³/s` : `Sin desborde (${fmt((p.Qcrecida / c.Qcap) * 100, 0)} % de la capacidad)`],
        ['Represa', `${P.OPERACIONES[p.operacionPresa]}: embalse a ${fmt(r.represa.nivel)} m, central de ${fmt(r.represa.P / 1000, 1)} kW, ${R.miles(r.represa.Eent)} kWh al mes en la ciudad`],
        ['Costo del kWh de la represa puesto en la ciudad', Number.isFinite(r.represa.costoPuesto) ? r.represa.costoPuesto : 'sin energía', 'COP/kWh'],
        ['Huella hídrica del cultivo', `${R.miles(r.huella.hh.total)} m³/t (verde ${R.miles(r.huella.hh.verde)}, azul ${R.miles(r.huella.hh.azul)}, gris ${R.miles(r.huella.hh.gris)})`],
        ['CO₂ de llevar la cosecha a la ciudad', r.huella.carbono.kgCO2, 'kg al año', 0],
        ['Cosecha perdida por inundación', 100 * r.huella.perdida, '%', 1],
      ],
      actual: instantanea('Al exportar'),
      registro,
      ciclo: {
        automatico: p.controlBomba === 'automatico', alcanza: r.alcanza,
        Dtanque: p.Dtanque, hA: p.nivelArranque, hP: p.nivelParada, Qb: lps(p.Qbombeo), Qs: lps(p.Qdemanda),
        cotaRio: cotaEf(), cotaTanque: p.cotaTanque, hf: r.hfBombeo, eficiencia: p.eficiencia,
        tarifa: p.tarifaKWh, cargoFijo: p.cargoFijo, At: r.At, dV: ci.dV,
        tEnc: ci.tLlenado, tApag: ci.tVaciado, ciclo: ci.ciclo, horasDia: r.horasDia, arranquesHora: ci.arranquesHora,
        nivelMedio: r.nivelMedio, Hmedia: r.Hmedia, Vmes: r.Vmes, m: r.costo.m, energia: r.costo.energia, costo: r.costo.costo,
        etaMotor: r.etaMotor, motorHP: bA.motor.hp, capta: r.capta,
      },
      revision: r.revisionTotal.map((x) => ({ area: x.area, texto: textoPlano(x.texto), nivel: x.nivel, detalle: textoPlano(x.detalle) })),
      cantidades: r.cantidades.filas,
      represa: libroRepresa(p, r),
      ano: libroAno(p, r),
      huella: libroHuella(p, r),
      cultivos: libroCultivos(p, r),
      perfil: {
        puntos: cal.puntos.map((x) => ({ ...x, zonaNombre: R.ZONAS[x.zona].nombre.replace('Zona ', '') })),
        marcas: [
          ...(cal.inicio ? [{ km: cal.kmV, texto: `Vertimiento: ${cal.tipo.nombre.toLowerCase()}, ${fmt(p.Qvert, 1)} L/s` }] : []),
          { km: R.KM_BOCATOMA, texto: 'Bocatoma de la ciudad' },
          { km: R.ZONAS[p.zonaRiego].kmToma, texto: `Toma de riego (${R.ZONAS[p.zonaRiego].nombre.toLowerCase()})` },
          { km: cal.odMin.km, texto: 'Oxígeno disuelto mínimo' },
          { km: 15, texto: 'Empieza la zona media' },
          { km: 35, texto: 'Empieza la zona baja' },
          { km: R.KM_DESEMBOCADURA, texto: 'Desembocadura en el mar' },
        ],
        nota: `Calidad del agua cada 0.5 km del nacimiento (km 0) a la desembocadura (km 50), con el río en la cota ${fmt(cotaEf())} m (${fmt(r.rio.boc.Q)} m³/s en la bocatoma) y el vertimiento del momento de exportar.`,
      },
    });
    const nombre = nombreArchivo(ahora);
    descargarArchivo(bytes, nombre);
    estado.textContent = `Listo: se descargó ${nombre} (${registro.filas.length} filas de la serie de tiempo, ${registro.escenarios.length} escenarios).`;
  } catch (e) {
    console.error(e);
    estado.textContent = 'No se pudo crear el archivo de Excel. Revisa la consola del navegador.';
  } finally {
    boton.disabled = false;
  }
}

/**
 * Avanza el tanque con el control de la bomba: guarda los arranques y paradas con su
 * instante exacto y suma la energía del tramo.
 */
function avanzarTanque(segundos) {
  const st = D.avanzarTanque(p, sim, segundos);
  for (const e of st.eventos) {
    const causa = e.bomba ? `el nivel bajó al arranque (${fmt(p.nivelArranque)} m)` : `el nivel subió a la parada (${fmt(p.nivelParada)} m)`;
    registro.agregarEvento(e.t, e.nivel, e.bomba, causa);
  }
  registro.acumular(D.energiaTramo(p, st.tBomba, st.areaNivel, r.hfBombeo, r.etaMotor), st.tBomba);
  sim.nivel = st.nivel;
  sim.bomba = st.bomba;
  sim.arranques += st.arranques;
  // Embalse: dh/dt = (Q_entra − Q_sale)/A con el caudal del último cálculo
  const rep = r.represa;
  if (rep.pendienteNivel !== 0) {
    const h0 = sim.nivelEmbalse;
    let h1 = h0 + rep.pendienteNivel * segundos;
    if (h0 >= rep.hMin - 1e-9 && h1 < rep.hMin) h1 = rep.hMin;     // en el mínimo suelta solo lo que entra
    sim.nivelEmbalse = limitar(h1, 0, rep.hMax);
  }
}

/** Avanza el tiempo simulado; corta el paso en cada marca del registro para tomar la muestra exacta. */
function pasoSimulacion(segundos) {
  const fin = sim.t + segundos;
  for (let k = 0; k < 2000 && sim.t < fin - 1e-9; k++) {
    if (registro.proxima <= sim.t + 1e-6) { tomarMuestra(); continue; }
    const hasta = Math.min(fin, registro.proxima);
    avanzarTanque(hasta - sim.t);
    sim.t = hasta;
  }
  if (registro.proxima <= sim.t + 1e-6) tomarMuestra();
}

function pintarEstados() {
  const acu = document.getElementById('estadoAcueducto');
  const arr = document.getElementById('estadoArroyo');
  const textos = {
    normal: [`Acueducto: la vivienda recibe ${fmt(r.Hcasa)} m.c.a.`, 'ok'],
    'baja-presion': [`Presión baja en la vivienda: ${fmt(r.Hcasa)} m.c.a. (referencia ${fmt(p.presionMinima, 1)})`, 'aviso'],
    deficit: [`Tanque vacío: el sector recibe ${fmt(M.m3sAlps(r.Qsal))} de ${fmt(p.Qdemanda)} L/s`, 'alerta'],
    'sin-agua': ['No llega agua al grifo: las pérdidas superan la carga disponible', 'alerta'],
  };
  let [ta, na] = textos[r.estado];
  if (r.casa.cerrada) [ta, na] = [`Ramal ${r.casa.j} cerrado: la vivienda de análisis no recibe agua`, 'alerta'];
  const bom = document.getElementById('estadoBomba');
  let tb0 = r.bomba
    ? `Bomba encendida: ${fmt(p.Qbombeo)} L/s${p.controlBomba === 'automatico' ? ` (se apaga a ${fmt(p.nivelParada)} m)` : ''}`
    : `Bomba apagada (arranca a ${fmt(p.nivelArranque)} m)`;
  if (!r.capta) tb0 = `Bomba detenida: el río (cota ${fmt(cotaEf())} m) no alcanza la rejilla`;
  if (bom) {
    const sp = bom.querySelector('.texto');
    if (sp.textContent !== tb0) sp.textContent = tb0;
    bom.dataset.nivel = r.bomba ? 'ok' : (r.capta ? 'aviso' : 'alerta');
  }
  const rio = document.getElementById('estadoRio');
  if (rio) {
    const cal = r.rio.calidad;
    let [tr, nr] = [`Río: ${fmt(r.rio.boc.Q)} m³/s en la bocatoma, agua apta para potabilizar`, 'ok'];
    if (cal.bocatoma.CF > p.cfMax) [tr, nr] = [`Río contaminado: ${R.miles(cal.bocatoma.CF)} coliformes/100 mL en la bocatoma`, 'alerta'];
    else if (cal.odMin.od < p.odMin) [tr, nr] = [`Río sin oxígeno suficiente: ${fmt(cal.odMin.od, 1)} mg/L en el km ${fmt(cal.odMin.km, 1)}`, 'alerta'];
    else if (r.rio.sed.Cpasa > 500) [tr, nr] = [`Río turbio: ${R.miles(p.sedimento)} mg/L de sedimento`, 'aviso'];
    if (!r.capta) [tr, nr] = [`Río bajo: cota ${fmt(cotaEf())} m, la bocatoma no capta`, 'alerta'];
    else if (r.huella.loteBaja.profRio > 0) [tr, nr] = [`Creciente: el río se sale a la vega con ${fmt(r.huella.loteBaja.profRio)} m de agua sobre el cultivo`, 'alerta'];
    else if (Math.abs(r.represa.dQ) > 0.005 && nr === 'ok') tr = `Río: ${fmt(r.rio.boc.Q)} m³/s en la bocatoma (la represa ${r.represa.dQ > 0 ? 'suelta' : 'guarda'} ${fmt(Math.abs(r.represa.dQ))} m³/s)`;
    const sp = rio.querySelector('.texto');
    if (sp.textContent !== tr) sp.textContent = tr;
    rio.dataset.nivel = nr;
  }
  const c = r.canal;
  const uso = (p.Qcrecida / c.Qcap) * 100;
  const [tb, nb] = c.desborde
    ? [`El arroyo se desborda: faltan ${fmt(p.Qcrecida - c.Qcap)} m³/s de capacidad${r.huella.loteBaja.profArroyo > 0 ? ' y el agua cubre el cultivo' : ''}`, 'alerta']
    : [`Arroyo: el canal va al ${fmt(uso, 0)} % de su capacidad`, uso > 85 ? 'aviso' : 'ok'];
  for (const [el, t, n] of [[acu, ta, na], [arr, tb, nb]]) {
    const span = el.querySelector('.texto');
    if (span.textContent !== t) span.textContent = t;
    el.dataset.nivel = n;
  }
  const hayAlerta = (lista) => lista.some((x) => x.nivel === 'alerta');
  const alertas = { vivienda: r.estado !== 'normal' || r.casa.cerrada, tanque: r.vacio, arroyo: c.desborde,
    rio: hayAlerta(r.rio.checks), captacion: !r.capta,
    bombas: hayAlerta(r.bombas.checksA) || hayAlerta(r.bombas.checksR), riego: hayAlerta(r.riego.checks),
    acuifero: hayAlerta(r.acuifero.checks), represa: hayAlerta(r.represa.checks), huella: hayAlerta(r.huella.checks),
    red: r.checks.some((x) => x.nivel === 'alerta' && /Red|Acometida/.test(x.texto)),
    tuberias: r.checks.some((x) => x.nivel === 'alerta' && /Aducción|Conducción/.test(x.texto)) };
  for (const t of TABS) {
    document.querySelector(`#pestana-${t.id} .alerta-mini`).hidden = !alertas[t.id];
  }
}

function pintarReloj() {
  const total = Math.floor(sim.t / 60);
  const dia = Math.floor(total / 1440) + 1;
  const hh = String(Math.floor((total % 1440) / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  const txt = `Día ${dia}, ${hh}:${mm}`;
  const el = document.getElementById('reloj');
  if (el.textContent !== txt) el.textContent = txt;
}

function pintarPanel() {
  pintarTab(tabActiva);
  pintarEstados();
  pintarReloj();
}

function mostrarTab(id) {
  tabActiva = id;
  for (const t of TABS) {
    const activa = t.id === id;
    const b = document.getElementById(`pestana-${t.id}`);
    b.setAttribute('aria-selected', String(activa));
    b.tabIndex = activa ? 0 : -1;
    fichas[t.id].raiz.hidden = !activa;
  }
  escena?.seleccionar(id);
  pintarTab(id);
  experimento?.activar(id === 'tuberias');
}

function elegirCasa(id) {
  p.casaAnalisis = id;
  cambio();
}

function eventosPlano() {
  const el = fichas.red?.plano;
  if (!el) return;
  const elegir = (ev) => {
    const g = ev.target.closest('[data-casa]');
    if (g) elegirCasa(g.dataset.casa);
  };
  el.addEventListener('click', elegir);
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegir(ev); } });
}

function seleccionDesdeEscena(id) {
  mostrarTab(id);
  // En móvil el panel queda debajo de la vista 3D: se lleva a la pantalla
  if (window.matchMedia('(max-width: 900px)').matches) {
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('pestanas').scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' });
  }
}

// ── Reloj de simulación ─────────────────────────────────────────────────
function controlesTiempo() {
  const btn = document.getElementById('btnPlay');
  btn.addEventListener('click', () => {
    sim.corriendo = !sim.corriendo;
    btn.textContent = sim.corriendo ? 'Pausar' : 'Reanudar';
    btn.setAttribute('aria-pressed', String(sim.corriendo));
    // Mientras corre, el panel se repinta cada 250 ms; al pausar se pinta el
    // estado exacto (a 6 h por segundo, 250 ms son hora y media simulada).
    if (!sim.corriendo) pintarPanel();
  });
  const sel = document.getElementById('selVelocidad');
  sel.addEventListener('change', () => { sim.factor = parseFloat(sel.value); });
  document.getElementById('btnReiniciar').addEventListener('click', () => {
    Object.assign(p, M.PARAMETROS_INICIALES, S.PARAMETROS_DISENO);
    sim.nivel = NIVEL_INICIAL;
    sim.nivelEmbalse = p.nivelEmbalse;
    sim.t = HORA_INICIAL;
    sim.bomba = true;
    sim.arranques = 0;
    registro.reiniciar(HORA_INICIAL);
    cambio();
    tomarMuestra();
  });
}

let ultimo = performance.now();
let ultimoPanel = 0;
let ultimaGrafica = 0;
function bucle(ahora) {
  const dt = Math.min(0.1, (ahora - ultimo) / 1000);
  ultimo = ahora;
  if (sim.corriendo) {
    pasoSimulacion(dt * sim.factor);
    recalcular();
    actualizarEscena();
    if (ahora - ultimoPanel > 250) {
      ultimoPanel = ahora;
      pintarEstados();
      pintarReloj();
      const dinamicas = ['tanque', 'captacion', 'vivienda', 'tuberias', 'red', 'riego', 'represa'];
      if (tabActiva === 'datos') {
        const conGrafica = ahora - ultimaGrafica > 1000;
        if (conGrafica) ultimaGrafica = ahora;
        pintarDatos(conGrafica);
      } else if (dinamicas.includes(tabActiva)) {
        const f = fichas[tabActiva];
        const datos = PINTORES[tabActiva]();
        setHTML(f.metricas, datos.metricas);
        setHTML(f.ecuacion, datos.ecuacion);
        pintarDiseno(f, datos);
        if (datos.experimento) pintarExtras(tabActiva, { experimento: datos.experimento });
        if (ahora - ultimaGrafica > 1000 && graficas[tabActiva]) {
          ultimaGrafica = ahora;
          datos.grafica(graficas[tabActiva]);
          if (datos.extra && graficas[`${tabActiva}-extra`]) datos.extra.grafica(graficas[`${tabActiva}-extra`]);
        }
      }
      if (tabActiva === 'tanque' || tabActiva === 'represa') sincronizarControles();
    }
  }
  requestAnimationFrame(bucle);
}

// ── Arranque ─────────────────────────────────────────────────────────────
let escena = null;
let experimento = null;

function iniciar() {
  crearPanel();
  if (fichas.tuberias.exp) experimento = new ExperimentoReynolds(fichas.tuberias.exp.canvas);
  controlesTiempo();
  eventosPlano();
  const contenedor = document.getElementById('escena');
  escena = new Escena(contenedor, { onSeleccion: seleccionDesdeEscena, onCasa: (id) => { elegirCasa(id); mostrarTab('vivienda'); } });
  let ok = false;
  try {
    ok = escena.iniciar();
  } catch (e) {
    console.error(e);
    ok = false;
  }
  const vistas = document.getElementById('vistas');
  if (!ok) {
    escena = null;
    document.getElementById('sinWebgl').hidden = false;
    document.getElementById('ayuda').hidden = true;
    vistas.hidden = true;
  } else {
    // Botones de vista: la escena avisa cuál quedó activa (también cuando cambia sola con la pestaña)
    escena.onVista = (v) => vistas.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vista === v)));
    vistas.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-vista]');
      if (b) escena.irAVista(b.dataset.vista);
    });
  }
  recalcular();
  sincronizarControles();
  mostrarTab('captacion');
  pintarPanel();
  actualizarEscena();
  if (location.hash === '#depurar') window.__sim = { escena, p, sim, cambio };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => pintarTab(tabActiva));
  requestAnimationFrame(bucle);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
