// Pruebas del diseño: catálogo de tuberías, demanda, control de la bomba,
// golpe de ariete y red ramificada. Ejecutar con:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/modelo.js';
import * as D from '../js/diseno.js';
import * as S from '../js/sistema.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtenido ${a} (tol ${tol})`);

const base = () => {
  const p = { ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO };
  S.sincronizarTubos(p);
  return p;
};

test('Catálogo: PVC 6" RDE 21 según NTC 382', () => {
  const e = D.especTubo('pvc', 'RDE 21', '6"');
  cerca(e.DE * 1000, 168.28, 0.01);             // diámetro externo IPS
  cerca(e.e * 1000, 168.28 / 21, 0.01);         // espesor = DE / RDE = 8.01 mm
  cerca(e.DI * 1000, 152.25, 0.05);             // DI = DE − 2e
  cerca(e.pnMPa, (2 * 13.79) / 20, 1e-6);       // PR = 2S/(RDE − 1) = 1.379 MPa
  cerca(e.pnMca, 141, 1);                       // ≈ 141 m.c.a.
  assert.equal(e.C, 150);
});

test('Catálogo: cada material tiene su C de Hazen-Williams', () => {
  assert.equal(D.MATERIALES.pvc.C, 150);
  assert.ok(D.MATERIALES.pead.C >= 140 && D.MATERIALES.pead.C <= 145);
  assert.ok(D.MATERIALES.grp.C >= 130 && D.MATERIALES.grp.C <= 135);
  assert.equal(D.MATERIALES.hd.C, 130);
  assert.ok(D.MATERIALES.ccp.C >= 110 && D.MATERIALES.ccp.C <= 120);
  // PEAD PE100 SDR 11: PN = 16 / (SDR − 1) = 1.6 MPa
  const pe = D.especTubo('pead', 'SDR 11', '63 mm');
  cerca(pe.pnMPa, 1.6, 1e-9);
});

test('Hazen-Williams: h = 10.67·L·Q^1.852 / (C^1.852·D^4.87)', () => {
  const h = D.perdidaHazen(0.01, 100, 0.1, 150);
  const esperado = (10.67 * 100 * 0.01 ** 1.852) / (150 ** 1.852 * 0.1 ** 4.87);
  cerca(h, esperado, 1e-9);
  // Tubería más rugosa (C menor) pierde más
  assert.ok(D.perdidaHazen(0.01, 100, 0.1, 110) > h);
});

test('Demanda: Qmd, QMD = k1·Qmd y QMH = k2·QMD', () => {
  const q = D.caudalMedioVivienda(4, 140, 0.25);
  cerca(q * 1000, (4 * 140) / 0.75 / 86400, 1e-12); // 0.00864 L/s
  const c = D.caudalesDiseno(0.001, 1.3, 1.6);
  cerca(c.QMD, 0.0013, 1e-12);
  cerca(c.QMH, 0.00208, 1e-12);
});

test('Curva horaria: promedio 1 y pico igual a k2', () => {
  for (const k2 of [1.5, 1.6, 1.8]) {
    const f = D.factoresHorarios(k2);
    assert.equal(f.length, 24);
    cerca(f.reduce((a, b) => a + b, 0) / 24, 1, 1e-9);
    cerca(Math.max(...f), k2, 0.02);
  }
});

test('Volumen de regulación: máx − mín de la curva de masa, cierra en cero', () => {
  const v = D.volumenRegulacion(0.01085, 1.6);
  cerca(v.masa[24], 0, 1e-6);                    // lo que entra en el día = lo que sale
  cerca(v.V, Math.max(...v.masa) - Math.min(...v.masa), 1e-9);
  assert.ok(v.fraccion > 0.1 && v.fraccion < 0.3);
});

test('Control de la bomba: histéresis entre arranque y parada', () => {
  const p = { controlBomba: 'automatico', nivelArranque: 3, nivelParada: 4.75 };
  assert.equal(D.controlBomba(p, 4.75, true), false);  // llega a la parada: se apaga
  assert.equal(D.controlBomba(p, 4.0, false), false);  // bajando entre niveles: sigue apagada
  assert.equal(D.controlBomba(p, 3.0, false), true);   // llega al arranque: enciende
  assert.equal(D.controlBomba(p, 4.0, true), true);    // subiendo entre niveles: sigue encendida
  assert.equal(D.controlBomba({ controlBomba: 'continuo' }, 5, true), true);
});

test('Tanque: el nivel queda entre los interruptores y la bomba arranca y para', () => {
  const p = base();
  let e = { nivel: 4.4, bomba: true, t: 7 * 3600, arranques: 0 };
  let min = Infinity, max = -Infinity, cambios = 0, arr = 0;
  for (let i = 0; i < 48 * 12; i++) {
    const antes = e.bomba;
    e = D.avanzarTanque(p, e, 300);
    if (e.bomba !== antes) cambios++;
    arr += e.arranques;
    min = Math.min(min, e.nivel);
    max = Math.max(max, e.nivel);
  }
  assert.ok(max <= p.nivelParada + 1e-6, `máximo ${max}`);
  assert.ok(min >= p.nivelArranque - 0.05, `mínimo ${min}`);
  assert.ok(cambios >= 2 && arr >= 1, `cambios ${cambios}, arranques ${arr}`);
});

test('Tanque: el ciclo con consumo igual al QMD', () => {
  const p = base();
  const c = D.cicloBomba(p);
  const A = M.areaTanque(p.Dtanque);
  cerca(c.dV, A * (p.nivelParada - p.nivelArranque), 1e-9);
  cerca(c.tLlenado, c.dV / ((p.Qbombeo - p.Qdemanda) / 1000), 1e-6);
  cerca(c.horasDia, 24 * c.tLlenado / c.ciclo, 1e-9);
});

test('Golpe de ariete (Joukowsky): ΔH = a·V/g', () => {
  const e = D.especTubo('pvc', 'RDE 21', '6"');
  const a = D.celeridad(e);
  const esperado = Math.sqrt(D.K_AGUA / M.RHO) / Math.sqrt(1 + (D.K_AGUA * e.DI) / (e.E * e.e));
  cerca(a, esperado, 1e-9);
  assert.ok(a > 250 && a < 500);                 // PVC: tubería flexible, celeridad baja
  cerca(D.golpeAriete(1, e).dH, a / M.G, 1e-9);
  // El hierro dúctil es más rígido: más celeridad
  assert.ok(D.celeridad(D.especTubo('hd', 'C40', 'DN 150')) > a);
});

test('Red ramificada: continuidad de caudales y presiones', () => {
  const p = base();
  const q = D.caudalesDiseno(D.caudalMedioVivienda(p.habitantes, p.dotacion, p.perdidas), p.k1, p.k2).QMH;
  const red = D.calcularRed(p, 40, 42, q);
  assert.equal(red.casas.length, p.nRamales * p.nViviendas);
  cerca(red.Qred, red.casas.reduce((a, c) => a + c.q, 0), 1e-12);    // entra lo que consumen
  const primero = red.tramos.find((t) => t.tipo === 'principal');
  cerca(primero.Q, red.Qred, 1e-12);
  for (const c of red.casas) cerca(c.presion, c.Hn - c.cota, 1e-9);  // p/γ = H − z
  assert.ok(red.casas.every((c) => c.presion >= red.critica.presion - 1e-12));
  // La energía solo baja aguas abajo
  assert.ok(red.casas.every((c) => c.Hn <= 40 + 1e-9));
});

test('Red: con un ramal cerrado sus viviendas quedan sin agua y baja el caudal', () => {
  const p = base();
  const q = 0.000018;
  const abierta = D.calcularRed(p, 40, 42, q);
  const cerrada = D.calcularRed({ ...p, ramalCerrado: 2 }, 40, 42, q);
  assert.ok(cerrada.casas.filter((c) => c.j === 2).every((c) => c.cerrada));
  assert.ok(cerrada.Qred < abierta.Qred);
});

test('Acometida: más carga en la red da más caudal en el grifo', () => {
  const p = base();
  const e = D.especTubo('pead', 'SDR 9', '20 mm');
  const g1 = D.grifoConAcometida(p, 30, 13, e, 'darcy');
  const g2 = D.grifoConAcometida(p, 40, 13, e, 'darcy');
  assert.ok(g2.q > g1.q && g1.q > 0);
  // Balance de energía: Hn − pérdidas = carga en el grifo
  cerca(g1.H, 30 - 13 - g1.hf - g1.hm - g1.hl, 0.01);
});

test('Sistema completo con los valores iniciales: todas las revisiones cumplen', () => {
  const p = base();
  const r = S.calcular(p, { nivel: 4.4, bomba: true, t: 7 * 3600 });
  const fallan = r.checks.filter((c) => c.nivel === 'alerta').map((c) => c.texto);
  assert.deepEqual(fallan, []);
  assert.ok(r.redDiseno.presionMin >= p.presionMinima);
  assert.ok(r.aduccion.V >= p.Vmin && r.aduccion.V <= p.Vmax);
});
