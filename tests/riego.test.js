// Pruebas del riego: evapotranspiración, caudal de riego, zonas, cultivos, métodos
// y calidad del agua. Ejecutar con:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/modelo.js';
import * as G from '../js/riego.js';
import * as S from '../js/sistema.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtenido ${a} (tol ${tol})`);

const parametros = (cambios = {}) => ({ ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO, ...cambios });
const calcular = (cambios = {}) => S.calcular(parametros(cambios), { nivel: 4.4, bomba: true, t: 6 * 3600 });

test('Hargreaves: evapotranspiración de referencia por zona', () => {
  // Zona baja: 0.0023 × (28 + 17.8) × √9 × 14.7 = 4.645 mm/día
  cerca(G.et0Hargreaves(28, 9), 0.0023 * 45.8 * 3 * 14.7, 1e-12);
  const baja = G.climaZona('baja', 'seca');
  const alta = G.climaZona('alta', 'seca');
  cerca(baja.ET0, 4.645, 0.001);
  assert.ok(alta.ET0 < baja.ET0);                      // en la montaña hace menos calor
  assert.ok(G.climaZona('baja', 'lluviosa').ET0 < baja.ET0);
});

test('Caudal de riego: Q = N_b·A·10/(horas·3600), lineal en el área', () => {
  const n = G.necesidadRiego({ zona: 'baja', cultivo: 'banano', metodo: 'microaspersion', area: 10, horas: 12 });
  cerca(n.ETc, 1.1 * n.ET0, 1e-12);
  cerca(n.Nn, n.ETc - 0.2, 1e-12);                     // menos la lluvia efectiva
  cerca(n.Nb, n.Nn / 0.85, 1e-12);                     // dividido por la eficiencia de aplicación
  cerca(n.Q, (n.Nb * 10 * 10) / (12 * 3600), 1e-12);
  cerca(M.m3sAlps(n.Q), 13.37, 0.01);
  const doble = G.necesidadRiego({ zona: 'baja', cultivo: 'banano', metodo: 'microaspersion', area: 20, horas: 12 });
  cerca(doble.Q, 2 * n.Q, 1e-12);
  // Regar en más horas baja el caudal de diseño
  assert.ok(G.necesidadRiego({ zona: 'baja', cultivo: 'banano', metodo: 'microaspersion', area: 10, horas: 24 }).Q < n.Q);
});

test('Riego: la época de lluvias reduce las horas de riego, no el diseño', () => {
  const seca = calcular().riego;
  const lluvias = calcular({ epoca: 'lluviosa' }).riego;
  cerca(lluvias.dis.Q, seca.dis.Q, 1e-12);             // la tubería y la bomba se diseñan con la época seca
  assert.ok(lluvias.horasAct < seca.horasAct);
  assert.ok(lluvias.Vmes < seca.Vmes);
});

test('Métodos y zonas: el goteo gasta menos agua y la zona alta necesita más altura', () => {
  const p = parametros();
  const e = S.sincronizarTubos(p).Riego;
  const met = Object.fromEntries(G.compararMetodos(p, e).map((m) => [m.id, m]));
  assert.ok(met.goteo.n.Q < met.aspersion.n.Q && met.aspersion.n.Q < met.inundacion.n.Q);
  // La aspersión necesita más presión y por eso más potencia que el goteo
  assert.ok(met.aspersion.Pe > met.goteo.Pe);
  const zonas = Object.fromEntries(G.compararZonas(p, e).map((z) => [z.id, z]));
  assert.ok(zonas.alta.H > zonas.baja.H);
  assert.equal(zonas.alta.apto, false);                // el banano no se da a 1200 m
  assert.equal(zonas.baja.apto, true);
});

test('Cultivos por zona y métodos adecuados', () => {
  assert.equal(G.cultivoApto('cafe', 'alta'), true);
  assert.equal(G.cultivoApto('cafe', 'baja'), false);
  assert.equal(G.cultivoApto('pastos', 'media'), true);
  assert.equal(G.metodoAdecuado('arroz', 'inundacion'), true);
  assert.equal(G.metodoAdecuado('arroz', 'goteo'), false);
  const r = calcular({ cultivo: 'cafe' });
  assert.equal(r.riego.checks.find((c) => c.texto.includes('se da bien')).nivel, 'aviso');
});

test('Riego frente a la ciudad y calidad del agua en la toma', () => {
  const r = calcular();
  const rg = r.riego;
  // 10 ha de banano gastan al día lo de unas 595 viviendas (QMD de cada una)
  cerca(rg.viviendas, rg.dis.Vdia / (r.qMedCasa * 1.3 * 86400), 1e-9);
  cerca(rg.viviendas, 595, 1);
  // En el escenario base el riego cumple todos los criterios
  assert.deepEqual(rg.checks.filter((c) => c.nivel !== 'ok'), []);
  // Hortalizas regadas con agua de un río con aguas residuales sin tratar aguas arriba de la toma
  const sucio = calcular({ cultivo: 'hortalizas', metodoRiego: 'goteo', vertTipo: 'domestica', vertZona: 'baja', Qvert: 20 });
  const cf = sucio.riego.checks.find((c) => c.texto.startsWith('Agua de riego'));
  assert.equal(cf.nivel, 'alerta');
  // Y la estación de bombeo de riego se diseña con ese caudal y esa altura
  const b = r.bombas.riego;
  cerca(b.Q, rg.dis.Q, 1e-12);
  cerca(b.H, rg.H, 1e-9);
  cerca(rg.Emes, (b.Pe / 1000) * rg.horasAct * 30, 1e-9);
});
