// Pruebas del agua subterránea: río que gana o pierde agua, Darcy, cono de
// abatimiento (Thiem y Sichardt), tiempo de viaje al pozo y curva de llegada.
// Ejecutar con:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/modelo.js';
import * as A from '../js/acuifero.js';
import * as S from '../js/sistema.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtenido ${a} (tol ${tol})`);

const calcular = (cambios = {}) =>
  S.calcular({ ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO, ...cambios }, { nivel: 4.4, bomba: true, t: 6 * 3600 }).acuifero;

test('Capas: suelo, arcilla y acuífero bajo la llanura', () => {
  const e = A.estratos({ tipoAcuifero: 'semiconfinado', profFreatico: 2, espesorAcuifero: 20 });
  cerca(e.nivel, 2.0, 1e-12);            // 4.0 − 2 m
  cerca(e.techoAcuifero, 0.0, 1e-12);    // debajo de 2 m de arcilla
  cerca(e.fondo, -20.0, 1e-12);
  const libre = A.estratos({ tipoAcuifero: 'libre', profFreatico: 2, espesorAcuifero: 20 });
  cerca(libre.techoAcuifero, libre.nivel, 1e-12);   // en un acuífero libre el techo es el nivel freático
});

test('Río perdedor o ganador según el nivel del río frente al nivel freático', () => {
  const base = calcular();
  assert.equal(base.regimen, 'perdedor');            // río a 2.50 m, nivel freático a 2.00 m
  cerca(base.dh, 0.5, 1e-12);
  // Darcy: v = K·i/n_e, con i = Δh/L
  cerca(base.vNat, (10 * (0.5 / A.L_CONEXION)) / 0.2, 1e-12);
  // En la época seca el río baja de 2.00 m y el acuífero lo alimenta
  assert.equal(calcular({ cotaRio: 1.9 }).regimen, 'ganador');
  // El nivel natural se junta con el río en la orilla
  cerca(A.nivelNatural(base, 0), 2.5, 1e-12);
  assert.ok(Math.abs(A.nivelNatural(base, 1000) - 2.0) < 1e-6);
});

test('Pozo: cono de abatimiento de Thiem con el radio de Sichardt', () => {
  const a = calcular();
  const T = (10 / 86400) * 20;
  const Q = 0.005;
  // s = Q/(2πT)·ln(R/r_w) y R = 3000·s·√K
  cerca(a.cono.s, (Q / (2 * Math.PI * T)) * Math.log(a.cono.R / A.RADIO_POZO), 1e-9);
  cerca(a.cono.R, 3000 * a.cono.s * Math.sqrt(10 / 86400), 1e-6);
  cerca(a.cono.s, 2.10, 0.01);
  cerca(a.cono.R, 67.8, 0.1);
  // El abatimiento baja con la distancia (función logarítmica) y es cero fuera del radio
  assert.ok(A.abatimientoEn(a.cono, 10) > A.abatimientoEn(a.cono, 30));
  assert.equal(A.abatimientoEn(a.cono, 80), 0);
  cerca(a.nivelPozo, A.nivelNatural(a, a.L) - a.cono.s, 1e-12);
  // Un material poco permeable no da el caudal: el pozo se seca
  const fina = calcular({ materialAcuifero: 'arenaFina', Qpozo: 20 });
  assert.equal(fina.seco, true);
  assert.equal(fina.checks.find((c) => c.texto.startsWith('Pozo: abatimiento')).nivel, 'alerta');
});

test('Tiempo de viaje del río al pozo: t = π·b·n_e·L²/Q (cuadrático en la distancia)', () => {
  const a = calcular({ tipoAcuifero: 'libre' });
  assert.equal(a.via, 'bombeo');                   // el cono alcanza el río
  cerca(a.tHoriz, (Math.PI * 20 * 0.2 * 40 ** 2) / (0.005 * 86400), 1e-9);
  cerca(a.tViaje, a.tHoriz, 1e-12);                // sin capa de arcilla
  // A la mitad de la distancia, la cuarta parte del tiempo
  const cerca20 = calcular({ tipoAcuifero: 'libre', distanciaPozo: 20 });
  cerca(cerca20.tHoriz, a.tHoriz / 4, 1e-9);
  // La capa de arcilla (semiconfinado) agrega el tiempo de cruzarla bajo el cauce
  cerca(calcular().tViaje, a.tHoriz + 2 / (0.005 / 0.05), 1e-9);
  // Lejos del río y con el río en época seca, el agua del río no llega
  const lejos = calcular({ distanciaPozo: 200, cotaRio: 1.9 });
  assert.equal(lejos.llega, false);
  cerca(lejos.NO3pozo, A.NO3_FONDO, 1e-12);
});

test('Pozo cerca de un río contaminado: llegan coliformes en pocos días', () => {
  const a = calcular({ materialAcuifero: 'grava', tipoAcuifero: 'libre', distanciaPozo: 10, vertTipo: 'domestica', vertZona: 'baja', Qvert: 20 });
  assert.ok(a.tViaje < A.DIAS_PROTECCION);
  assert.ok(a.CFpozo > 1);
  const avisos = a.checks.filter((c) => c.nivel === 'aviso').map((c) => c.texto);
  assert.ok(avisos.some((t) => t.startsWith('Pozo: coliformes')));
  // En el escenario base el pozo y el acuífero cumplen todo
  assert.deepEqual(calcular().checks.filter((c) => c.nivel !== 'ok'), []);
});

test('Curva de llegada: la mitad del agua del río llega en el tiempo de viaje', () => {
  cerca(A.erfc(0), 1, 1e-9);
  cerca(A.erfc(1), 0.157299, 1e-6);
  cerca(A.erfc(-1), 1.842701, 1e-6);
  cerca(A.curvaLlegada(60, 60), 0.5, 1e-9);
  assert.ok(A.curvaLlegada(60, 30) < 0.1 && A.curvaLlegada(60, 120) > 0.9);
  assert.equal(A.curvaLlegada(Infinity, 100), 0);
});
