# Simulador hídrico 3D de Santa Marta

Aplicación web interactiva que simula el abastecimiento de agua de un sector de Santa Marta (río → bocatoma y desarenador → bombeo → aducción → tanque → conducción → red de distribución → acometida y grifo de una vivienda) y la capacidad de un arroyo canalizado durante una crecida. El río corre casi lleno entre orillas bajas; el agua entra por la rejilla de una bocatoma lateral, deja la arena en un desarenador y pasa al pozo de succión de la bomba. El arroyo corre por un canal trapezoidal de concreto excavado bajo el nivel de la calle, con andenes, barandas, compuerta y pozo de disipación.

La escena muestra el régimen del flujo: en las tuberías las partículas se mueven con el perfil de velocidad (parabólico en laminar, casi plano en turbulento) y un hilo de tinta sigue recto o se mezcla. La pestaña Tuberías incluye una animación del experimento de Reynolds con un tubo de vidrio cuyo diámetro y velocidad se pueden cambiar. La pestaña Datos guarda la información de la simulación en un libro de Excel.

Además del acueducto, el simulador modela la cuenca. La lluvia lo mueve todo: la de los últimos 30 días fija el caudal del río y su sedimento, la del año (normal, con El Niño o con La Niña) decide cuánto se riega, cuánta energía da la represa y si la bocatoma se queda sin agua, y una tormenta puede desbordar el arroyo, sacar el río a la vega, mover las laderas o bajar una avenida torrencial por una quebrada; el simulador da el nivel de alerta (verde, amarilla, naranja o roja). El río sube y se enturbia con las lluvias, un vertimiento de aguas residuales le quita oxígeno y le agrega bacterias y nitratos que siguen río abajo por las zonas alta, media y baja y llegan al acuífero, y en la zona que se elija un cultivo se riega con su propia tubería y su propia bomba. En la zona alta una represa forma un embalse: guarda o suelta agua (y con eso cambia el caudal de las tres zonas), su central produce energía que una línea lleva a la ciudad, y una tubería puede bajar el agua del embalse por gravedad. Se calcula la huella hídrica (verde, azul y gris) de cada cultivo, la huella de carbono de llevar la cosecha a la ciudad y lo que se pierde cuando la creciente del río o el desborde del arroyo inundan el lote. Bajo el valle, en las tres zonas, el agua subterránea se mueve entre el río y el pozo de una finca. Las estaciones de bombeo se diseñan con su potencia hidráulica, al freno y eléctrica, el motor comercial que se instala y el tipo de bomba que conviene.

La escena 3D va del nacimiento del río al mar y tiene cinco vistas (Ciudad, Cuenca, Represa, Cultivo y Acuífero); al cambiar de pestaña, la cámara va sola a la vista que corresponde.

El panel tiene catorce pestañas, en dos filas: Lluvia, Río, Represa, Captación, Bombas, Tuberías, Tanque, Red, Vivienda, Riego, Huella, Acuífero, Arroyo y Datos. En la barra de arriba, el primer indicador es el nivel de alerta por la lluvia.

Proyecto final de Álgebra y Geometría Analítica, 2026-II. Línea de investigación: Hidráulica de Canales Abiertos y Redes de Acueducto.

## Estructura

```
index.html            Página principal
css/styles.css        Estilos (modo claro y oscuro, adaptable a móvil)
js/modelo.js          Núcleo matemático: solo funciones puras, sin gráficos
js/escena3d.js        Escena 3D con Three.js
js/graficas.js        Gráficas con Chart.js
js/diseno.js          Diseño: catálogo de tuberías, demanda horaria, control de la bomba, golpe de ariete, red ramificada, zanja y cantidades
js/sistema.js         Une el modelo y el diseño en un solo cálculo del sistema, con la revisión de criterios
js/lluvia.js          Lluvia: clima del año (El Niño y La Niña), lluvia–caudal, curva IDF, arroyo (método racional), deslizamientos, avenida torrencial, sequía y nivel de alerta
js/rio.js             Río y cuenca: curva de descarga, sedimentos, vertimientos (mezcla y Streeter-Phelps), infiltración y vulnerabilidad GOD
js/acuifero.js        Agua subterránea: capas, río que gana o pierde agua (Darcy), cono del pozo (Thiem y Sichardt), tiempo de viaje y calidad del pozo
js/bombas.js          Estaciones de bombeo: potencias, motor comercial, tipos de bomba, curvas, punto de operación y NPSH
js/riego.js           Riego: evapotranspiración (Hargreaves), cultivos, métodos de riego, caudal, tubería y comparación con la ciudad
js/represa.js         Represa: embalse (V = a·h²), operación y balance, central (P = ρgQH_nη), pérdidas de la línea, costos y un año mes a mes
js/huella.js          Huella hídrica verde, azul y gris de los cultivos, CO₂ del transporte a la ciudad y daño por inundación
js/reynolds.js        Animación del experimento de Reynolds (laminar, transición, turbulento)
js/datos.js           Registro de la simulación, escenarios y armado del libro de Excel
js/excel.js           Escritor de archivos .xlsx (XML + ZIP con compresión DEFLATE), sin librerías
js/app.js             Controles, tiempo simulado, métricas, plano de la red, ecuaciones y pestaña Datos
lib/                  Three.js 0.170 y Chart.js 4.4 (copias locales, licencia MIT)
tests/modelo.test.js  Pruebas del modelo con valores calculados a mano
tests/diseno.test.js  Pruebas del diseño (catálogo, demanda, bomba, costo mensual, red, sistema completo)
tests/excel.test.js   Pruebas del archivo de Excel (se descomprime con zlib y se revisa)
tests/rio.test.js     Pruebas del río (Manning, captación, mezcla, Streeter-Phelps, sedimentos, acuífero)
tests/bombas.test.js  Pruebas de las bombas (potencias, motor, curvas, paralelo, NPSH, tipos)
tests/riego.test.js   Pruebas del riego (Hargreaves, caudal, épocas, métodos, zonas, calidad del agua)
tests/acuifero.test.js Pruebas del agua subterránea (capas, Darcy, Thiem, tiempo de viaje, curva de llegada, tres zonas)
tests/represa.test.js Pruebas de la represa (embalse, operación, central, línea, límites, año mes a mes, costos)
tests/huella.test.js  Pruebas de la huella hídrica, del carbono del transporte y de la inundación del lote
tests/lluvia.test.js  Pruebas de la lluvia (lluvia–caudal, El Niño y La Niña, curva IDF, arroyo, deslizamientos, avenida, alertas)
```

Las librerías van incluidas en `lib/` y el Excel se genera con código propio, así que el simulador no depende de ningún CDN.

## Objetos matemáticos del simulador

| Requisito | Dónde se aplica | Función en `modelo.js` |
|---|---|---|
| Decimales | Cotas, caudales en L/s, áreas, volumen del tanque, presión en m.c.a. y kPa | `redondear`, `areaCircular`, `volumenTanque`, `cargaDisponible` |
| Ecuación lineal | Pérdida laminar h_f = k·Q (Hagen-Poiseuille) | `perdidaLaminar` |
| Ecuación lineal | Nivel del tanque h(t) = h₀ + m·t | `nivelTanque`, `tiempoHastaNivel` |
| Ecuación lineal | Costo de bombeo C(V) = m·V + b, con la altura dinámica media del ciclo | `costoBombeo` (y `costoMensual` en `diseno.js`) |
| Ecuación cuadrática | Área del canal trapezoidal con perímetro y talud fijos A(b) = ((z−k)/k²)b² + (P(k−2z)/k²)b + zP²/k², k = 2√(1+z²), y su vértice | `areaCanal`, `seccionOptima` |
| Ecuación cuadrática | Trayectoria del chorro y(x) = −(g/2v²)x² + h₀ | `trayectoriaChorro`, `alcanceChorro` |
| Ecuación cuadrática | Velocidad de salida del grifo ((1+K)/2g)v² − H = 0 | `velocidadGrifo` |
| Decimales | Velocidad horizontal V_h = Q/(B·h), tiempo de paso y carga superficial q = Q/(B·L) del desarenador | `velocidadHorizontal`, `tiempoRetencion`, `cargaSuperficial` |
| Ecuación cuadrática | Ley de Stokes v_s = K·d²; grano más fino retenido: raíz de K·d² − q = 0 | `velocidadSedimentacion`, `diametroMinimoRetenido` |
| Ecuación cuadrática | Perfil laminar u(r) = 2V(1 − r²/R²): vértice en el eje, raíces en la pared | `velocidadLaminar` |
| Decimales | Número de Reynolds en tuberías (ρVD/μ) y en el canal (ρVR/μ, con el radio hidráulico) | `reynoldsVelocidad`, `reynoldsCanal` |
| Decimales | Curva de descarga del río Q = (1/n)·A·R^(2/3)·S^(1/2) y mezcla de un vertimiento C = (Q_r·C_r + Q_v·C_v)/(Q_r + Q_v) | `caudalRio`, `mezcla` (en `rio.js`) |
| Función exponencial | Decaimiento de la DBO y de los coliformes L = L₀·e^(−k_d·t) y déficit de oxígeno de Streeter-Phelps | `perfilCalidad`, `puntoCritico` (en `rio.js`) |
| Decimales | Potencias de la bomba P_h = ρgQH, P_b = P_h/η_b, P_e = P_b/η_m y velocidad específica n_q = n·√Q/H^0.75 | `disenarBomba`, `velocidadEspecifica` (en `bombas.js`) |
| Ecuación cuadrática | Punto de operación: H₀ − a(Q/N)² = H_est + K·Q² | `puntoOperacion` (en `bombas.js`) |
| Ecuación lineal | Caudal de riego Q = N_b·A·10/(horas·3600), lineal en el área | `necesidadRiego` (en `riego.js`) |
| Ecuación lineal | Ley de Darcy: velocidad del agua subterránea v = K·i/n_e, con el gradiente i = Δh/L | `calcularAcuifero` (en `acuifero.js`) |
| Función logarítmica | Cono de abatimiento de Thiem s(r) = Q/(2πT)·ln(R/r), con el radio de Sichardt R = 3000·s·√K | `conoAbatimiento`, `abatimientoEn` (en `acuifero.js`) |
| Ecuación cuadrática | Tiempo de viaje del río al pozo t = π·b·n_e·L²/Q: a la mitad de la distancia, la cuarta parte del tiempo | `calcularAcuifero` (en `acuifero.js`) |

Con caudales reales de acueducto el flujo es turbulento, de modo que la recta laminar subestima la pérdida; para la presión de la vivienda se usa Darcy-Weisbach (Swamee-Jain). Esa diferencia se muestra en la pestaña Tuberías. Con caudales muy pequeños (por ejemplo 0.1 L/s en la aducción) el flujo pasa a laminar y la escena lo muestra.

## Tramos del sistema

- **Aducción**: de la bomba al tanque, a presión. Se revisa la velocidad, la presión de operación y el golpe de ariete por paro de la bomba.
- **Conducción**: del tanque a la entrada del barrio. Lleva el caudal de todo el sector y se diseña con el caudal máximo horario.
- **Red de distribución**: tubería principal, ramales con válvula de compuerta y caja, válvula de aire en el punto alto, válvula de purga en el punto bajo, hidrante al final de la principal y, en cada vivienda, la conexión domiciliaria (abrazadera de toma, tubería de servicio, llave de paso, medidor y caja portamedidor).

## Caudales de diseño

| Símbolo | Nombre | Cálculo |
|---|---|---|
| Qmd | Caudal medio diario | habitantes · dotación / (1 − pérdidas) / 86 400 |
| QMD | Caudal máximo diario | k1 · Qmd (con él se bombea y se diseña la aducción) |
| QMH | Caudal máximo horario | k2 · QMD (con él se diseñan la conducción y la red) |

El consumo sigue una curva horaria con promedio igual al QMD y pico igual al QMH (`factoresHorarios`). Cuando el consumo está por debajo del QMD el tanque sube y cuando está por encima baja; el volumen de regulación es la diferencia entre el máximo y el mínimo de la curva de masa (`volumenRegulacion`).

## Control de la bomba

Dos interruptores de nivel controlan la bomba: se apaga al llegar al nivel de parada y vuelve a arrancar cuando el agua baja al nivel de arranque. `avanzarTanque` integra el nivel por tramos rectos y corta el paso justo en cada interruptor, así que el nivel dibuja un diente de sierra. `cicloBomba` da el tiempo encendida y apagada, las horas de bombeo al día y los arranques por hora. En la escena, una luz verde o roja en la bomba y dos flotadores en el tanque muestran el estado.

## Lluvia y desastres (pestaña Lluvia)

- **Lluvia–caudal** (función lineal): Q = f_sub·Q_sub + K·(P₃₀ + a·P_t), con K = c·A/2592 para una cuenca de 400 km² y c = 0.35 (0.054 m³/s por cada mm caído en 30 días). Con 75 mm en 30 días (900 mm al año) el río lleva los 6.35 m³/s de la condición normal (cota 2.50 m); el resto lo pone el agua subterránea (2.30 m³/s). El estado del río sigue siendo su cota: la lluvia que la explica sale con la ecuación inversa, así que los escenarios de antes dan los mismos resultados.
- **Clima del año**: con El Niño llueve 40 % menos y el acuífero aporta 25 % menos al río; con La Niña llueve 50 % más. El año mes a mes (régimen bimodal del Caribe, con la lluvia media de Santa Marta de 1991–2020) muestra que con El Niño la bocatoma no capta en febrero y marzo, y que con La Niña el río se sale a la vega de septiembre a noviembre. El clima cambia también el riego (lluvia efectiva), el color de la huella hídrica (más azul con El Niño), la energía de la represa y la recarga del acuífero.
- **Tormenta** (curva intensidad–duración–frecuencia): lluvia de 24 h con la distribución de Gumbel, P₂₄ = M·(1 + c_v·K_T), y las duraciones cortas con la regla de Dyck y Peschke, P(D) = P₂₄·(D/1440)^0.25. Se elige el período de retorno (2 a 100 años), la duración y dónde cae (toda la cuenca, la montaña, el piedemonte o la ciudad). M = 75 mm y c_v = 0.40 son valores de referencia: se cambian por los de la estación del IDEAM.
- **Arroyo**: método racional Q = C·i·A/3.6 con el tiempo de concentración de Kirpich; la cuenca urbana es la que da la crecida de diseño del canal (8 m³/s) con la tormenta de 2 años. La de 100 años da 19.31 m³/s y desborda el canal (18.66 m³/s).
- **Deslizamientos**: umbral de lluvia del trópico húmedo de Larsen y Simon (1993), I = 91.46·D^−0.82, que baja cuando el suelo viene húmedo de los 30 días anteriores.
- **Avenida torrencial**: una quebrada de montaña de 4.5 km² con índice de Melton 0.68 (flujo de detritos): si la tormenta cae en la montaña por encima del umbral, el lodo, las rocas y los troncos suben el caudal a Q_agua/(1 − C_v), y la onda tarda unas 3 h en llegar a la bocatoma (el tiempo para avisar).
- **Alerta**: roja si una amenaza ya ocurre (creciente del río sobre la vega, desborde del arroyo, deslizamientos, avenida o sequía en la bocatoma), naranja si es probable (tormenta de 10 años o más, laderas cerca del umbral, año de El Niño o La Niña), amarilla para estar atentos y verde sin amenazas. El mapa de amenazas de la pestaña y la escena 3D muestran dónde está cada una.
- **Escenarios**: además de los cinco de antes (el aguacero trae ahora una tormenta de 10 años y la creciente extraordinaria, una de 100 años), hay tres nuevos: sequía de El Niño, temporada de lluvias con La Niña y tormenta en la montaña (avenida torrencial).

## Río y vertimientos (pestaña Río)

- **Nivel y caudal**: la cota de la lámina en la bocatoma da el caudal con la curva de Manning de un cauce de 10 m de ancho (6.35 m³/s en la cota base de 2.50 m). Los escenarios de lluvia (seca, normal, temporada de lluvias, aguacero y creciente extraordinaria) fijan la cota y el sedimento; los dos se pueden mover a mano. El control es el río natural: si la represa guarda o suelta agua, la cota en la bocatoma se recalcula con la curva de descarga inversa. Por encima de la cota 3.20 m el río se sale a la vega donde está el cultivo de la llanura. Si el río baja de la cota 1.75 m (0.15 m sobre el fondo de la rejilla), la bocatoma no capta y la bomba se detiene.
- **Sedimento**: el que entra con el bombeo se reparte por tamaños; el desarenador retiene desde el grano que da la ley de Stokes y con eso se calcula cada cuántos días hay que limpiar la tolva.
- **Zonas**: alta (montaña, 1 200 m, km 0 a 15), media (piedemonte, 400 m, km 15 a 35) y baja (llanura y ciudad, 20 m, km 35 a 50). Cada una tiene su caudal, su sección, su temperatura y su reaireación (O'Connor y Dobbins).
- **Vertimiento**: aguas domésticas tratadas o sin tratar, aguas mieles del café o escorrentía agrícola, en la zona alta, media, baja (antes de la bocatoma) o después de la ciudad. Se mezcla por balance de masa y luego la DBO y los coliformes decaen y el oxígeno sigue la ecuación de Streeter-Phelps, paso a paso cada 100 m, con afluentes limpios en cada cambio de zona. El panel muestra el perfil del río coloreado por el oxígeno, la tabla de las tres zonas y las gráficas de oxígeno, DBO y coliformes (escala logarítmica).
- **Hacia el acuífero**: el río de la zona baja lo recarga; el tiempo en llegar al nivel freático se calcula con Darcy (t = d·n_e/K), los coliformes mueren y se filtran en el suelo, los nitratos llegan completos y la vulnerabilidad se califica con el índice GOD. Lo que pasa después, bajo tierra, está en la pestaña Acuífero.

Valores de referencia de calidad (editables): coliformes fecales ≤ 2 000 NMP/100 mL y nitratos ≤ 10 mg/L de N para potabilizar con tratamiento convencional, oxígeno disuelto ≥ 4 mg/L para la vida acuática y coliformes fecales ≤ 1 000 NMP/100 mL para regar lo que se come crudo (Decreto 1594 de 1984, compilado en el Decreto 1076 de 2015). La Resolución 0565 de 2026 del Ministerio de Ambiente fija nuevos criterios que rigen desde mayo de 2027.

## Represa y embalse (pestaña Represa)

En el km 7 de la zona alta una presa (de 15 a 80 m) cierra el valle. Le entra el 25 % del caudal del río en la bocatoma.

- **Embalse**: el valle tiene forma de V, así que el volumen crece con el cuadrado del nivel, V = a·h² (con 38 m guarda 9.5 millones de m³), y el área del espejo es su derivada, A = 2·a·h. El nivel cambia con el reloj de la simulación: dh/dt = (Q_entra − Q_sale)/A.
- **Operación**: soltar lo que entra (filo de agua), soltar un caudal fijo o guardar agua soltando solo el caudal ambiental. Lleno, lo que sobra sale por el aliviadero; en el nivel mínimo (35 % de la presa) no puede soltar más de lo que entra. Lo que guarda o suelta cambia el caudal de las zonas alta, media y baja y la cota en la bocatoma.
- **Central**: P = ρ·g·Q·H_n·η con H_n = h − y − k·Q²: la potencia es una función cúbica del caudal con un máximo. Unos 456 kW con el río normal.
- **Línea y costos**: I = P/(√3·U·fp) y pérdidas P_p = 3·I²·r·L en 40 km (0.5 % a 34.5 kV; 3.5 % a 13.2 kV). Se compara el costo de producir la energía con el de llevarla, el kWh puesto en la ciudad con la tarifa de la red, y el agua de la ciudad bombeada con energía de la red, con energía de la represa o bajada por gravedad (con sus cámaras de quiebre de presión). Son costos de operación, sin la inversión.
- **Un año mes a mes**: con el régimen de lluvias del Caribe, el caudal que entra, el que sale, el nivel, la energía y el río en la bocatoma con la represa y sin ella.

## Huella hídrica y de carbono (pestaña Huella)

- **Huella hídrica** (Hoekstra y otros, 2011): HH_verde = 10·ET_verde/Y, HH_azul = 10·ET_azul/Y y HH_gris = (α·N/(c_máx − c_nat))/Y, con la evapotranspiración del ciclo repartida día a día entre la lluvia efectiva (verde) y el riego (azul), los rendimientos nacionales de 2025 (UPRA, 2026) y la comparación con los promedios mundiales de Mekonnen y Hoekstra (2011). Para el banano de la zona baja da 802 m³/t (promedio mundial: 790).
- **Carbono del transporte**: viajes de camión de ida y vuelta hasta la ciudad (55 km desde la montaña, 28 desde el piedemonte y 6 desde la llanura), litros de ACPM, CO₂ con 2.68 kg por litro (IPCC, 2006) y su costo con la tarifa del impuesto al carbono de 2026 (29 070.49 COP por tonelada de CO₂e).
- **Inundación**: el lote de la llanura está en la vega del río (cota 3.20 m) y junto al canal del arroyo. La creciente del río y el desborde del arroyo lo cubren de agua y el cultivo pierde daño = mín(1, días/tolerancia)·mín(1, profundidad/0.30 m); cada cultivo aguanta encharcado un número de días distinto (1 día las hortalizas, 2 el banano, 10 el arroz, 14 la palma). En la montaña y el piedemonte los lotes están en la ladera, por encima de la creciente.

## Agua subterránea (pestaña Acuífero)

Se elige la zona: en la montaña, un aluvión delgado de grava en el fondo del valle; en el piedemonte, un abanico de arena gruesa y grava; en la llanura, arena bajo una capa de arcilla. Al cambiar de zona se proponen el material, el espesor, el suelo y el tipo típicos, y el río es el de esa zona (en la montaña el acuífero alimenta al río; en el piedemonte el río lo recarga). En cada zona hay suelo, una capa de arcilla si el acuífero es semiconfinado o confinado, el acuífero (grava, arena gruesa, arena media o arena fina y limosa, de 5 a 60 m de espesor) y la roca. Se eligen además la profundidad del agua, el caudal del pozo de una finca y su distancia al río.

- **Río que gana o pierde agua**: si el río está más alto que el nivel freático le entrega agua al acuífero (río perdedor); si está más bajo, el acuífero lo alimenta (río ganador). El agua se mueve con la ley de Darcy, v = K·i/n_e.
- **Pozo**: al bombear, el agua baja alrededor del pozo en un cono de abatimiento (Thiem, función logarítmica de la distancia) cuyo radio da la fórmula de Sichardt. Si el abatimiento pasa del 60 % del espesor, el pozo se seca.
- **Del río al pozo**: si el cono alcanza el río, el pozo atrae su agua y el tiempo de viaje es t = π·b·n_e·L²/Q; la capa de arcilla agrega el tiempo de cruzarla. Se revisa que el viaje dure al menos 50 días, el tiempo de referencia para que mueran las bacterias. Los coliformes que llegan se calculan con su decaimiento y la filtración en el camino; los nitratos llegan completos.
- **Gráficas**: el nivel del agua subterránea del río al pozo (con el cono) y la curva de llegada del agua del río al pozo (advección y dispersión), con la línea de los 50 días. El panel tiene además un corte del terreno con las capas, el nivel y el pozo.

## La escena 3D: cuenca, cultivos y corte del terreno

- **Cinco vistas**, con botones sobre la escena: *Ciudad* (el acueducto, la red y el arroyo), *Cuenca* (el río del nacimiento al mar con las tres zonas, como en el perfil de la pestaña Río), *Represa* (la presa con su embalse, la central, el arranque de la línea y la tubería), *Cultivo* (el lote de la zona elegida, su bomba y su tubería) y *Acuífero* (el corte del terreno en la zona elegida). Al cambiar de pestaña, la cámara vuela sola a la vista que corresponde; si la persona mueve la cámara, el vuelo se detiene.
- **La cuenca**: aguas arriba de la ciudad el río sube por el piedemonte hasta la montaña, entre laderas con bosque. Líneas blancas marcan dónde empiezan la zona media (km 15) y la baja (km 35). Las distancias horizontales están comprimidas.
- **Color del río**: azul cuando está limpio, café con el sedimento de las lluvias y, desde el km del vertimiento, del color del agua residual según cuánta DBO y cuántos coliformes lleva en cada tramo; río abajo se aclara a medida que se degrada.
- **Cultivos por zona**: en cada zona hay un lote con su cultivo típico (café en la montaña, cacao en el piedemonte y banano en la llanura). El de la zona elegida en la pestaña Riego muestra el cultivo del panel, el método de riego, la bomba en la orilla y la tubería que sube hasta el lote, a la altura del campo sobre el río de esa zona. En la montaña y el piedemonte las hileras van en curvas de nivel.
- **Represa y rutas**: la presa de concreto con su aliviadero (vierte cuando el embalse está lleno y entra más de lo que turbinan), la torre de toma, la tubería forzada y la casa de máquinas; el embalse sube y baja con el reloj. La línea eléctrica (torres y tres conductores) y la tubería por gravedad (con sus cámaras de quiebre) bajan por la ladera este hasta la ciudad. Los rótulos de las zonas muestran el caudal con la represa y sin ella.
- **Inundación**: con la creciente el agua del río cubre la vega del cultivo de la llanura, y con el desborde del arroyo el agua baja a la calle y a la vega; el cultivo se marchita según lo que pierde.
- **Corte del terreno**: en la llanura, el frente de la escena está cortado como una maqueta; en la montaña y el piedemonte, el corte va de través al valle junto al lote de esa zona y lo que queda aguas abajo se recorta mientras se mira. Muestra las capas, el nivel freático (a trazos si es piezométrico), el pozo con su filtro, el agua adentro y la bomba sumergible, flechas y gotas que se mueven con el flujo subterráneo y, si el río va contaminado, la mancha de su agua dentro del acuífero hasta donde llega en 50 días.

## Estaciones de bombeo (pestaña Bombas)

Se diseña la estación del acueducto (río → tanque, con la altura media del ciclo y el rango entre el arranque y la parada) o la de riego. Para cada una:

- potencia hidráulica P_h = ρgQH, potencia al freno (en el eje) P_b = P_h/η_b y potencia eléctrica real P_e = P_b/η_m;
- motor comercial, la capacidad instalada: el primer tamaño en HP que cubre la potencia al freno más un margen (50 % hasta 2 HP, 30 % hasta 5 HP, 20 % hasta 10 HP, 15 % hasta 20 HP y 10 % en los mayores), con la eficiencia de referencia de un motor de alta eficiencia de 2, 4 o 6 polos; factor de carga y capacidad total con la bomba de reserva;
- tipos de bomba (centrífuga horizontal, carcasa partida, multietapa, turbina vertical, sumergible y flujo axial): la tabla dice cuáles sirven según el caudal, la altura, el número de etapas y la velocidad específica, y cuál se recomienda;
- curva de N bombas en paralelo H = H₀ − a(Q/N)² y curva del sistema H = H_est + K·Q²: el punto de operación es su intersección;
- NPSH disponible (presión atmosférica de la altitud, presión de vapor con la temperatura del agua, altura y pérdida de la succión) contra el requerido, para revisar la cavitación.

## Riego en la cuenca (pestaña Riego)

ET₀ de Hargreaves con el clima de cada zona, ET_c = K_c·ET₀ (K_c de la FAO-56), necesidad neta restando la lluvia efectiva y bruta dividiendo por la eficiencia del método (inundación, surcos, aspersión, pivote central, microaspersión o goteo). El caudal de diseño sale de la época seca: Q = N_b·A·10/(horas·3600). La tubería y la bomba de riego se diseñan con ese caudal y una altura igual al desnivel hasta el lote más la presión del emisor más las pérdidas. Tres tablas comparan el cultivo en las tres zonas, los seis métodos y qué cultivos se dan en cada zona; el panel compara el agua del riego con el consumo de la ciudad (porcentaje y número de viviendas equivalentes) y revisa la calidad del agua en la toma: un vertimiento aguas arriba puede dejarla sin servir para hortalizas.

## Costo mensual de bombeo

El costo es un valor del mes completo, no del instante, así que no cambia cuando la bomba se apaga o se prende (`costoMensual` en `diseno.js`):

- horas de bombeo al día = 24·t_enc/(t_enc + t_apag) = 24·QMD/Q_b, del ciclo de la bomba;
- volumen mensual V = Q_b · horas · 3600 · 30;
- altura dinámica media H̄ = z_t + (h_a + h_p)/2 − z_río + h_f: mientras la bomba trabaja, el nivel sube en línea recta del arranque a la parada y la altura es lineal en el nivel, así que su promedio es la altura con el nivel medio;
- C(V) = m·V + b, con m = tarifa·ρ·g·H̄/(η·η_m·3.6×10⁶): se paga la energía eléctrica, así que se divide por la eficiencia de la bomba η y por la del motor η_m.

Con bombeo continuo la bomba trabaja 24 h y el tanque se mantiene lleno (altura con h_máx); si la bomba no alcanza el QMD, el tanque termina vacío (nivel 0); si el río baja de la rejilla, la bomba no trabaja y solo queda el cargo fijo. En el escenario base: 17.36 h al día, V = 28 123.20 m³, H̄ = 42.62 m, motor de 15 HP con η_m = 0.91, m = 172.68 COP/m³, E = 5 111.82 kWh y C = 5 006 231 COP. (Sin la eficiencia del motor el costo era de 4 569 170 COP.) Una prueba simula tres ciclos completos y comprueba que la energía medida, llevada a un mes, es igual a la de la fórmula.

## Pestaña Datos: guardar la simulación en Excel

Mientras corre el reloj se guarda una fila cada 15 minutos de tiempo simulado (se puede cambiar a 5 min, 30 min o 1 h) y cada arranque o parada de la bomba con su instante exacto; la energía se suma tramo por tramo con el área bajo la recta del nivel. «Guardar escenario» copia todos los parámetros y resultados del momento (los escenarios quedan en el navegador aunque se recargue la página). «Descargar Excel (.xlsx)» crea `simulacion-hidrica_AAAA-MM-DD_HH-MM.xlsx` con catorce hojas:

| Hoja | Contenido |
|---|---|
| Resumen | Fecha, tiempo simulado, tamaño del registro, energía medida y estado del sistema al exportar |
| Parámetros y resultados | Todos los parámetros y resultados; una columna por escenario guardado y la última con el estado al exportar |
| Serie de tiempo | Una fila por intervalo: nivel, bomba, consumo, altura, potencia, presiones, energía y costo acumulados, uso del canal |
| Arranques y paradas | Cada cambio de la bomba con su hora, el nivel y la duración del tramo anterior |
| Ciclo y costo | El ciclo de la bomba y el costo mensual con fórmulas de Excel (incluida la eficiencia del motor): si se cambia un dato de entrada (en azul), Excel recalcula |
| Revisión del diseño | Los criterios de diseño del acueducto, el río, las bombas, el riego, la represa, la huella, el acuífero y la lluvia, con su resultado |
| Cantidades de obra | Tuberías, accesorios, excavación y cama de apoyo de la red |
| Perfil del río | Oxígeno disuelto, saturación, déficit, DBO, coliformes y nitratos cada 0.5 km, con el vertimiento, la bocatoma y la toma de riego marcados |
| Represa y energía | Embalse, potencia de la central, pérdidas de la línea y costos de operación de la energía y del agua, con fórmulas de Excel |
| Embalse mes a mes | Un año de operación: caudal que entra y que sale, nivel, energía y río en la bocatoma con la represa y sin ella |
| Huella hídrica | Huella verde, azul y gris del cultivo elegido y CO₂ de llevar la cosecha a la ciudad, con fórmulas de Excel |
| Huella por cultivo | Los once cultivos en la zona elegida y el cultivo elegido en las tres zonas |
| Lluvia y desastres | Tormenta (Gumbel y Dyck–Peschke), caudal del río por la lluvia, crecida del arroyo, umbral de deslizamientos y avenida torrencial, con fórmulas de Excel |
| Lluvia mes a mes | Lluvia, caudal y cota del río de cada mes con el clima del año, y el caudal con un año normal, El Niño y La Niña |

Los números se guardan con todos sus decimales; el formato de cada celda solo decide cuántos se ven. Los textos largos (material de una tubería, ecuación de fricción, criterios de diseño) se parten en líneas dentro de su celda, y al imprimir las hojas anchas salen en horizontal, ajustadas al ancho de la página. El archivo se arma en el navegador con `js/excel.js` (sin librerías ni conexión a internet).

## Tuberías por material

Cada tramo (succión, aducción, conducción, principal, ramales, acometida y tubería de riego) se elige por material, diámetro nominal y clase de presión. El catálogo (`MATERIALES`, `especTubo`) da diámetro externo, espesor, diámetro interno, presión de trabajo, rugosidad, coeficiente C y módulo de elasticidad.

| Material | Norma de referencia | C de Hazen-Williams | Nota |
|---|---|---|---|
| PVC presión | NTC 382 (RDE) | 150 | Blanco, muy liso |
| PEAD PE100 | NTC 4585 / ISO 4427 (SDR) | 140–145 | Negro, bastante liso |
| GRP / PRFV | NTC 3871 / AWWA C950 | 130–135 | Liso |
| Hierro dúctil | ISO 2531 | 130 | Vida útil cercana a 100 años |
| AP / CCP (concreto con cilindro de acero) | AWWA C301 / C303 | 110–120 | Menos liso |
| Acero galvanizado | ASTM A53 | 120 | Succión y pasos especiales |

Las pérdidas se calculan con Darcy-Weisbach (Swamee-Jain) o con Hazen-Williams, h = 10.67·L·Q^1.852/(C^1.852·D^4.87), a elección. El golpe de ariete usa Joukowsky: ΔH = a·V/g, con a = √(K/ρ)/√(1 + K·D/(E·e)).

## Diseñador de la red

En la pestaña Red se eligen el número de ramales, las viviendas por ramal, las separaciones, las pendientes del terreno y la tubería de cada tramo; se activan las válvulas y el hidrante, se puede abrir el hidrante (incendio) o cerrar un ramal. El plano colorea cada vivienda por su presión en la hora pico con el tanque en el nivel de arranque (el peor caso) y al tocar una vivienda, en el plano o en la escena 3D, se convierte en la vivienda de análisis. La pestaña muestra además el corte de la zanja (cama de apoyo, tubería, relleno compactado y cinta de advertencia) y la tabla de cantidades de obra.

## Captación y desarenador

El agua del río entra por una rejilla a la bocatoma, cruza el desarenador y rebosa por un vertedero al pozo de succión. Un grano se queda en el desarenador si cae la profundidad h antes de recorrer la longitud L, es decir si su velocidad de caída es mayor que la carga superficial q = Q/(B·L); la profundidad se cancela. Con la ley de Stokes (v_s = K·d², K = g(ρ_s − ρ)/(18μ)) el grano más fino que se queda es d = √(q/K). El desarenador se calcula con el caudal de la bomba mientras trabaja. En el escenario base (15 L/s, B = 1 m, L = 6 m) se retienen los granos desde 0.050 mm; al bombear más o acortar el desarenador pasa arena más fina hacia la bomba, y la escena lo muestra con granos de cuatro tamaños.

## Sección del arroyo

El canal es trapezoidal: fondo de ancho b y paredes con talud z (z metros horizontales por cada metro vertical).

- Perímetro mojado: P = b + 2y·√(1 + z²)
- Área de flujo: A = (b + z·y)·y
- Ancho de la lámina: T = b + 2z·y

Con P y z fijos, el tirante es y = (P − b)/k con k = 2√(1 + z²), y el área queda como una parábola en b que abre hacia abajo. Su vértice da la sección de máxima eficiencia, en la que b/y = 2(√(1 + z²) − z). Con z = 0 se recupera el canal rectangular (b = P/2, A = P²/8).

## Probar en el computador

Los módulos de JavaScript no funcionan abriendo `index.html` con doble clic. Hay que servir la carpeta:

```
python -m http.server 8000
```

y abrir `http://localhost:8000`. Para correr las pruebas (requiere Node.js 18 o superior):

```
npm test
```

Son 98 pruebas: 21 del modelo base, 17 del diseño, 7 del archivo de Excel, 9 del río, 6 de las bombas, 6 del riego, 7 del acuífero, 8 de la represa, 7 de la huella y 10 de la lluvia.

## Valores de referencia

La tarifa de energía (950 COP/kWh), el cargo fijo, la presión mínima de servicio (15 m.c.a.), la presión estática máxima (60 m.c.a.), los factores k1 y k2, la dotación, las pérdidas técnicas, los límites de velocidad y las dimensiones del catálogo de tuberías son valores editables de referencia. También lo son los del río y el riego: la sección del cauce, las constantes de la DBO y de los coliformes, las concentraciones típicas de cada vertimiento, los suelos y materiales del acuífero, los campos de aplicación de las bombas, las eficiencias de los motores, los K_c de los cultivos y el clima de cada zona. Los de la represa y la huella también: los costos de operación de la central, la línea y la tubería, la forma del valle, los rendimientos, las dosis de nitrógeno y los días que aguanta cada cultivo encharcado. Y los de la lluvia: el área y el coeficiente de escorrentía de la cuenca, los factores de El Niño y La Niña, la lluvia máxima diaria promedio y su variación (curva IDF), el factor de la lluvia antecedente, la quebrada de montaña y la velocidad de la avenida; la curva IDF debe reemplazarse por la de la estación del IDEAM más cercana. Antes de la sustentación conviene contrastarlos con la tarifa vigente del operador de energía, con el Reglamento Técnico del Sector de Agua Potable y Saneamiento Básico (RAS, Resolución 0330 de 2017), con las normas de calidad del agua vigentes y con los catálogos de los fabricantes.
