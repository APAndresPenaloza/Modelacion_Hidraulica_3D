/**
 * app.js — Controlador del simulador: deslizadores, tiempo simulado,
 * métricas, ecuaciones con sustitución numérica y gráficas.
 */
import * as M from './modelo.js';
import { Escena } from './escena3d.js';
import { crearGrafica, actualizarGrafica, serieLinea, seriePuntos, paleta } from './graficas.js';

// ── Estado ────────────────────────────────────────────────────────────────
const NIVEL_INICIAL = 3.2;
const HORA_INICIAL = 6 * 3600;
const p = { ...M.PARAMETROS_INICIALES };
const sim = { nivel: NIVEL_INICIAL, t: HORA_INICIAL, corriendo: true, factor: 600 };
let r = M.calcularSistema(p, sim.nivel);
let tabActiva = 'captacion';

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
  { id: 'captacion', nombre: 'Captación', intro: 'El agua se toma del río y una bomba la eleva hasta el tanque. Aquí se fija cuánto se bombea y cuánto cuesta la energía de hacerlo.' },
  { id: 'tuberias', nombre: 'Tuberías', intro: 'La aducción lleva el agua del río al tanque y la distribución la baja hasta las viviendas. El diámetro y el caudal fijan la velocidad y lo que se pierde por fricción.' },
  { id: 'tanque', nombre: 'Tanque', intro: 'El tanque compensa la diferencia entre lo que entra por bombeo y lo que consume el sector. Con caudales constantes, su nivel sube o baja en línea recta.' },
  { id: 'vivienda', nombre: 'Vivienda', intro: 'La presión en la casa es la altura del agua en el tanque menos lo que se pierde en el camino. Con esa presión sale el chorro del grifo.' },
  { id: 'arroyo', nombre: 'Arroyo', intro: 'Con los aguaceros los arroyos de la ciudad crecen de golpe. El canal rectangular tiene que conducir la crecida sin desbordarse.' },
];

const MATERIALES = [
  { n: 0.013, nombre: 'Concreto liso (n = 0.013)' },
  { n: 0.015, nombre: 'Concreto (n = 0.015)' },
  { n: 0.025, nombre: 'Mampostería de piedra (n = 0.025)' },
  { n: 0.03, nombre: 'Tierra con maleza (n = 0.030)' },
];

const pulgadas = (mm) => `${fmt(mm / 25.4, 2)} in`;

const CONTROLES = [
  { tab: 'captacion', grupo: 'Bombeo desde el río' },
  { tab: 'captacion', id: 'Qbombeo', clave: 'Qbombeo', etiqueta: 'Caudal bombeado', unidad: 'L/s', min: 0.5, max: 30, paso: 0.05, dec: 2 },
  { tab: 'captacion', id: 'horasDia', clave: 'horasDia', etiqueta: 'Horas de bombeo al día', unidad: 'h', min: 1, max: 24, paso: 0.5, dec: 1 },
  { tab: 'captacion', id: 'eficiencia', clave: 'eficiencia', etiqueta: 'Eficiencia de la bomba', unidad: '%', min: 40, max: 90, paso: 1, dec: 0, aUI: (v) => v * 100, deUI: (v) => v / 100 },
  { tab: 'captacion', grupo: 'Costo de la energía' },
  { tab: 'captacion', id: 'tarifa', clave: 'tarifaKWh', etiqueta: 'Tarifa de energía', unidad: 'COP/kWh', min: 300, max: 1500, paso: 10, dec: 0 },
  { tab: 'captacion', id: 'cargoFijo', clave: 'cargoFijo', etiqueta: 'Cargo fijo mensual', unidad: 'COP', min: 0, max: 500000, paso: 5000, dec: 0 },

  { tab: 'tuberias', grupo: 'Aducción: del río al tanque' },
  { tab: 'tuberias', id: 'Qbombeo2', clave: 'Qbombeo', etiqueta: 'Caudal', unidad: 'L/s', min: 0.5, max: 30, paso: 0.05, dec: 2 },
  {
    tab: 'tuberias', id: 'Vaduccion', etiqueta: 'Velocidad del flujo', unidad: 'm/s', min: 0.05, max: 5, paso: 0.01, dec: 2,
    leer: () => M.velocidadMedia(lps(p.Qbombeo), p.Daduccion),
    escribir: (v) => { p.Qbombeo = limitar(M.m3sAlps(M.caudalDesdeVelocidad(v, p.Daduccion)), 0.5, 30); },
  },
  { tab: 'tuberias', id: 'Daduccion', clave: 'Daduccion', etiqueta: 'Diámetro', unidad: 'mm', min: 50, max: 300, paso: 1, dec: 0, aUI: (v) => v * 1000, deUI: (v) => v / 1000, extra: pulgadas },
  { tab: 'tuberias', id: 'Laduccion', clave: 'Laduccion', etiqueta: 'Longitud', unidad: 'm', min: 100, max: 2000, paso: 10, dec: 0 },
  { tab: 'tuberias', grupo: 'Distribución: del tanque a la vivienda' },
  { tab: 'tuberias', id: 'Qdemanda', clave: 'Qdemanda', etiqueta: 'Caudal consumido por el sector', unidad: 'L/s', min: 0.5, max: 30, paso: 0.05, dec: 2 },
  {
    tab: 'tuberias', id: 'Vdistribucion', etiqueta: 'Velocidad del flujo', unidad: 'm/s', min: 0.05, max: 6, paso: 0.01, dec: 2,
    leer: () => M.velocidadMedia(lps(p.Qdemanda), p.Ddistribucion),
    escribir: (v) => { p.Qdemanda = limitar(M.m3sAlps(M.caudalDesdeVelocidad(v, p.Ddistribucion)), 0.5, 30); },
  },
  { tab: 'tuberias', id: 'Ddistribucion', clave: 'Ddistribucion', etiqueta: 'Diámetro', unidad: 'mm', min: 25, max: 200, paso: 1, dec: 0, aUI: (v) => v * 1000, deUI: (v) => v / 1000, extra: pulgadas },
  { tab: 'tuberias', id: 'Ldistribucion', clave: 'Ldistribucion', etiqueta: 'Longitud', unidad: 'm', min: 100, max: 2000, paso: 10, dec: 0 },

  { tab: 'tanque', grupo: 'Dimensiones' },
  { tab: 'tanque', id: 'Dtanque', clave: 'Dtanque', etiqueta: 'Diámetro del tanque', unidad: 'm', min: 4, max: 20, paso: 0.1, dec: 2 },
  { tab: 'tanque', id: 'hMax', clave: 'hMax', etiqueta: 'Altura útil', unidad: 'm', min: 2, max: 8, paso: 0.1, dec: 2 },
  { tab: 'tanque', grupo: 'Operación' },
  {
    tab: 'tanque', id: 'nivel', etiqueta: 'Nivel actual del agua', unidad: 'm', min: 0, max: () => p.hMax, paso: 0.01, dec: 2,
    leer: () => sim.nivel,
    escribir: (v) => { sim.nivel = limitar(v, 0, p.hMax); },
  },
  { tab: 'tanque', id: 'Qbombeo3', clave: 'Qbombeo', etiqueta: 'Caudal que entra (bombeo)', unidad: 'L/s', min: 0.5, max: 30, paso: 0.05, dec: 2 },
  { tab: 'tanque', id: 'Qdemanda2', clave: 'Qdemanda', etiqueta: 'Caudal que sale (consumo)', unidad: 'L/s', min: 0.5, max: 30, paso: 0.05, dec: 2 },

  { tab: 'vivienda', grupo: 'Grifo' },
  { tab: 'vivienda', id: 'apertura', clave: 'apertura', etiqueta: 'Apertura de la llave', unidad: '%', min: 5, max: 100, paso: 1, dec: 0, aUI: (v) => v * 100, deUI: (v) => v / 100 },
  { tab: 'vivienda', id: 'alturaGrifo', clave: 'alturaGrifo', etiqueta: 'Altura del grifo sobre el terreno', unidad: 'm', min: 0.5, max: 9, paso: 0.1, dec: 2 },
  { tab: 'vivienda', grupo: 'Criterio de servicio' },
  { tab: 'vivienda', id: 'presionMinima', clave: 'presionMinima', etiqueta: 'Presión mínima de referencia', unidad: 'm.c.a.', min: 5, max: 30, paso: 0.5, dec: 1 },
  { tab: 'vivienda', id: 'Qdemanda3', clave: 'Qdemanda', etiqueta: 'Caudal consumido por el sector', unidad: 'L/s', min: 0.5, max: 30, paso: 0.05, dec: 2 },

  { tab: 'arroyo', grupo: 'Sección del canal' },
  { tab: 'arroyo', id: 'perimetro', clave: 'perimetro', etiqueta: 'Perímetro mojado disponible (P)', unidad: 'm', min: 2, max: 12, paso: 0.05, dec: 2 },
  { tab: 'arroyo', id: 'anchoCanal', clave: 'anchoCanal', etiqueta: 'Ancho del fondo (b)', unidad: 'm', min: 0.2, max: () => p.perimetro - 0.2, paso: 0.05, dec: 2 },
  { tab: 'arroyo', accion: 'optimo', texto: 'Usar el ancho óptimo (b = P/2)' },
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
    f.innerHTML = `
      <p class="intro">${t.intro}</p>
      <div class="controles"></div>
      <h3>Resultados</h3>
      <dl class="metricas"></dl>
      <h3>Modelo matemático</h3>
      <div class="ecuacion"></div>
      <figure class="grafica"><div class="lienzo"><canvas aria-label="Gráfica de ${t.nombre.toLowerCase()}"></canvas></div><figcaption></figcaption></figure>`;
    elFichas.appendChild(f);
    fichas[t.id] = {
      raiz: f,
      controles: f.querySelector('.controles'),
      metricas: f.querySelector('.metricas'),
      ecuacion: f.querySelector('.ecuacion'),
      canvas: f.querySelector('canvas'),
      leyenda: f.querySelector('figcaption'),
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
    const destino = fichas[c.tab].controles;
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
        p.anchoCanal = M.seccionOptima(p.perimetro).b;
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
    c.el = { rango, numero, extra: div.querySelector('.extra') };
    destino.appendChild(div);
  }
}

function sincronizarControles(origen) {
  for (const c of CONTROLES) {
    if (!c.el) continue;
    if (c.el.sel) { c.el.sel.value = String(p.nManning); continue; }
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
  sim.nivel = limitar(sim.nivel, 0, p.hMax);
}

function recalcular() {
  aplicarRestricciones();
  r = M.calcularSistema(p, sim.nivel);
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

function metricas(filas) {
  return filas.map(([dt, valor, unidad = '', nivel = '']) =>
    `<dt>${dt}</dt><dd${nivel ? ` data-nivel="${nivel}"` : ''}>${valor}${unidad ? `<small>${unidad}</small>` : ''}</dd>`).join('');
}

function setHTML(el, html) {
  if (el.__html !== html) { el.innerHTML = html; el.__html = html; }
}

const PINTORES = {
  captacion() {
    const desnivel = p.cotaTanque + sim.nivel - p.cotaRio;
    const c = r.costo;
    return {
      metricas: metricas([
        ['Altura dinámica de bombeo', fmt(r.alturaBombeo), 'm'],
        ['Desnivel río → superficie del tanque', fmt(desnivel), 'm'],
        ['Pérdida por fricción en la aducción', fmt(r.aduccion.hfReal), 'm'],
        ['Potencia de la bomba', fmt(r.potencia / 1000), 'kW'],
        ['Volumen bombeado al mes', fmt(r.Vmes), 'm³'],
        ['Energía consumida al mes', fmt(c.energia), 'kWh'],
        ['Costo mensual de bombeo', `$\u00a0${fmt(c.costo, 0)}`, 'COP'],
      ]),
      ecuacion: [
        ecu.tipo('Decimales: volumen mensual'),
        ecu.formula(`${i('V')} = ${i('Q')} · horas · 3600 · 30`),
        ecu.sust(`${i('V')} = ${fmt(lps(p.Qbombeo), 5)} × ${fmt(p.horasDia, 1)} × 3600 × 30 = ${fmt(r.Vmes)} m³`),
        ecu.tipo('Ecuación lineal: costo de bombeo'),
        ecu.formula(`${i('C')}(${i('V')}) = ${i('m')} · ${i('V')} + ${i('b')}`),
        ecu.formula(`${i('m')} = tarifa · ρ${i('g')}${i('H')} / (η · 3.6×10⁶)`),
        ecu.sust(`${i('m')} = ${fmt(p.tarifaKWh, 0)} × 997.05 × 9.81 × ${fmt(r.alturaBombeo)} / (${fmt(p.eficiencia)} × 3 600 000) = ${fmt(c.m)} COP/m³`),
        ecu.sust(`${i('C')}(${fmt(r.Vmes)}) = ${fmt(c.m)} × ${fmt(r.Vmes)} + ${fmt(c.b, 0)} = $\u00a0${fmt(c.costo, 0)}`),
        ecu.nota('La pendiente es lo que cuesta subir un metro cúbico hasta el tanque; el intercepto es el cargo fijo que se paga aunque la bomba no funcione. Se convierte el volumen a energía antes de aplicar la tarifa, porque la tarifa está en COP por kWh.'),
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
    };
  },

  tuberias() {
    const a = r.aduccion;
    const d = r.distribucion;
    const fila = (nombre, t, Q) => [
      [`<b>${nombre}</b>`, '', ''],
      ['Velocidad media', fmt(t.V), 'm/s'],
      ['Número de Reynolds', `${fmt(t.Re, 0)} (${t.regimen})`, '', t.regimen === 'laminar' ? 'ok' : 'aviso'],
      ['Pérdida con la recta laminar', fmt(t.hfLineal), 'm'],
      ['Pérdida real (Darcy-Weisbach)', fmt(t.hfReal), 'm'],
      ['Caudal', fmt(M.m3sAlps(Q)), 'L/s'],
    ];
    const turbulento = d.regimen !== 'laminar';
    return {
      metricas: metricas([...fila('Aducción', a, r.Qin), ...fila('Distribución', d, r.Qsal)]),
      ecuacion: [
        ecu.tipo('Decimales: continuidad en la distribución'),
        ecu.formula(`${i('V')} = ${i('Q')} / ${i('A')},  ${i('A')} = π${i('D')}²/4`),
        ecu.sust(`${i('A')} = π × ${fmt(p.Ddistribucion, 4)}² / 4 = ${fmt(M.areaCircular(p.Ddistribucion), 6)} m²;  ${i('V')} = ${fmt(r.Qsal, 5)} / ${fmt(M.areaCircular(p.Ddistribucion), 6)} = ${fmt(d.V)} m/s`),
        ecu.tipo('Ecuación lineal: pérdida en régimen laminar (Hagen-Poiseuille)'),
        ecu.formula(`${i('h')}<sub>f</sub> = ${i('k')} · ${i('Q')},  ${i('k')} = 128 μ${i('L')} / (π ρ ${i('g')} ${i('D')}⁴)`),
        ecu.sust(`${i('k')} = 128 × 0.00089 × ${fmt(p.Ldistribucion)} / (π × 997.05 × 9.81 × ${fmt(p.Ddistribucion, 4)}⁴) = ${fmt(d.k)} s/m²`),
        ecu.sust(`${i('h')}<sub>f</sub> = ${fmt(d.k)} × ${fmt(r.Qsal, 5)} = ${fmt(d.hfLineal)} m`),
        turbulento
          ? ecu.nota(`Con Re = ${fmt(d.Re, 0)} el flujo es ${d.regimen}: la recta laminar solo es válida por debajo de Re = 2000 y aquí subestima la pérdida. Para la presión de la vivienda se usa Darcy-Weisbach con f = ${fmt(d.f, 4)}, que da ${fmt(d.hfReal)} m.`, true)
          : ecu.nota('El flujo es laminar (Re < 2000), así que la recta de Hagen-Poiseuille es la pérdida real.'),
      ].join(''),
      leyenda: 'Pérdida en la tubería de distribución según el caudal. La recta es el modelo laminar; la curva es la pérdida real cuando el flujo es turbulento.',
      grafica(g) {
        const c = paleta();
        const L = p.Ldistribucion;
        const D = p.Ddistribucion;
        const qs = Array.from({ length: 61 }, (_, k) => 0.5 * k);
        const lineal = [0, 30].map((q) => ({ x: q, y: M.perdidaLaminar(lps(q), L, D) }));
        const real = qs.map((q) => ({ x: q, y: M.analisisTuberia(lps(q), L, D).hfReal }));
        actualizarGrafica(g, [
          serieLinea('Recta laminar h = kQ', lineal, c.agua),
          serieLinea('Pérdida real', real, c.piezo, { punteada: true }),
          seriePuntos('Caudal actual', [{ x: M.m3sAlps(r.Qsal), y: d.hfReal }], c.ocre),
        ], { x: { min: 0, max: 30 }, y: { min: 0 } });
      },
      ejes: { xTitulo: 'Caudal (L/s)', yTitulo: 'Pérdida de carga (m)', formatoX: (v) => fmt(v, 0), formatoY: (v) => fmt(v, 1) },
    };
  },

  tanque() {
    const m = r.pendienteNivel;
    const balance = M.m3sAlps(r.Qent - r.Qsal);
    let tiempo = ['Tiempo para llenarse', fmtTiempo(r.tLleno), ''];
    if (m < 0) tiempo = ['Tiempo para vaciarse', fmtTiempo(r.tVacio), '', r.tVacio < 12 * 3600 ? 'alerta' : 'aviso'];
    if (m === 0) tiempo = ['Tendencia del nivel', r.vacio ? 'vacío, sin reserva' : (r.lleno ? 'lleno y rebosando' : 'estable'), '', r.vacio ? 'alerta' : ''];
    return {
      metricas: metricas([
        ['Nivel actual', fmt(sim.nivel), 'm', r.vacio ? 'alerta' : ''],
        ['Volumen almacenado', `${fmt(r.volumen)} de ${fmt(r.volumenMax)}`, 'm³'],
        ['Caudal que entra', fmt(M.m3sAlps(r.Qent)), 'L/s'],
        ['Caudal que sale', fmt(M.m3sAlps(r.Qsal)), 'L/s'],
        ['Balance (entra − sale)', fmt(balance), 'L/s', balance < 0 ? 'aviso' : 'ok'],
        ['Cambio del nivel', fmt(m * 3600 * 100), 'cm/h'],
        tiempo,
        ...(r.rebose > 0 ? [['Rebose por el aliviadero', fmt(M.m3sAlps(r.rebose)), 'L/s', 'aviso']] : []),
      ]),
      ecuacion: [
        ecu.tipo('Decimales: área y volumen del tanque'),
        ecu.sust(`${i('A')} = π × ${fmt(p.Dtanque)}² / 4 = ${fmt(r.At)} m²;  ${i('V')} = ${fmt(r.At)} × ${fmt(sim.nivel)} = ${fmt(r.volumen)} m³`),
        ecu.tipo('Ecuación lineal: nivel en el tiempo'),
        ecu.formula(`${i('h')}(${i('t')}) = ${i('h')}₀ + ${i('m')} · ${i('t')},  ${i('m')} = (${i('Q')}<sub>e</sub> − ${i('Q')}<sub>s</sub>) / ${i('A')}`),
        ecu.sust(`${i('m')} = (${fmt(r.Qent, 5)} − ${fmt(r.Qsal, 5)}) / ${fmt(r.At)} = ${fmt(m * 3600, 4)} m/h`),
        ecu.sust(`${i('h')}(${i('t')}) = ${fmt(sim.nivel)} ${m < 0 ? '−' : '+'} ${fmt(Math.abs(m * 3600), 4)} · ${i('t')}  (${i('t')} en horas)`),
        ecu.nota('Despejando t de la recta se obtiene cuánto falta para que el tanque se llene o se quede vacío. Cuando se vacía, el sector solo recibe lo que entra por bombeo.'),
      ].join(''),
      leyenda: 'Proyección del nivel para las próximas 48 horas con los caudales actuales. La recta se detiene al llegar al fondo o al borde del tanque.',
      grafica(g) {
        const c = paleta();
        const pts = [];
        let h = sim.nivel;
        for (let hora = 0; hora <= 48; hora += 0.5) {
          pts.push({ x: hora, y: h });
          h = M.avanzarNivel(p, h, 1800);
        }
        actualizarGrafica(g, [
          serieLinea('Nivel h(t)', pts, c.agua),
          serieLinea('Altura útil', [{ x: 0, y: p.hMax }, { x: 48, y: p.hMax }], c.tinta2, { punteada: true, ancho: 1 }),
          seriePuntos('Ahora', [{ x: 0, y: sim.nivel }], c.ocre),
        ], { x: { min: 0, max: 48 }, y: { min: 0, max: Math.ceil(p.hMax + 0.5) } });
      },
      ejes: { xTitulo: 'Horas desde ahora', yTitulo: 'Nivel (m)', formatoX: (v) => fmt(v, 0), formatoY: (v) => fmt(v, 1) },
    };
  },

  vivienda() {
    const H = r.Hcasa;
    const K = p.K0 / (p.apertura * p.apertura);
    const k = M.coeficientesChorro(p.alturaGrifo, Math.max(r.vGrifo, 1e-9));
    const nivelPresion = H <= 0 ? 'alerta' : (H < p.presionMinima ? 'aviso' : 'ok');
    const estados = {
      normal: ['Servicio normal', 'ok'],
      'baja-presion': ['Presión por debajo de la referencia', 'aviso'],
      deficit: ['Desabastecimiento: tanque vacío', 'alerta'],
      'sin-agua': ['No llega agua', 'alerta'],
    };
    const [txtEstado, nivelEstado] = estados[r.estado];
    return {
      metricas: metricas([
        ['Estado del servicio', txtEstado, '', nivelEstado],
        ['Carga disponible en el grifo', fmt(H), 'm.c.a.', nivelPresion],
        ['Presión', fmt(r.presionCasa), 'kPa'],
        ['Pérdida en la distribución', fmt(r.distribucion.hfReal), 'm'],
        ['Velocidad de salida', fmt(r.vGrifo), 'm/s'],
        ['Caudal en el grifo', `${fmt(r.qGrifo * 1000)} L/s, ${fmt(r.qGrifo * 60000, 1)}`, 'L/min'],
        ['Alcance del chorro', fmt(r.alcance), 'm'],
      ]),
      ecuacion: [
        ecu.tipo('Decimales: carga disponible en el grifo'),
        ecu.formula(`${i('H')} = (${i('z')}<sub>tanque</sub> + ${i('h')}) − ${i('z')}<sub>grifo</sub> − ${i('h')}<sub>f</sub>`),
        ecu.sust(`${i('H')} = (${fmt(p.cotaTanque)} + ${fmt(sim.nivel)}) − (${fmt(p.cotaCasa)} + ${fmt(p.alturaGrifo)}) − ${fmt(r.distribucion.hfReal)} = ${fmt(H)} m.c.a.`),
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
        ecu.nota(`La presión mínima de ${fmt(p.presionMinima, 1)} m.c.a. es un valor de referencia editable; conviene contrastarlo con el Reglamento Técnico del Sector de Agua Potable (RAS).`),
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
    const R = c.A / p.perimetro;
    const uso = (p.Qcrecida / c.Qcap) * 100;
    const kChorro = M.coeficientesChorro(p.alturaCaida, Math.max(c.vCanal, 1e-9));
    return {
      metricas: metricas([
        ['Estado', c.desborde ? 'Desborde' : `Sin desborde (${fmt(uso, 0)} %)`, '', c.desborde ? 'alerta' : (uso > 85 ? 'aviso' : 'ok')],
        ['Tirante de diseño y = (P − b)/2', fmt(c.yDiseno), 'm'],
        ['Área de flujo A(b)', fmt(c.A), 'm²'],
        ['Área máxima posible (b = P/2)', fmt(c.optimo.A), 'm²'],
        ['Capacidad del canal (Manning)', fmt(c.Qcap), 'm³/s'],
        ['Capacidad con la sección óptima', fmt(c.QcapOptimo), 'm³/s'],
        ['Tirante que necesita la crecida', fmt(c.yNormal), 'm', c.desborde ? 'alerta' : ''],
        ['Velocidad en el canal', fmt(c.vCanal), 'm/s'],
        ['Alcance del chorro en la compuerta', fmt(c.alcanceCompuerta), 'm'],
      ]),
      ecuacion: [
        ecu.tipo('Ecuación cuadrática: área con perímetro mojado fijo'),
        ecu.formula(`${i('P')} = ${i('b')} + 2${i('y')}  ⇒  ${i('A')}(${i('b')}) = ${i('b')}(${i('P')} − ${i('b')})/2 = −½${i('b')}² + (${i('P')}/2)${i('b')}`),
        ecu.sust(`${i('A')}(${i('b')}) = ${fmt(kc.a, 1)}${i('b')}² + ${fmt(kc.b)}${i('b')};  ${i('A')}(${fmt(p.anchoCanal)}) = ${fmt(c.A)} m²`),
        ecu.sust(`Vértice: ${i('b')}* = −${fmt(kc.b)} / (2 × ${fmt(kc.a, 1)}) = ${fmt(c.optimo.b)} m,  ${i('y')}* = ${fmt(c.optimo.y)} m,  ${i('A')}<sub>máx</sub> = ${i('P')}²/8 = ${fmt(c.optimo.A)} m²`),
        ecu.tipo('Decimales: capacidad con la ecuación de Manning'),
        ecu.formula(`${i('Q')} = (1/${i('n')}) · ${i('A')} · ${i('R')}<sup>2/3</sup> · ${i('S')}<sup>1/2</sup>,  ${i('R')} = ${i('A')}/${i('P')}`),
        ecu.sust(`${i('Q')} = (1/${fmt(p.nManning, 3)}) × ${fmt(c.A)} × ${fmt(R, 3)}<sup>2/3</sup> × ${fmt(p.pendiente, 4)}<sup>1/2</sup> = ${fmt(c.Qcap)} m³/s`),
        ecu.tipo('Ecuación cuadrática: chorro bajo la compuerta'),
        c.vCanal > 0
          ? ecu.sust(`${i('y')}(${i('x')}) = ${fmt(kChorro.a, 4)}${i('x')}² + ${fmt(p.alturaCaida)};  alcance = ${fmt(c.vCanal)} × √(2 × ${fmt(p.alturaCaida)} / 9.81) = ${fmt(c.alcanceCompuerta)} m`)
          : '',
        ecu.nota(c.desborde
          ? `La crecida de ${fmt(p.Qcrecida)} m³/s supera la capacidad en ${fmt(p.Qcrecida - c.Qcap)} m³/s y el agua sale a la calle. Prueba la sección óptima, un material más liso o más perímetro.`
          : 'Con el mismo perímetro de concreto, el vértice de la parábola da la sección que más agua conduce.', c.desborde),
      ].join(''),
      leyenda: 'Área de flujo según el ancho del fondo, con el perímetro mojado fijo. El vértice marca la sección óptima.',
      grafica(g) {
        const col = paleta();
        const P = p.perimetro;
        const pts = Array.from({ length: 61 }, (_, j) => {
          const b = (P * j) / 60;
          return { x: b, y: M.areaCanal(P, b) };
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

function pintarTab(id) {
  const datos = PINTORES[id]();
  const f = fichas[id];
  setHTML(f.metricas, datos.metricas);
  setHTML(f.ecuacion, datos.ecuacion);
  if (f.leyenda.textContent !== datos.leyenda) f.leyenda.textContent = datos.leyenda;
  if (!graficas[id] && window.Chart) graficas[id] = crearGrafica(f.canvas, datos.ejes);
  if (graficas[id]) datos.grafica(graficas[id]);
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
  const [ta, na] = textos[r.estado];
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
  const alertas = { vivienda: r.estado !== 'normal', tanque: r.vacio, arroyo: c.desborde };
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
  });
  const sel = document.getElementById('selVelocidad');
  sel.addEventListener('change', () => { sim.factor = parseFloat(sel.value); });
  document.getElementById('btnReiniciar').addEventListener('click', () => {
    Object.assign(p, M.PARAMETROS_INICIALES);
    sim.nivel = NIVEL_INICIAL;
    sim.t = HORA_INICIAL;
    cambio();
  });
}

let ultimo = performance.now();
let ultimoPanel = 0;
let ultimaGrafica = 0;
function bucle(ahora) {
  const dt = Math.min(0.1, (ahora - ultimo) / 1000);
  ultimo = ahora;
  if (sim.corriendo) {
    const paso = dt * sim.factor;
    sim.t += paso;
    sim.nivel = M.avanzarNivel(p, sim.nivel, paso);
    recalcular();
    escena?.actualizar(p, r, sim.nivel);
    if (ahora - ultimoPanel > 250) {
      ultimoPanel = ahora;
      pintarEstados();
      pintarReloj();
      const dinamicas = ['tanque', 'captacion', 'vivienda', 'tuberias'];
      if (dinamicas.includes(tabActiva)) {
        const f = fichas[tabActiva];
        const datos = PINTORES[tabActiva]();
        setHTML(f.metricas, datos.metricas);
        setHTML(f.ecuacion, datos.ecuacion);
        if (ahora - ultimaGrafica > 1000 && graficas[tabActiva]) {
          ultimaGrafica = ahora;
          datos.grafica(graficas[tabActiva]);
        }
      }
      if (tabActiva === 'tanque') sincronizarControles();
    }
  }
  requestAnimationFrame(bucle);
}

// ── Arranque ─────────────────────────────────────────────────────────────
let escena = null;

function iniciar() {
  crearPanel();
  controlesTiempo();
  const contenedor = document.getElementById('escena');
  escena = new Escena(contenedor, { onSeleccion: seleccionDesdeEscena });
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
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => pintarTab(tabActiva));
  requestAnimationFrame(bucle);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
