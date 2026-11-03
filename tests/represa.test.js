// Pruebas de la represa: embalse (V = a·h²), operación, central (P = ρgQH_nη),
// pérdidas de la línea, caudal en las tres zonas, un año mes a mes y costos.
// Ejecutar con:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/modelo.js';
import * as R from '../js/rio.js';
import * as P from '../js/represa.js';
import * as S from '../js/sistema.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtenido ${a} (tol ${tol})`);
const base = { ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO };
const calcular = (cambios = {}, estado = {}) =>
  S.calcular({ ...base, ...cambios }, { nivel: 4.4, bomba: true, t: 6 * 3600, ...estado });

test('Embalse: el volumen crece con el cuadrado del nivel y el área es su derivada', () => {
  cerca(P.volumen(38), 6579 * 38 * 38, 1e-6);            // 9.5 millones de m³ con el nivel máximo
  cerca(P.volumen(38) / 1e6, 9.5, 0.001);
  cerca(P.nivelDeVolumen(P.volumen(23.4)), 23.4, 1e-9);   // h = √(V/a) es la inversa
  const h = 30;
  const dVdh = (P.volumen(h + 1e-4) - P.volumen(h - 1e-4)) / 2e-4;
  cerca(P.areaEspejo(h), dVdh, 1e-3);                     // A = dV/dh = 2·a·h
  cerca(P.volumen(2 * h) / P.volumen(h), 4, 1e-12);       // el doble de nivel guarda cuatro veces más
  assert.equal(P.nivelMaximo(40), 38);
  cerca(P.nivelMinimo(40), 14, 1e-12);
});

test('Filo de agua: la represa suelta lo que entra y el río y el acueducto no cambian', () => {
  const r = calcular();
  const rep = r.represa;
  cerca(rep.Qin, 0.25 * R.caudalRio(2.5).Q, 1e-12);
  cerca(rep.Qsale, rep.Qin, 1e-12);
  assert.equal(rep.dQ, 0);
  cerca(r.rio.boc.Q, R.caudalRio(2.5).Q, 1e-9);
  assert.equal(Math.round(r.costo.costo), 5006231);      // el costo de bombeo de siempre
  assert.equal(r.revisionTotal.length, 60);
  assert.ok(r.revisionTotal.every((c) => c.nivel === 'ok'));
});

test('Central: P = ρ·g·Q·H_n·η con la pérdida de la tubería forzada', () => {
  const r = calcular();
  const rep = r.represa;
  const y = M.tiranteNormal(rep.Qsale, R.ZONAS.alta.cauce.ancho, R.ZONAS.alta.cauce.pendiente, R.ZONAS.alta.cauce.n, 0);
  const Hn = 36 - y - 0.5 * rep.Qturb ** 2;
  cerca(rep.Hn, Hn, 1e-9);
  cerca(rep.P, M.RHO * M.G * rep.Qturb * Hn * 0.85, 1e-6);
  cerca(rep.P / 1000, 455.6, 0.1);                        // unos 456 kW con el río normal
  cerca(rep.Emes, (rep.P / 1000) * 720, 1e-6);
  // Con más caudal la pérdida crece con Q²: la potencia tiene un máximo (función cúbica)
  const Pq = (Q) => P.central(Q, 36, Q, 0.85).P;
  assert.ok(Pq(4.5) > Pq(3) && Pq(4.5) > Pq(7));
});

test('Línea: las pérdidas crecen con el cuadrado de la corriente; más tensión, menos pérdidas', () => {
  const Pw = 455600;
  const a = P.perdidasLinea(Pw, 13.2);
  const b = P.perdidasLinea(Pw, 34.5);
  cerca(a.I, Pw / (Math.sqrt(3) * 13200 * 0.95), 1e-9);
  cerca(a.perdidas, 3 * a.I ** 2 * 0.3 * 40, 1e-6);
  cerca(a.perdidas / b.perdidas, (34.5 / 13.2) ** 2, 1e-9);
  const c = P.perdidasLinea(2 * Pw, 34.5);
  cerca(c.perdidas / b.perdidas, 4, 1e-9);                // el doble de potencia, cuatro veces las pérdidas
  cerca(calcular({ tensionLinea: 13.2 }).represa.linea.fraccion, 0.0348, 0.0005);
});

test('Operación: guardar agua baja el río aguas abajo y soltar un caudal fijo lo sube', () => {
  const Qnat = R.caudalRio(2.5).Q;
  const guardar = calcular({ operacionPresa: 'guardar' });
  cerca(guardar.represa.Qsale, guardar.represa.Qamb, 1e-12);
  cerca(guardar.rio.boc.Q, Qnat + guardar.represa.dQ, 1e-6);
  assert.ok(guardar.cotaRioEf < 2.5 && guardar.cotaRioNatural === 2.5);
  assert.ok(guardar.represa.pendienteNivel > 0);          // el embalse sube
  const fijo = calcular({ operacionPresa: 'fijo', Qpresa: 3 });
  cerca(fijo.represa.dQ, 3 - fijo.represa.Qin, 1e-12);
  for (const z of ['alta', 'media', 'baja']) {
    const zz = fijo.represa.zonas[z];
    cerca(zz.conRepresa - zz.natural, fijo.represa.dQ, 1e-12);   // el mismo caudal extra en las tres zonas
  }
  assert.ok(fijo.represa.pendienteNivel < 0);             // el embalse baja
});

test('Límites: lleno vierte lo que entra; en el mínimo no puede soltar más de lo que entra', () => {
  const lim = { Qin: 1.5, Qfijo: 3, Qamb: 0.4, hMin: 14, hMax: 38 };
  assert.equal(P.caudalSalida('guardar', { ...lim, h: 38 }), 1.5);
  assert.equal(P.caudalSalida('fijo', { ...lim, h: 14 }), 1.5);
  assert.equal(P.caudalSalida('fijo', { ...lim, h: 20 }), 3);
  const lleno = calcular({ operacionPresa: 'guardar' }, { nivelEmbalse: 38 }).represa;
  assert.ok(lleno.llena);
  cerca(lleno.Qsale, lleno.Qin, 1e-12);
  assert.ok(calcular({}, { nivelEmbalse: 10 }).represa.Qturb === 0);   // bajo el mínimo la central para
});

test('Un año mes a mes: el balance respeta los niveles máximo y mínimo', () => {
  const filo = P.simularAno(base, 36);
  assert.equal(filo.meses.length, 12);
  for (const m of filo.meses) cerca(m.h, 36, 1e-9);
  cerca(filo.Eano, filo.meses.reduce((s, m) => s + m.E, 0), 1e-6);
  const guardar = P.simularAno({ ...base, operacionPresa: 'guardar' }, 14);
  assert.ok(guardar.meses.every((m) => m.h <= 38 + 1e-9));
  assert.ok(guardar.meses[11].h > 14);
  const fijo = P.simularAno({ ...base, operacionPresa: 'fijo', Qpresa: 4 }, 36);
  assert.ok(fijo.meses.every((m) => m.h >= 14 - 1e-9));   // se vacía hasta el mínimo y ahí suelta lo que entra
  cerca(fijo.meses[2].Qout, fijo.meses[2].Qin, 1e-9);
  // En la época seca un caudal fijo de 2 m³/s sube el río de la bocatoma
  const dos = P.simularAno({ ...base, operacionPresa: 'fijo', Qpresa: 2 }, 36);
  assert.ok(dos.meses[1].bocConRepresa > dos.meses[1].bocNatural);
});

test('Costos de operación: producir, llevar a la ciudad y el agua por gravedad', () => {
  const r = calcular();
  const rep = r.represa;
  cerca(rep.costoPuesto, (50 * rep.Emes) / rep.Eent + 15, 1e-9);
  cerca(rep.costoPuesto, 65.26, 0.01);
  cerca(rep.viviendas, rep.Eent / 173, 1e-9);
  cerca(rep.agua.red, r.costo.costo, 1e-9);
  cerca(rep.agua.represa, r.costo.energia * rep.costoPuesto, 1e-6);
  cerca(rep.agua.gravedad, r.Vmes * 30, 1e-6);
  cerca(rep.desnivel, 1250 + 36 - base.cotaTanque, 1e-9);
  assert.equal(rep.camaras, Math.ceil(rep.desnivel / 100) - 1);
});
