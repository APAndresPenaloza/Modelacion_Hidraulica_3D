/**
 * sistema.js — Une el modelo base (modelo.js) con los criterios de diseño (diseno.js):
 * río → bocatoma → succión → bomba → ADUCCIÓN → tanque → CONDUCCIÓN → RED DE DISTRIBUCIÓN
 * → acometida → medidor → llave de paso → grifo de la vivienda de análisis.
 * Funciones puras: reciben los parámetros y el estado (nivel, bomba, hora) y devuelven
 * todos los resultados.
 */
import * as M from './modelo.js';
import * as D from './diseno.js';

export const PARAMETROS_DISENO = Object.freeze({
  // Control de la bomba por niveles
  Qbombeo: 15,                  // L/s: más que el QMD para que la bomba descanse
  controlBomba: 'automatico',   // 'automatico' (interruptores de nivel) | 'continuo' (24 h)
  nivelArranque: 3.0,           // m
  nivelParada: 4.75,            // m
  arranquesMax: 6,              // arranques por hora admisibles (referencia del motor)
  // Demanda
  curvaDemanda: 'horaria',      // 'horaria' (curva del día) | 'constante'
  k1: 1.3,                      // QMD / Qmd
  k2: 1.6,                      // QMH / QMD
  habitantes: 4,
  dotacion: 140,                // L/hab·día (dotación neta)
  perdidas: 0.25,               // pérdidas técnicas
  // Pérdidas por fricción
  metodoPerdidas: 'darcy',      // 'darcy' | 'hazen'
  // Tuberías (material, clase y diámetro comercial)
  matSuccion: 'hd', claseSuccion: 'C40', dnSuccion: 'DN 200', Lsuccion: 8,
  matAduccion: 'pvc', claseAduccion: 'RDE 21', dnAduccion: '6"',
  matConduccion: 'pvc', claseConduccion: 'RDE 21', dnConduccion: '6"',
  matPrincipal: 'pvc', clasePrincipal: 'RDE 21', dnPrincipal: '3"',
  matRamal: 'pvc', claseRamal: 'RDE 21', dnRamal: '2"',
  matAcometida: 'pead', claseAcometida: 'SDR 9', dnAcometida: '20 mm', Lacometida: 8,
  // Red de distribución
  nRamales: 3, nViviendas: 6, sepRamales: 60, sepViviendas: 15, Lentrada: 40,
  pendPrincipal: 0.004, pendRamal: 0.01,
  valvulasRamal: true, valvulaAire: true, valvulaPurga: true, hidrante: true,
  incendio: false, Qincendio: 5,  // L/s
  ramalCerrado: 0,                // 0 = todos abiertos
  casaAnalisis: 'auto',           // 'auto' = la vivienda con menos presión, o 'j-k'
  // Medidor y llave de paso de la vivienda
  medidorQmax: 3,                 // m³/h
  medidorDh: 10,                  // m de pérdida al caudal máximo del medidor
  Kllave: 0.2,
  // Zanja
  recubrimiento: 1.0, cama: 0.1, holgura: 0.25,
  // Criterios de referencia (editables; contrastar con el RAS)
  Vmin: 0.5, Vmax: 3.0, VmaxSuccion: 1.5, presionMaxRed: 60,
});

const TUBOS = ['Succion', 'Aduccion', 'Conduccion', 'Principal', 'Ramal', 'Acometida'];

/** Ajusta clase y diámetro a valores del catálogo y copia los diámetros internos al modelo base. */
export function sincronizarTubos(p) {
  const e = {};
  for (const t of TUBOS) {
    const s = D.especTubo(p[`mat${t}`], p[`clase${t}`], p[`dn${t}`]);
    p[`clase${t}`] = s.clase;
    p[`dn${t}`] = s.dn;
    e[t] = s;
  }
  p.Daduccion = e.Aduccion.DI;
  p.Ddistribucion = e.Conduccion.DI;
  p.nivelParada = Math.min(p.nivelParada, p.hMax);
  p.nivelArranque = Math.min(p.nivelArranque, p.nivelParada - 0.2);
  const N = Math.round(p.nRamales);
  const K = Math.round(p.nViviendas);
  if (p.ramalCerrado > N) p.ramalCerrado = 0;
  if (p.casaAnalisis !== 'auto') {
    const [j, k] = p.casaAnalisis.split('-').map(Number);
    if (!(j >= 1 && j <= N && k >= 1 && k <= K)) p.casaAnalisis = 'auto';
  }
  return e;
}

function revisar(lista, texto, cumple, detalle, nivelFalla = 'alerta') {
  lista.push({ texto, nivel: cumple ? 'ok' : nivelFalla, detalle });
}

/**
 * Calcula todo el sistema en un instante.
 * estado: { nivel [m], bomba (encendida), t [s desde el día 1 a las 00:00] }
 */
export function calcular(p, estado) {
  const e = sincronizarTubos(p);
  const { nivel } = estado;
  const hora = ((estado.t / 3600) % 24 + 24) % 24;
  const bomba = D.controlBomba(p, nivel, estado.bomba);
  const met = p.metodoPerdidas;
  const conTubos = {
    rugAduccion: e.Aduccion.rugosidad, CAduccion: e.Aduccion.C,
    rugDistribucion: e.Conduccion.rugosidad, CDistribucion: e.Conduccion.C,
  };

  // Demanda del sector: el control deslizante es el QMD; la curva lo reparte en el día
  const factor = p.curvaDemanda === 'horaria' ? D.factorConsumo(hora, p.k2) : 1;
  const QsalDem = D.caudalSalida(p, hora);
  const demanda = D.caudalesDiseno(M.lpsAm3s(p.Qdemanda) / p.k1, p.k1, p.k2);
  const regulacion = D.volumenRegulacion(demanda.QMD, p.k2);

  // Diseño (bomba funcionando) y estado actual
  const dis = M.calcularSistema({ ...p, ...conTubos, Qdemanda: M.m3sAlps(QsalDem) }, nivel);
  const Qb = M.lpsAm3s(p.Qbombeo);
  const Qin = bomba ? Qb : 0;
  const vacio = nivel <= 1e-6;
  const lleno = nivel >= p.hMax - 1e-6;
  const Qsal = vacio ? Math.min(QsalDem, Qin) : QsalDem;
  const Qent = lleno ? Math.min(Qin, Qsal) : Qin;
  const rebose = lleno && Qin > Qsal ? Qin - Qsal : 0;
  const At = dis.At;

  // Succión y aducción (con la bomba encendida)
  const succion = D.tramo(Qb, p.Lsuccion, e.Succion, met);
  const aduccion = D.tramo(Qb, p.Laduccion, e.Aduccion, met);
  // Altura dinámica en este instante (con el nivel actual del tanque)
  const hfBombeo = aduccion.hfReal + succion.hfReal;
  const Hb = M.alturaBombeo(p.cotaRio, p.cotaTanque, nivel, hfBombeo);
  const potencia = M.potenciaBomba(Qb, Hb, p.eficiencia);
  // Costo mensual: con el ciclo completo de la bomba y la altura dinámica media, no con
  // el nivel de este instante (si no, bajaría cuando la bomba se apaga y subiría al prenderse)
  const mes = D.costoMensual(p, hfBombeo);
  const { ciclo, horasDia, Vmes, costo } = mes;
  const golpe = D.golpeAriete(aduccion.V, e.Aduccion);

  // Conducción (tanque → entrada del barrio) con el caudal actual
  const conduccion = D.tramo(Qsal, p.Ldistribucion, e.Conduccion, met);
  const Hentrada = p.cotaTanque + nivel - conduccion.hfReal;
  const Hestatica = p.cotaTanque + p.hMax;

  // Red: instante actual y peor caso de diseño (QMH con el tanque en el nivel de arranque)
  const qMedCasa = D.caudalMedioVivienda(p.habitantes, p.dotacion, p.perdidas);
  const qCasaAhora = qMedCasa * p.k1 * factor;
  const qCasaQMH = qMedCasa * p.k1 * p.k2;
  const nivelMin = p.controlBomba === 'automatico' ? p.nivelArranque : 0.5;
  const conDis = D.tramo(M.lpsAm3s(p.Qdemanda) * p.k2 + (p.hidrante && p.incendio ? M.lpsAm3s(p.Qincendio) : 0), p.Ldistribucion, e.Conduccion, met);
  const redDiseno = D.calcularRed(p, p.cotaTanque + nivelMin - conDis.hfReal, Hestatica, qCasaQMH);
  let red = D.calcularRed(p, Hentrada, Hestatica, qCasaAhora);
  const idAnalisis = p.casaAnalisis === 'auto' ? red.critica.id : p.casaAnalisis;
  let casa = red.casas.find((c) => c.id === idAnalisis) || red.critica;
  let grifo = D.grifoConAcometida(p, casa.Hn, casa.cota + p.alturaGrifo, e.Acometida, met);
  red = D.calcularRed(p, Hentrada, Hestatica, qCasaAhora, { casa: casa.id, q: Math.max(qCasaAhora, grifo.q) });
  casa = red.casas.find((c) => c.id === casa.id);
  grifo = casa.cerrada
    ? { q: 0, H: 0, hf: 0, hm: 0, hl: 0 }
    : D.grifoConAcometida(p, casa.Hn, casa.cota + p.alturaGrifo, e.Acometida, met);

  const Hcasa = grifo.H;
  const vGrifo = M.velocidadGrifo(Hcasa, p.apertura, p.K0);
  const qGrifo = vGrifo * M.areaCircular(p.dBoquilla);
  const Hnodo = casa.presion;

  let estadoServicio = 'normal';
  if (Hcasa <= 0) estadoServicio = 'sin-agua';
  else if (vacio && QsalDem > Qin) estadoServicio = 'deficit';
  else if (Hnodo < p.presionMinima) estadoServicio = 'baja-presion';

  // Revisión de criterios de diseño
  const checks = [];
  const rango = (V) => V >= p.Vmin && V <= p.Vmax;
  revisar(checks, `Succión: velocidad ${succion.V.toFixed(2)} m/s ≤ ${p.VmaxSuccion} m/s`, succion.V <= p.VmaxSuccion, 'Una succión lenta evita que la bomba cavite.', 'aviso');
  revisar(checks, `Aducción: velocidad ${aduccion.V.toFixed(2)} m/s entre ${p.Vmin} y ${p.Vmax} m/s`, rango(aduccion.V), 'Menos de la mínima sedimenta; más de la máxima erosiona y aumenta el golpe de ariete.', 'aviso');
  revisar(checks, `Aducción: presión de operación ${Hb.toFixed(1)} m ≤ presión de trabajo ${e.Aduccion.pnMca.toFixed(0)} m (${e.Aduccion.clase})`, Hb <= e.Aduccion.pnMca, 'La bomba entrega su altura dinámica a la salida.');
  revisar(checks, `Aducción: con golpe de ariete ${(Hb + golpe.dH).toFixed(1)} m ≤ ${e.Aduccion.pnMca.toFixed(0)} m`, Hb + golpe.dH <= e.Aduccion.pnMca, `Paro brusco de la bomba: ΔH = a·V/g = ${golpe.dH.toFixed(1)} m. Si no cumple: clase de mayor presión, cierre lento o válvula anticipadora.`, 'aviso');
  revisar(checks, `Conducción: velocidad con el QMH ${conDis.V.toFixed(2)} m/s entre ${p.Vmin} y ${p.Vmax} m/s`, rango(conDis.V), 'La conducción se diseña con el caudal máximo horario.', 'aviso');
  const estCond = Hestatica - p.cotaCasa;
  revisar(checks, `Conducción: presión estática ${estCond.toFixed(1)} m ≤ ${e.Conduccion.pnMca.toFixed(0)} m (${e.Conduccion.clase})`, estCond <= e.Conduccion.pnMca, 'Con el tanque lleno y sin flujo.');
  revisar(checks, `Red: presión mínima con QMH ${redDiseno.presionMin.toFixed(1)} m.c.a. ≥ ${p.presionMinima} m.c.a.`, redDiseno.presionMin >= p.presionMinima, `Peor caso: hora pico y tanque en ${nivelMin.toFixed(2)} m.`);
  revisar(checks, `Red: presión estática máxima ${redDiseno.estaticaMax.toFixed(1)} m.c.a. ≤ ${p.presionMaxRed} m.c.a.`, redDiseno.estaticaMax <= p.presionMaxRed, 'Presiones altas aumentan las fugas y dañan las instalaciones internas.', 'aviso');
  revisar(checks, `Red: presión estática ≤ presión de trabajo de la principal (${e.Principal.pnMca.toFixed(0)} m) y de los ramales (${e.Ramal.pnMca.toFixed(0)} m)`,
    redDiseno.estaticaMax <= Math.min(e.Principal.pnMca, e.Ramal.pnMca), 'Clase de presión de la tubería.');
  revisar(checks, `Red: velocidad máxima ${redDiseno.Vmax.toFixed(2)} m/s ≤ ${p.Vmax} m/s`, redDiseno.Vmax <= p.Vmax, 'En redes pequeñas la velocidad suele ser baja; por eso se revisa también con el caudal del hidrante.', 'aviso');
  revisar(checks, `Acometida: presión estática ${(Hestatica - casa.cota).toFixed(1)} m ≤ ${e.Acometida.pnMca.toFixed(0)} m (${e.Acometida.clase})`, Hestatica - casa.cota <= e.Acometida.pnMca, 'Tubería de servicio de la vivienda.');
  revisar(checks, 'Válvula de aire en el punto alto de la red', p.valvulaAire, 'Saca el aire atrapado, que reduce la sección y provoca golpes.', 'aviso');
  revisar(checks, 'Válvula de purga en el punto bajo de la red', p.valvulaPurga, 'Permite lavar y vaciar la red.', 'aviso');
  revisar(checks, 'Válvulas de compuerta para aislar cada ramal', p.valvulasRamal, 'Sin ellas, una reparación deja sin agua a todo el barrio.', 'aviso');
  if (p.curvaDemanda === 'horaria') {
    revisar(checks, `Tanque: volumen útil ${(At * p.hMax).toFixed(0)} m³ ≥ volumen de regulación ${regulacion.V.toFixed(0)} m³`, At * p.hMax >= regulacion.V, 'Con el QMD entrando parejo, el tanque guarda lo que sobra de noche y lo entrega en las horas pico.');
  }
  revisar(checks, `Bombeo ${p.Qbombeo.toFixed(2)} L/s ≥ QMD ${p.Qdemanda.toFixed(2)} L/s`, p.Qbombeo >= p.Qdemanda, 'Si se bombea menos que el consumo máximo diario, el tanque termina vacío.');
  if (p.controlBomba === 'automatico') {
    revisar(checks, `Bomba: ${ciclo.arranquesHora.toFixed(1)} arranques por hora ≤ ${p.arranquesMax}`, ciclo.arranquesHora <= p.arranquesMax, 'Muchos arranques calientan el motor; se separan más los niveles de arranque y parada.', 'aviso');
  }

  const cantidades = D.cantidadesRed(p, redDiseno, e.Acometida);

  return {
    ...dis,
    Qin, Qsal, Qent, rebose, vacio, lleno, At,
    bomba, hora, factor, QsalDem,
    succion, aduccion, alturaBombeo: Hb, potencia, Vmes, costo, horasDia, ciclo, golpe,
    hfBombeo, Hmedia: mes.Hmedia, nivelMedio: mes.nivelMedio, potenciaMedia: mes.potencia, alcanza: mes.alcanza,
    distribucion: conduccion, conduccion, Hentrada, Hestatica,
    red, redDiseno, casa, grifo, Hnodo,
    Hcasa, presionCasa: M.mcaAkPa(Math.max(0, Hcasa)), vGrifo, qGrifo,
    alcance: M.alcanceChorro(p.alturaGrifo, vGrifo),
    pendienteNivel: (Qent - Qsal) / At,
    tLleno: M.tiempoHastaNivel(nivel, p.controlBomba === 'automatico' ? p.nivelParada : p.hMax, Qent, Qsal, At),
    tVacio: M.tiempoHastaNivel(nivel, p.controlBomba === 'automatico' && !bomba ? p.nivelArranque : 0, Qent, Qsal, At),
    estado: estadoServicio,
    demanda, qMedCasa, qCasaQMH, regulacion, checks, cantidades, especs: e,
  };
}
