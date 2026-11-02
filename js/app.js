/**
 * app.js — Controlador del simulador: deslizadores, tiempo simulado,
 * métricas, ecuaciones con sustitución numérica, gráficas y registro de datos.
 */
import * as M from './modelo.js';
import * as D from './diseno.js';
import * as S from './sistema.js';
import { Escena } from './escena3d.js';
import { crearGrafica, actualizarGrafica, serieLinea, seriePuntos, paleta } from './graficas.js';
import { ExperimentoReynolds } from './reynolds.js';
import { Registro, INTERVALOS, relojSimulado, crearLibro, nombreArchivo, descargarArchivo } from './datos.js';

// ── Estado ────────────────────────────────────────────────────────────────
const NIVEL_INICIAL = 4.4;
const HORA_INICIAL = 6 * 3600;
const p = { ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO };
const sim = { nivel: NIVEL_INICIAL, t: HORA_INICIAL, bomba: true, arranques: 0, corriendo: true, factor: 600 };
let r = S.calcular(p, sim);
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
function techoRedondo(v) {
  if (v <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * e >= v) return m * e;
  return 10 * e;
}
const lps = M.lpsAm3s;

// ── Definición de pestañas y controles ─────────────────────────────────────
const TABS = [
  { id: 'captacion', nombre: 'Captación', extra: true, intro: 'El agua del río entra por la rejilla de la bocatoma, deja la arena en el desarenador y pasa al pozo de succión, de donde la bomba la eleva hasta el tanque. Aquí se fija cuánto se bombea, el tamaño del desarenador y cuánto cuesta la energía.' },
  { id: 'tuberias', nombre: 'Tuberías', experimento: true, intro: 'La aducción lleva el agua cruda del río al tanque, impulsada por la bomba; la conducción la baja del tanque hasta la entrada del barrio, donde empieza la red de distribución. Cada tubería se elige del catálogo por material, clase de presión y diámetro comercial: el diámetro interno fija la velocidad y el régimen del flujo, y el material, la rugosidad (o el coeficiente C de Hazen-Williams) y la presión que aguanta.' },
  { id: 'tanque', nombre: 'Tanque', extra: true, intro: 'El tanque compensa la diferencia entre lo que entra por bombeo y lo que consume el sector. Dos interruptores de nivel controlan la bomba: se apaga cuando el agua llega al nivel de parada y vuelve a arrancar cuando baja al nivel de arranque. El consumo cambia a lo largo del día: cuando es menor que el caudal máximo diario el tanque sube, y en las horas pico baja.' },
  { id: 'red', nombre: 'Red', red: true, intro: 'La red de distribución reparte el agua en el barrio: una tubería principal, ramales que salen de ella con su válvula de compuerta, y en cada vivienda una acometida con abrazadera de toma, tubería de servicio, llave de paso y medidor. La conducción abastece todo el sector (QMD del tanque); aquí se diseña un barrio de ese sector. Diseña la red con los controles, mira las presiones en el plano y toca una vivienda para analizarla.' },
  { id: 'vivienda', nombre: 'Vivienda', intro: 'La presión en la casa es la altura del agua en el tanque menos lo que se pierde en la conducción, en la red y en la acometida (tubería de servicio, medidor y llave de paso). Con lo que queda sale el chorro del grifo.' },
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

const CONTROLES = [
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
      <div class="controles"></div>
      <h3>Resultados</h3>
      <dl class="metricas"></dl>
      ${t.red || t.id === 'tuberias' ? '<h3>Revisión del diseño</h3><ul class="revision"></ul>' : ''}
      ${t.red ? `<h3>Zanja típica</h3><figure class="zanja"><div class="svg-zanja" role="img" aria-label="Corte de la zanja"></div><figcaption></figcaption></figure>
        <h3>Cantidades de obra</h3><div class="tabla-cantidades"></div>` : ''}
      <h3>Modelo matemático</h3>
      <div class="ecuacion"></div>
      <figure class="grafica"><div class="lienzo"><canvas aria-label="Gráfica de ${t.nombre.toLowerCase()}"></canvas></div><figcaption></figcaption></figure>
      ${t.extra ? '<figure class="grafica grafica-extra"><div class="lienzo"><canvas aria-label="Segunda gráfica"></canvas></div><figcaption></figcaption></figure>' : ''}
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
      plano: f.querySelector('.svg-plano'),
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
      sel.addEventListener('change', () => { p[c.clave] = c.numero ? Number(sel.value) : sel.value; cambio(); });
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
  escena?.actualizar(p, r, sim.nivel);
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

const PINTORES = {
  captacion() {
    const desnivel = p.cotaTanque + sim.nivel - p.cotaRio;
    const c = r.costo;
    const d = r.desarenador;
    const dmm = d.dMin * 1000;
    const hayFlujo = p.Qbombeo > 0;
    const auto = p.controlBomba === 'automatico';
    const Hm = i('H̄');
    return {
      metricas: metricas([
        ['<b>Bombeo y energía</b>', '', ''],
        ['Estado de la bomba', r.bomba ? 'Encendida' : `Apagada (arranca a ${fmt(p.nivelArranque)} m)`, '', r.bomba ? 'ok' : 'aviso'],
        ['Altura dinámica ahora', r.bomba ? r.alturaBombeo : 'sin bombeo', r.bomba ? 'm' : ''],
        ['Desnivel río → superficie del tanque', fmt(desnivel), 'm'],
        ['Pérdida en la succión', fmt(r.succion.hfReal, 3), 'm'],
        ['Velocidad en la succión', fmt(r.succion.V), 'm/s', r.succion.V <= p.VmaxSuccion ? 'ok' : 'aviso'],
        ['Pérdida por fricción en la aducción', fmt(r.aduccion.hfReal), 'm'],
        ['Altura dinámica media del ciclo', r.Hmedia, 'm'],
        ['Horas de bombeo al día', `${fmt(r.horasDia, 1)}${auto ? ' (las fija el control por niveles)' : ''}`, 'h'],
        ['Potencia de la bomba al trabajar', r.potenciaMedia / 1000, 'kW'],
        ['Volumen bombeado al mes', r.Vmes, 'm³'],
        ['Energía consumida al mes', c.energia, 'kWh'],
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
        ecu.sust(`${Hm} = (${fmt(p.cotaTanque)} + ${fmt(r.nivelMedio, 3)} − ${fmt(p.cotaRio)}) + ${fmt(r.hfBombeo, 3)} = ${fmt(r.Hmedia)} m`),
        ecu.tipo('Ecuación lineal: costo de bombeo'),
        ecu.formula(`${i('C')}(${i('V')}) = ${i('m')} · ${i('V')} + ${i('b')}`),
        ecu.formula(`${i('m')} = tarifa · ρ${i('g')}${Hm} / (η · 3.6×10⁶)`),
        ecu.sust(`${i('m')} = ${fmt(p.tarifaKWh, 0)} × 997.05 × 9.81 × ${fmt(r.Hmedia)} / (${fmt(p.eficiencia)} × 3 600 000) = ${fmt(c.m)} COP/m³`),
        ecu.sust(`${i('C')}(${fmt(r.Vmes)}) = ${fmt(c.m)} × ${fmt(r.Vmes)} + ${fmt(c.b, 0)} = $ ${fmt(c.costo, 0)}`),
        ecu.nota('La pendiente es lo que cuesta subir un metro cúbico hasta el tanque; el intercepto es el cargo fijo que se paga aunque la bomba no funcione. Se convierte el volumen a energía antes de aplicar la tarifa, porque la tarifa está en COP por kWh.'),
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
    <p class="nota-datos" data-rol="estado-excel" aria-live="polite">El libro trae siete hojas: resumen, parámetros y resultados, serie de tiempo, arranques y paradas, ciclo y costo con fórmulas, revisión del diseño y cantidades de obra.</p>
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
  ['cotaRio', 'Cota del río', 'm.s.n.m.', 2, (q) => q.cotaRio],
  ['cotaTanque', 'Cota del fondo del tanque', 'm.s.n.m.', 2, (q) => q.cotaTanque],
  ['cotaCasa', 'Cota de la entrada del barrio', 'm.s.n.m.', 2, (q) => q.cotaCasa],
  ['K0', 'Coeficiente de pérdida de la llave abierta K₀', '', 1, (q) => q.K0],
  ['dBoquilla', 'Diámetro de la boquilla del grifo', 'mm', 1, (q) => q.dBoquilla * 1000],
  ['medidorQmax', 'Caudal máximo del medidor', 'm³/h', 1, (q) => q.medidorQmax],
  ['Kllave', 'Coeficiente de la llave de paso', '', 2, (q) => q.Kllave],
  ['VmaxSuccion', 'Velocidad máxima en la succión', 'm/s', 2, (q) => q.VmaxSuccion],
  ['arranquesMax', 'Arranques por hora admisibles', '1/h', 0, (q) => q.arranquesMax],
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
    const cumplen = r.checks.filter((x) => x.nivel === 'ok').length;
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
        ['Criterios de diseño que se cumplen', `${cumplen} de ${r.checks.length}`],
        ['Arroyo', c.desborde ? `Desborde: faltan ${fmt(p.Qcrecida - c.Qcap)} m³/s` : `Sin desborde (${fmt((p.Qcrecida / c.Qcap) * 100, 0)} % de la capacidad)`],
      ],
      actual: instantanea('Al exportar'),
      registro,
      ciclo: {
        automatico: p.controlBomba === 'automatico', alcanza: r.alcanza,
        Dtanque: p.Dtanque, hA: p.nivelArranque, hP: p.nivelParada, Qb: lps(p.Qbombeo), Qs: lps(p.Qdemanda),
        cotaRio: p.cotaRio, cotaTanque: p.cotaTanque, hf: r.hfBombeo, eficiencia: p.eficiencia,
        tarifa: p.tarifaKWh, cargoFijo: p.cargoFijo, At: r.At, dV: ci.dV,
        tEnc: ci.tLlenado, tApag: ci.tVaciado, ciclo: ci.ciclo, horasDia: r.horasDia, arranquesHora: ci.arranquesHora,
        nivelMedio: r.nivelMedio, Hmedia: r.Hmedia, Vmes: r.Vmes, m: r.costo.m, energia: r.costo.energia, costo: r.costo.costo,
      },
      revision: r.checks.map((x) => ({ texto: x.texto, nivel: x.nivel, detalle: x.detalle })),
      cantidades: r.cantidades.filas,
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
  registro.acumular(D.energiaTramo(p, st.tBomba, st.areaNivel, r.hfBombeo), st.tBomba);
  sim.nivel = st.nivel;
  sim.bomba = st.bomba;
  sim.arranques += st.arranques;
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
  const tb0 = r.bomba
    ? `Bomba encendida: ${fmt(p.Qbombeo)} L/s${p.controlBomba === 'automatico' ? ` (se apaga a ${fmt(p.nivelParada)} m)` : ''}`
    : `Bomba apagada (arranca a ${fmt(p.nivelArranque)} m)`;
  if (bom) {
    const sp = bom.querySelector('.texto');
    if (sp.textContent !== tb0) sp.textContent = tb0;
    bom.dataset.nivel = r.bomba ? 'ok' : 'aviso';
  }
  const c = r.canal;
  const uso = (p.Qcrecida / c.Qcap) * 100;
  const [tb, nb] = c.desborde
    ? [`El arroyo se desborda: faltan ${fmt(p.Qcrecida - c.Qcap)} m³/s de capacidad`, 'alerta']
    : [`Arroyo: el canal va al ${fmt(uso, 0)} % de su capacidad`, uso > 85 ? 'aviso' : 'ok'];
  for (const [el, t, n] of [[acu, ta, na], [arr, tb, nb]]) {
    const span = el.querySelector('.texto');
    if (span.textContent !== t) span.textContent = t;
    el.dataset.nivel = n;
  }
  const alertas = { vivienda: r.estado !== 'normal' || r.casa.cerrada, tanque: r.vacio, arroyo: c.desborde,
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
    escena?.actualizar(p, r, sim.nivel);
    if (ahora - ultimoPanel > 250) {
      ultimoPanel = ahora;
      pintarEstados();
      pintarReloj();
      const dinamicas = ['tanque', 'captacion', 'vivienda', 'tuberias', 'red'];
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
      if (tabActiva === 'tanque') sincronizarControles();
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
  if (!ok) {
    escena = null;
    document.getElementById('sinWebgl').hidden = false;
    document.getElementById('ayuda').hidden = true;
  }
  recalcular();
  sincronizarControles();
  mostrarTab('captacion');
  pintarPanel();
  escena?.actualizar(p, r, sim.nivel);
  if (location.hash === '#depurar') window.__sim = { escena, p, sim, cambio };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => pintarTab(tabActiva));
  requestAnimationFrame(bucle);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
