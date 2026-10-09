/* ==== MÓDULO RECURSOS HUMANOS ==== */
const HR_KEY = "rfs-ops-hr";
const HR_UNIFORM_ITEMS = [
  { key: "gorra", label: "Gorra" },
  { key: "pantalon", label: "Pantalón" },
  { key: "camisa", label: "Camisa" },
  { key: "sueter", label: "Suéter" },
  { key: "zapatos", label: "Zapatos" },
  { key: "botas", label: "Botas" },
  { key: "chaleco", label: "Chaleco" },
  { key: "casco", label: "Casco" },
  { key: "radio", label: "Radio" },
  { key: "grilletes", label: "Grilletes" },
  { key: "linterna", label: "Linterna" },
  { key: "otros", label: "Otros" },
];

const HR_STATUS = {
  draft: "Borrador",
  review: "En revisión",
  hired: "Contratado",
  rejected: "No contratado",
};

/** 5 modelos de test de acción/reacción (selectivo, corto) */
const HR_PSYCH_MODELS = [
  {
    id: 1,
    title: "Modelo A — Control bajo presión",
    questions: [
      {
        id: "q1",
        text: "Un visitante te grita e insulta en la entrada. ¿Qué haces primero?",
        options: [
          { key: "a", label: "Le grito igual para que se calme", v: 3, c: 0 },
          { key: "b", label: "Mantengo la calma, pido que baje el tono y llamo a supervisión", v: 0, c: 2 },
          { key: "c", label: "Lo empujo fuera del local", v: 3, c: 0 },
          { key: "d", label: "Ignoro todo y me voy", v: 1, c: 0 },
        ],
      },
      {
        id: "q2",
        text: "Tu supervisor dice: «No abras la reja hasta que yo llegue». Luego un desconocido insiste. ¿Qué haces?",
        options: [
          { key: "a", label: "Abro porque parece de prisa", v: 1, c: 0 },
          { key: "b", label: "Mantengo la reja cerrada y espero al supervisor", v: 0, c: 2 },
          { key: "c", label: "Abro solo un poco para mirar", v: 2, c: 0 },
          { key: "d", label: "Le entrego la llave al desconocido", v: 3, c: 0 },
        ],
      },
      {
        id: "q3",
        text: "Un compañero te provoca y te reta a pelear en el puesto. ¿Respuesta correcta?",
        options: [
          { key: "a", label: "Acepto para demostrar autoridad", v: 3, c: 0 },
          { key: "b", label: "Me retiro, reporto el hecho y evito el conflicto", v: 0, c: 2 },
          { key: "c", label: "Lo amenazo con el bastón", v: 3, c: 0 },
          { key: "d", label: "Lo grabo y lo publico en redes", v: 2, c: 0 },
        ],
      },
      {
        id: "q4",
        text: "Instrucción: «Si suena la alarma, observa, reporta por radio y no persigas solo». Suena la alarma. ¿Qué haces?",
        options: [
          { key: "a", label: "Salgo corriendo solo a buscar al sospechoso", v: 2, c: 0 },
          { key: "b", label: "Observo, reporto por radio y espero indicaciones", v: 0, c: 2 },
          { key: "c", label: "Apago la alarma y no digo nada", v: 1, c: 0 },
          { key: "d", label: "Golpeo a quien pase cerca", v: 3, c: 0 },
        ],
      },
      {
        id: "q5",
        text: "Un cliente te pide un favor fuera de protocolo. ¿Qué haces?",
        options: [
          { key: "a", label: "Lo hago para quedar bien", v: 1, c: 0 },
          { key: "b", label: "Explico el protocolo y consulto a mi jefe", v: 0, c: 2 },
          { key: "c", label: "Cobro por hacerlo por mi cuenta", v: 2, c: 0 },
          { key: "d", label: "Me enojo y lo trato mal", v: 3, c: 0 },
        ],
      },
      {
        id: "q6",
        text: "Te dicen tres pasos: 1) identificar, 2) anotar, 3) reportar. ¿Cuál es el orden correcto?",
        options: [
          { key: "a", label: "Reportar → anotar → identificar", v: 0, c: 0 },
          { key: "b", label: "Identificar → anotar → reportar", v: 0, c: 2 },
          { key: "c", label: "Anotar → pelear → reportar", v: 2, c: 0 },
          { key: "d", label: "Ninguno, yo decido", v: 1, c: 0 },
        ],
      },
      {
        id: "q7",
        text: "Alguien te empuja sin motivo. ¿La mejor reacción profesional?",
        options: [
          { key: "a", label: "Responder con más fuerza", v: 3, c: 0 },
          { key: "b", label: "Crear distancia, verbalizar y pedir apoyo", v: 0, c: 2 },
          { key: "c", label: "Sacar un arma de inmediato", v: 3, c: 0 },
          { key: "d", label: "Dejar el puesto abandonado", v: 1, c: 0 },
        ],
      },
      {
        id: "q8",
        text: "Te indican: «No uses fuerza salvo defensa propia y peligro real». Hay una discusión verbal sin contacto. ¿Qué aplica?",
        options: [
          { key: "a", label: "Uso fuerza preventiva", v: 3, c: 0 },
          { key: "b", label: "No uso fuerza; media verbalmente y reporto", v: 0, c: 2 },
          { key: "c", label: "Esposo a uno para que se callen", v: 3, c: 0 },
          { key: "d", label: "Apago el radio para no involucrarme", v: 1, c: 0 },
        ],
      },
    ],
  },
  {
    id: 2,
    title: "Modelo B — Comprensión de órdenes",
    questions: [
      {
        id: "q1",
        text: "Orden: «Revisa el perímetro norte y luego el sur; no entres a oficinas». ¿Qué NO debes hacer?",
        options: [
          { key: "a", label: "Revisar el norte", v: 0, c: 0 },
          { key: "b", label: "Entrar a oficinas", v: 0, c: 2 },
          { key: "c", label: "Revisar el sur después", v: 0, c: 0 },
          { key: "d", label: "Reportar si veo algo raro", v: 0, c: 0 },
        ],
      },
      {
        id: "q2",
        text: "Un conductor se niega a identificarse en el acceso. ¿Acción correcta?",
        options: [
          { key: "a", label: "Lo dejo pasar para evitar discusión", v: 1, c: 0 },
          { key: "b", label: "Niego el acceso y aviso a control", v: 0, c: 2 },
          { key: "c", label: "Rompo el cristal del vehículo", v: 3, c: 0 },
          { key: "d", label: "Lo agredo verbalmente", v: 3, c: 0 },
        ],
      },
      {
        id: "q3",
        text: "Te piden repetir la instrucción: «Quedarse en el punto, no abandonar». ¿Cuál demuestra que entendiste?",
        options: [
          { key: "a", label: "Me quedo en el punto asignado", v: 0, c: 2 },
          { key: "b", label: "Voy a comprar y regreso rápido", v: 1, c: 0 },
          { key: "c", label: "Cambio de puesto sin avisar", v: 1, c: 0 },
          { key: "d", label: "Dejo a un amigo en mi lugar", v: 2, c: 0 },
        ],
      },
      {
        id: "q4",
        text: "Hay un robo en curso y estás solo. Según protocolo típico de vigilancia, ¿prioridad?",
        options: [
          { key: "a", label: "Perseguir y golpear al sospechoso", v: 3, c: 0 },
          { key: "b", label: "Observar, reportar, proteger vidas y esperar apoyo", v: 0, c: 2 },
          { key: "c", label: "Escapar del edificio sin reportar", v: 1, c: 0 },
          { key: "d", label: "Publicar en WhatsApp del barrio", v: 1, c: 0 },
        ],
      },
      {
        id: "q5",
        text: "Un superior te corrige en público. ¿Respuesta madura?",
        options: [
          { key: "a", label: "Le contesto con insultos", v: 3, c: 0 },
          { key: "b", label: "Escucho, aclaro con respeto y mejoro", v: 0, c: 2 },
          { key: "c", label: "Lo empujo", v: 3, c: 0 },
          { key: "d", label: "Abandono el turno", v: 2, c: 0 },
        ],
      },
      {
        id: "q6",
        text: "Secuencia dicha: A) saludar, B) pedir ID, C) registrar. Llega un visitante. ¿Orden?",
        options: [
          { key: "a", label: "C → A → B", v: 0, c: 0 },
          { key: "b", label: "A → B → C", v: 0, c: 2 },
          { key: "c", label: "B → pelear → C", v: 2, c: 0 },
          { key: "d", label: "Solo C", v: 0, c: 0 },
        ],
      },
      {
        id: "q7",
        text: "Un amigo pide que le prestes el uniforme. ¿Qué haces?",
        options: [
          { key: "a", label: "Se lo presto", v: 2, c: 0 },
          { key: "b", label: "No; el uniforme es de la empresa y personal", v: 0, c: 2 },
          { key: "c", label: "Se lo vendo", v: 2, c: 0 },
          { key: "d", label: "Entra conmigo sin uniforme", v: 1, c: 0 },
        ],
      },
      {
        id: "q8",
        text: "Te provocan para «demostrar quién manda». ¿Mejor opción?",
        options: [
          { key: "a", label: "Responder con violencia", v: 3, c: 0 },
          { key: "b", label: "No caer en la provocación y reportar", v: 0, c: 2 },
          { key: "c", label: "Retar a pelear después del turno", v: 3, c: 0 },
          { key: "d", label: "Amenazar a la familia del otro", v: 3, c: 0 },
        ],
      },
    ],
  },
  {
    id: 3,
    title: "Modelo C — Uso de fuerza y ética",
    questions: [
      {
        id: "q1",
        text: "¿Cuándo es aceptable usar fuerza física como vigilante?",
        options: [
          { key: "a", label: "Cuando alguien me falta el respeto", v: 3, c: 0 },
          { key: "b", label: "Solo en defensa propia o peligro real inminente, según protocolo", v: 0, c: 2 },
          { key: "c", label: "Siempre que yo lo decida", v: 3, c: 0 },
          { key: "d", label: "Para cobrar una deuda personal", v: 3, c: 0 },
        ],
      },
      {
        id: "q2",
        text: "Encuentras un celular perdido. ¿Qué haces?",
        options: [
          { key: "a", label: "Me lo quedo", v: 2, c: 0 },
          { key: "b", label: "Lo reporto y lo entrego a supervisión", v: 0, c: 2 },
          { key: "c", label: "Lo vendo", v: 2, c: 0 },
          { key: "d", label: "Lo tiro", v: 1, c: 0 },
        ],
      },
      {
        id: "q3",
        text: "Te ofrecen dinero para dejar pasar a alguien no autorizado. ¿Respuesta?",
        options: [
          { key: "a", label: "Acepto si es mucho", v: 2, c: 0 },
          { key: "b", label: "Rechazo, niego el acceso y reporto el intento", v: 0, c: 2 },
          { key: "c", label: "Acepto y no digo nada", v: 2, c: 0 },
          { key: "d", label: "Amenazo al que ofrece", v: 3, c: 0 },
        ],
      },
      {
        id: "q4",
        text: "Instrucción clara: «No toques evidencia». Hay un objeto en el piso tras un incidente. ¿Qué haces?",
        options: [
          { key: "a", label: "Lo guardo en mi bolsillo", v: 2, c: 0 },
          { key: "b", label: "No lo toco, aseguro el área y reporto", v: 0, c: 2 },
          { key: "c", label: "Lo limpio", v: 1, c: 0 },
          { key: "d", label: "Se lo doy a un desconocido", v: 2, c: 0 },
        ],
      },
      {
        id: "q5",
        text: "Un menor está en peligro cerca del puesto. ¿Prioridad?",
        options: [
          { key: "a", label: "Ignoro porque «no es mi problema»", v: 2, c: 0 },
          { key: "b", label: "Protejo, pido ayuda y reporto de inmediato", v: 0, c: 2 },
          { key: "c", label: "Lo castigo yo mismo", v: 3, c: 0 },
          { key: "d", label: "Lo grabo para redes", v: 1, c: 0 },
        ],
      },
      {
        id: "q6",
        text: "Te piden: «Confirma recibo: radio, linterna y chaleco». ¿Qué demuestra comprensión?",
        options: [
          { key: "a", label: "Digo «recibido» sin revisar", v: 0, c: 0 },
          { key: "b", label: "Reviso y confirmo cada ítem", v: 0, c: 2 },
          { key: "c", label: "Me enojo porque me controlan", v: 2, c: 0 },
          { key: "d", label: "Niego todo aunque lo tenga", v: 1, c: 0 },
        ],
      },
      {
        id: "q7",
        text: "Un compañero te pide cubrir una falta grave. ¿Qué haces?",
        options: [
          { key: "a", label: "Lo cubro por amistad", v: 2, c: 0 },
          { key: "b", label: "No miento; reporto con honestidad", v: 0, c: 2 },
          { key: "c", label: "Lo amenazo para que no me involucre", v: 3, c: 0 },
          { key: "d", label: "Pido dinero por callarme", v: 2, c: 0 },
        ],
      },
      {
        id: "q8",
        text: "Alguien te insulta por radio. ¿Reacción profesional?",
        options: [
          { key: "a", label: "Insulto de vuelta", v: 3, c: 0 },
          { key: "b", label: "Mantengo comunicación profesional y reporto el abuso", v: 0, c: 2 },
          { key: "c", label: "Voy a buscarlo para pelear", v: 3, c: 0 },
          { key: "d", label: "Apago el radio y abandono", v: 1, c: 0 },
        ],
      },
    ],
  },
  {
    id: 4,
    title: "Modelo D — Situaciones de acceso",
    questions: [
      {
        id: "q1",
        text: "Una persona dice ser «amigo del dueño» sin identificación. ¿Qué haces?",
        options: [
          { key: "a", label: "La dejo pasar", v: 1, c: 0 },
          { key: "b", label: "Pido ID y confirmo con supervisión", v: 0, c: 2 },
          { key: "c", label: "La empujo", v: 3, c: 0 },
          { key: "d", label: "Le grito que se vaya", v: 2, c: 0 },
        ],
      },
      {
        id: "q2",
        text: "Te dicen: «Solo vehículos autorizados». Llega un taxi sin aviso. Acción correcta:",
        options: [
          { key: "a", label: "Lo dejo porque es taxi", v: 1, c: 0 },
          { key: "b", label: "Detengo, verifico autorización y registro", v: 0, c: 2 },
          { key: "c", label: "Rayo el vehículo", v: 3, c: 0 },
          { key: "d", label: "Cobro peaje personal", v: 2, c: 0 },
        ],
      },
      {
        id: "q3",
        text: "Hay dos órdenes: «No pelear» y «Proteger el acceso». Un grupo empuja la reja. ¿Qué priorizas?",
        options: [
          { key: "a", label: "Salir a pelear con todos", v: 3, c: 0 },
          { key: "b", label: "Asegurar acceso, pedir refuerzo y evitar pelea innecesaria", v: 0, c: 2 },
          { key: "c", label: "Abrir la reja por miedo", v: 1, c: 0 },
          { key: "d", label: "Huir sin reportar", v: 1, c: 0 },
        ],
      },
      {
        id: "q4",
        text: "Te piden anotar: nombre, cédula y hora. Olvidas la hora. ¿Qué demuestra responsabilidad?",
        options: [
          { key: "a", label: "Inventar una hora", v: 1, c: 0 },
          { key: "b", label: "Corregir con la hora real o consultar el registro", v: 0, c: 2 },
          { key: "c", label: "Romper la hoja", v: 2, c: 0 },
          { key: "d", label: "Culpar a otro", v: 1, c: 0 },
        ],
      },
      {
        id: "q5",
        text: "Un compañero borracho llega a relevarte. ¿Qué haces?",
        options: [
          { key: "a", label: "Le entrego el puesto igual", v: 1, c: 0 },
          { key: "b", label: "No entrego; aviso a supervisión", v: 0, c: 2 },
          { key: "c", label: "Lo golpeo para «enseñarle»", v: 3, c: 0 },
          { key: "d", label: "Me voy y dejo el puesto solo", v: 2, c: 0 },
        ],
      },
      {
        id: "q6",
        text: "Escuchas: «Rojo = alto total; Amarillo = precaución; Verde = normal». Ahora el código es Amarillo. ¿Qué implica?",
        options: [
          { key: "a", label: "Todo normal, me descuido", v: 0, c: 0 },
          { key: "b", label: "Precaución reforzada", v: 0, c: 2 },
          { key: "c", label: "Alto total y pelear", v: 2, c: 0 },
          { key: "d", label: "Ignorar códigos", v: 1, c: 0 },
        ],
      },
      {
        id: "q7",
        text: "Te provocan en la calle con el uniforme puesto. ¿Mejor conducta?",
        options: [
          { key: "a", label: "Pelear para defender el honor", v: 3, c: 0 },
          { key: "b", label: "No responder con violencia; alejarme y reportar", v: 0, c: 2 },
          { key: "c", label: "Sacar arma para intimidar", v: 3, c: 0 },
          { key: "d", label: "Insultar más fuerte", v: 3, c: 0 },
        ],
      },
      {
        id: "q8",
        text: "Fin de turno: debes entregar radio y llaves. ¿Qué haces?",
        options: [
          { key: "a", label: "Me las llevo a casa", v: 2, c: 0 },
          { key: "b", label: "Las entrego inventariadas al relevo/supervisor", v: 0, c: 2 },
          { key: "c", label: "Las escondo", v: 2, c: 0 },
          { key: "d", label: "Se las doy a un desconocido", v: 2, c: 0 },
        ],
      },
    ],
  },
  {
    id: 5,
    title: "Modelo E — Estrés y autocontrol",
    questions: [
      {
        id: "q1",
        text: "Llevas 10 horas de turno y alguien te falta el respeto. ¿Qué refleja mejor autocontrol?",
        options: [
          { key: "a", label: "Explotar y pelear", v: 3, c: 0 },
          { key: "b", label: "Respirar, mantener profesionalismo y reportar", v: 0, c: 2 },
          { key: "c", label: "Abandonar el puesto", v: 1, c: 0 },
          { key: "d", label: "Romper objetos del cliente", v: 3, c: 0 },
        ],
      },
      {
        id: "q2",
        text: "Te dan esta orden doble: «No duermas en el puesto» y «Reporta cada hora». A las 3 a.m. tienes sueño. ¿Qué haces?",
        options: [
          { key: "a", label: "Duermo un rato", v: 1, c: 0 },
          { key: "b", label: "Me mantengo alerta y reporto a la hora", v: 0, c: 2 },
          { key: "c", label: "Apago el radio", v: 2, c: 0 },
          { key: "d", label: "Invito gente a fiesta en el puesto", v: 2, c: 0 },
        ],
      },
      {
        id: "q3",
        text: "Un visitante te empuja el pecho. ¿Primera reacción correcta?",
        options: [
          { key: "a", label: "Devolver el golpe de inmediato", v: 3, c: 0 },
          { key: "b", label: "Crear distancia, verbalizar alto y pedir apoyo", v: 0, c: 2 },
          { key: "c", label: "Perseguirlo fuera del perímetro solo", v: 2, c: 0 },
          { key: "d", label: "Llorar y dejar el puesto", v: 1, c: 0 },
        ],
      },
      {
        id: "q4",
        text: "Te dicen: «Si no entiendes una orden, pregunta». No entendiste parte de la orden. ¿Qué haces?",
        options: [
          { key: "a", label: "Adivino", v: 1, c: 0 },
          { key: "b", label: "Pregunto para confirmar antes de actuar", v: 0, c: 2 },
          { key: "c", label: "Me enojo con quien dio la orden", v: 2, c: 0 },
          { key: "d", label: "Hago lo contrario a propósito", v: 2, c: 0 },
        ],
      },
      {
        id: "q5",
        text: "Ves a dos personas discutiendo fuerte. No hay golpes aún. ¿Acción?",
        options: [
          { key: "a", label: "Me meto a pelear con ambos", v: 3, c: 0 },
          { key: "b", label: "Observo, media con calma si es seguro y reporto", v: 0, c: 2 },
          { key: "c", label: "Grabo para burlarme", v: 1, c: 0 },
          { key: "d", label: "Le doy un arma a uno", v: 3, c: 0 },
        ],
      },
      {
        id: "q6",
        text: "Código recibido: «Alpha = revisar cámaras; Bravo = cerrar acceso; Charlie = esperar». Recibes Bravo. ¿Qué haces?",
        options: [
          { key: "a", label: "Reviso cámaras", v: 0, c: 0 },
          { key: "b", label: "Cierro el acceso", v: 0, c: 2 },
          { key: "c", label: "Espero sin hacer nada relevante", v: 0, c: 0 },
          { key: "d", label: "Salgo a pelear", v: 3, c: 0 },
        ],
      },
      {
        id: "q7",
        text: "Un familiar te pide información confidencial del cliente. ¿Qué haces?",
        options: [
          { key: "a", label: "Se la doy porque es familia", v: 2, c: 0 },
          { key: "b", label: "No comparto; respeto confidencialidad", v: 0, c: 2 },
          { key: "c", label: "Cobro por la información", v: 2, c: 0 },
          { key: "d", label: "La publico en redes", v: 2, c: 0 },
        ],
      },
      {
        id: "q8",
        text: "Te sientes muy enfadado en el puesto. ¿La decisión más segura?",
        options: [
          { key: "a", label: "Descargar la rabia con alguien", v: 3, c: 0 },
          { key: "b", label: "Pedir relevo/apoyo y no actuar impulsivo", v: 0, c: 2 },
          { key: "c", label: "Romper la caseta", v: 3, c: 0 },
          { key: "d", label: "Amenazar a todo el que pase", v: 3, c: 0 },
        ],
      },
    ],
  },
];

let hrData = { applications: [] };
let hrTab = "list";
let hrFormSection = "datos";
let selectedHrAppId = null;
let pendingHrPhoto = null;
let hrPsychAnswers = {};

function emptyHrData() {
  return { applications: [] };
}

function emptyUniforms() {
  const u = { otrosDetalle: "" };
  HR_UNIFORM_ITEMS.forEach((i) => {
    u[i.key] = false;
  });
  return u;
}

function emptyHrApplication() {
  return {
    id: `hr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "",
    photo: "",
    fullName: "",
    cedula: "",
    birthDate: "",
    gender: "",
    nationality: "Dominicana",
    maritalStatus: "",
    address: "",
    sector: "",
    city: "",
    phone: "",
    phoneAlt: "",
    email: "",
    bloodType: "",
    hasLicense: false,
    licenseType: "",
    hasWeaponPermit: false,
    weaponPermitNo: "",
    educationLevel: "",
    availableShifts: "",
    willingTravel: false,
    hasOwnTransport: false,
    hasSecurityExp: false,
    securityYears: "",
    previousSecurityCompanies: "",
    criminalRecordDeclared: false,
    criminalRecordNote: "",
    emergencyName: "",
    emergencyPhone: "",
    emergencyRelation: "",
    familyContacts: [
      { name: "", relation: "", phone: "" },
      { name: "", relation: "", phone: "" },
    ],
    personalRefs: [
      { name: "", relation: "", phone: "", yearsKnown: "" },
      { name: "", relation: "", phone: "", yearsKnown: "" },
    ],
    workHistory: [
      { company: "", position: "", from: "", to: "", phone: "", reasonLeft: "" },
      { company: "", position: "", from: "", to: "", phone: "", reasonLeft: "" },
    ],
    confidentialitySigned: false,
    confidentialityName: "",
    confidentialitySignedAt: "",
    confidentialityAck: false,
    uniforms: emptyUniforms(),
    uniformsDeliveredAt: "",
    uniformsDeliveredBy: "",
    uniformsNotes: "",
    psychTest: {
      modelId: 0,
      answers: {},
      score: 0,
      maxScore: 0,
      violenceScore: 0,
      comprehensionScore: 0,
      violenceRisk: "",
      comprehension: "",
      recommendation: "",
      completedAt: "",
    },
    hiredEmployeeId: "",
    hiredAt: "",
    hrNotes: "",
  };
}

function normalizeHrContact(c = {}) {
  return {
    name: String(c.name || "").trim(),
    relation: String(c.relation || "").trim(),
    phone: String(c.phone || "").trim(),
    yearsKnown: String(c.yearsKnown || "").trim(),
  };
}

function normalizeHrWork(w = {}) {
  return {
    company: String(w.company || "").trim(),
    position: String(w.position || "").trim(),
    from: String(w.from || "").trim(),
    to: String(w.to || "").trim(),
    phone: String(w.phone || "").trim(),
    reasonLeft: String(w.reasonLeft || "").trim(),
  };
}

function normalizeHrUniforms(u = {}) {
  const out = emptyUniforms();
  HR_UNIFORM_ITEMS.forEach((i) => {
    out[i.key] = !!u[i.key];
  });
  out.otrosDetalle = String(u.otrosDetalle || "").trim();
  return out;
}

function normalizeHrPsych(p = {}) {
  return {
    modelId: Number(p.modelId) || 0,
    answers: p.answers && typeof p.answers === "object" ? { ...p.answers } : {},
    score: Number(p.score) || 0,
    maxScore: Number(p.maxScore) || 0,
    violenceScore: Number(p.violenceScore) || 0,
    comprehensionScore: Number(p.comprehensionScore) || 0,
    violenceRisk: String(p.violenceRisk || ""),
    comprehension: String(p.comprehension || ""),
    recommendation: String(p.recommendation || ""),
    completedAt: p.completedAt || "",
  };
}

function normalizeHrApplication(a = {}) {
  const base = emptyHrApplication();
  const family = Array.isArray(a.familyContacts) ? a.familyContacts.map(normalizeHrContact) : base.familyContacts;
  const refs = Array.isArray(a.personalRefs) ? a.personalRefs.map(normalizeHrContact) : base.personalRefs;
  const work = Array.isArray(a.workHistory) ? a.workHistory.map(normalizeHrWork) : base.workHistory;
  while (family.length < 2) family.push({ name: "", relation: "", phone: "", yearsKnown: "" });
  while (refs.length < 2) refs.push({ name: "", relation: "", phone: "", yearsKnown: "" });
  while (work.length < 2) work.push({ company: "", position: "", from: "", to: "", phone: "", reasonLeft: "" });
  const status = HR_STATUS[a.status] ? a.status : "draft";
  return {
    ...base,
    ...a,
    id: a.id || base.id,
    status,
    photo: typeof a.photo === "string" && a.photo.startsWith("data:image") ? a.photo : "",
    fullName: String(a.fullName || "").trim(),
    cedula: String(a.cedula || "").trim(),
    phone: String(a.phone || "").trim(),
    familyContacts: family.slice(0, 3),
    personalRefs: refs.slice(0, 3),
    workHistory: work.slice(0, 3),
    uniforms: normalizeHrUniforms(a.uniforms || {}),
    psychTest: normalizeHrPsych(a.psychTest || {}),
    confidentialitySigned: !!a.confidentialitySigned,
    confidentialityAck: !!a.confidentialityAck,
    hasLicense: !!a.hasLicense,
    hasWeaponPermit: !!a.hasWeaponPermit,
    willingTravel: !!a.willingTravel,
    hasOwnTransport: !!a.hasOwnTransport,
    hasSecurityExp: !!a.hasSecurityExp,
    criminalRecordDeclared: !!a.criminalRecordDeclared,
  };
}

function normalizeHrData(raw = {}) {
  const applications = Array.isArray(raw.applications) ? raw.applications.map(normalizeHrApplication) : [];
  return { applications };
}

function saveHrData(push = true) {
  hrData = normalizeHrData(hrData);
  localStorage.setItem(HR_KEY, JSON.stringify(hrData));
  if (push && typeof queueCloudSave === "function") queueCloudSave();
}

function applyRemoteHrData(remote) {
  const remoteNorm = normalizeHrData(remote || {});
  const local = normalizeHrData(hrData);
  const map = new Map();
  [...local.applications, ...remoteNorm.applications].forEach((a) => {
    if (!a || !a.id) return;
    const prev = map.get(a.id);
    if (!prev || String(a.updatedAt) > String(prev.updatedAt)) map.set(a.id, a);
  });
  hrData = {
    applications: [...map.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
  };
  localStorage.setItem(HR_KEY, JSON.stringify(hrData));
}

function canAccessRrhh() {
  if (!currentUser) return false;
  if (currentUser.role === "owner") return true;
  return typeof canAccessModule === "function" && canAccessModule("rrhh");
}

function getHrApp(id) {
  return (hrData.applications || []).find((a) => a.id === id) || null;
}

function setHrTab(tab) {
  hrTab = tab || "list";
  document.querySelectorAll(".hr-tabs .emp-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.hrTab === hrTab);
  });
  const list = document.getElementById("hrTabList");
  const form = document.getElementById("hrTabForm");
  if (list) list.hidden = hrTab !== "list";
  if (form) form.hidden = hrTab !== "form";
  renderHrModule();
}

function setHrFormSection(section) {
  hrFormSection = section || "datos";
  document.querySelectorAll(".hr-section-tabs .emp-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.hrSection === hrFormSection);
  });
  document.querySelectorAll(".hr-section-panel").forEach((panel) => {
    panel.hidden = panel.dataset.hrSection !== hrFormSection;
  });
}

function startNewHrApplication() {
  if (!canAccessRrhh()) {
    toast("No tienes acceso a Recursos Humanos.");
    return;
  }
  const app = emptyHrApplication();
  app.createdBy = currentUser ? currentUser.displayName || currentUser.username : "";
  hrData.applications.unshift(app);
  saveHrData(true);
  selectedHrAppId = app.id;
  pendingHrPhoto = null;
  hrPsychAnswers = {};
  setHrTab("form");
  setHrFormSection("datos");
  fillHrForm(app);
  toast("Nueva solicitud creada.");
}

function openHrApplication(id) {
  const app = getHrApp(id);
  if (!app) return;
  selectedHrAppId = app.id;
  pendingHrPhoto = null;
  hrPsychAnswers = { ...(app.psychTest.answers || {}) };
  setHrTab("form");
  setHrFormSection("datos");
  fillHrForm(app);
}

function fillHrForm(app) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!val;
    else el.value = val == null ? "" : val;
  };
  set("hrFullName", app.fullName);
  set("hrCedula", app.cedula);
  set("hrBirthDate", app.birthDate);
  set("hrGender", app.gender);
  set("hrNationality", app.nationality);
  set("hrMarital", app.maritalStatus);
  set("hrAddress", app.address);
  set("hrSector", app.sector);
  set("hrCity", app.city);
  set("hrPhone", app.phone);
  set("hrPhoneAlt", app.phoneAlt);
  set("hrEmail", app.email);
  set("hrBlood", app.bloodType);
  set("hrHasLicense", app.hasLicense);
  set("hrLicenseType", app.licenseType);
  set("hrHasWeapon", app.hasWeaponPermit);
  set("hrWeaponNo", app.weaponPermitNo);
  set("hrEducation", app.educationLevel);
  set("hrShifts", app.availableShifts);
  set("hrTravel", app.willingTravel);
  set("hrTransport", app.hasOwnTransport);
  set("hrSecExp", app.hasSecurityExp);
  set("hrSecYears", app.securityYears);
  set("hrSecCompanies", app.previousSecurityCompanies);
  set("hrCriminal", app.criminalRecordDeclared);
  set("hrCriminalNote", app.criminalRecordNote);
  set("hrEmergencyName", app.emergencyName);
  set("hrEmergencyPhone", app.emergencyPhone);
  set("hrEmergencyRelation", app.emergencyRelation);
  set("hrStatus", app.status);
  set("hrNotes", app.hrNotes);
  set("hrConfName", app.confidentialityName || app.fullName);
  set("hrConfAck", app.confidentialityAck);
  set("hrConfSigned", app.confidentialitySigned);
  set("hrUniformsNotes", app.uniformsNotes);
  set("hrUniformsBy", app.uniformsDeliveredBy);

  (app.familyContacts || []).forEach((c, i) => {
    set(`hrFamName${i}`, c.name);
    set(`hrFamRel${i}`, c.relation);
    set(`hrFamPhone${i}`, c.phone);
  });
  (app.personalRefs || []).forEach((c, i) => {
    set(`hrRefName${i}`, c.name);
    set(`hrRefRel${i}`, c.relation);
    set(`hrRefPhone${i}`, c.phone);
    set(`hrRefYears${i}`, c.yearsKnown);
  });
  (app.workHistory || []).forEach((w, i) => {
    set(`hrWorkCo${i}`, w.company);
    set(`hrWorkPos${i}`, w.position);
    set(`hrWorkFrom${i}`, w.from);
    set(`hrWorkTo${i}`, w.to);
    set(`hrWorkPhone${i}`, w.phone);
    set(`hrWorkReason${i}`, w.reasonLeft);
  });

  const photo = pendingHrPhoto || app.photo;
  const img = document.getElementById("hrPhotoPreview");
  const wrap = document.getElementById("hrPhotoPreviewWrap");
  if (img && wrap) {
    if (photo) {
      img.src = photo;
      wrap.hidden = false;
    } else {
      img.removeAttribute("src");
      wrap.hidden = true;
    }
  }

  renderHrUniformToggles(app.uniforms || emptyUniforms());
  renderHrPsychPanel(app);
  renderHrHireSummary(app);
  const meta = document.getElementById("hrFormMeta");
  if (meta) {
    meta.textContent = `${HR_STATUS[app.status] || app.status} · ${app.fullName || "Sin nombre"} · Código ${app.id.slice(-6)}`;
  }
}

function readHrFormInto(app) {
  const val = (id) => document.getElementById(id)?.value?.trim?.() || document.getElementById(id)?.value || "";
  const chk = (id) => !!document.getElementById(id)?.checked;
  app.fullName = val("hrFullName");
  app.cedula = val("hrCedula");
  app.birthDate = val("hrBirthDate");
  app.gender = val("hrGender");
  app.nationality = val("hrNationality");
  app.maritalStatus = val("hrMarital");
  app.address = val("hrAddress");
  app.sector = val("hrSector");
  app.city = val("hrCity");
  app.phone = val("hrPhone");
  app.phoneAlt = val("hrPhoneAlt");
  app.email = val("hrEmail");
  app.bloodType = val("hrBlood");
  app.hasLicense = chk("hrHasLicense");
  app.licenseType = val("hrLicenseType");
  app.hasWeaponPermit = chk("hrHasWeapon");
  app.weaponPermitNo = val("hrWeaponNo");
  app.educationLevel = val("hrEducation");
  app.availableShifts = val("hrShifts");
  app.willingTravel = chk("hrTravel");
  app.hasOwnTransport = chk("hrTransport");
  app.hasSecurityExp = chk("hrSecExp");
  app.securityYears = val("hrSecYears");
  app.previousSecurityCompanies = val("hrSecCompanies");
  app.criminalRecordDeclared = chk("hrCriminal");
  app.criminalRecordNote = val("hrCriminalNote");
  app.emergencyName = val("hrEmergencyName");
  app.emergencyPhone = val("hrEmergencyPhone");
  app.emergencyRelation = val("hrEmergencyRelation");
  app.status = val("hrStatus") || app.status;
  app.hrNotes = val("hrNotes");
  app.confidentialityName = val("hrConfName");
  app.confidentialityAck = chk("hrConfAck");
  app.confidentialitySigned = chk("hrConfSigned");
  app.uniformsNotes = val("hrUniformsNotes");
  app.uniformsDeliveredBy = val("hrUniformsBy");
  app.familyContacts = [0, 1].map((i) =>
    normalizeHrContact({
      name: val(`hrFamName${i}`),
      relation: val(`hrFamRel${i}`),
      phone: val(`hrFamPhone${i}`),
    })
  );
  app.personalRefs = [0, 1].map((i) =>
    normalizeHrContact({
      name: val(`hrRefName${i}`),
      relation: val(`hrRefRel${i}`),
      phone: val(`hrRefPhone${i}`),
      yearsKnown: val(`hrRefYears${i}`),
    })
  );
  app.workHistory = [0, 1].map((i) =>
    normalizeHrWork({
      company: val(`hrWorkCo${i}`),
      position: val(`hrWorkPos${i}`),
      from: val(`hrWorkFrom${i}`),
      to: val(`hrWorkTo${i}`),
      phone: val(`hrWorkPhone${i}`),
      reasonLeft: val(`hrWorkReason${i}`),
    })
  );
  if (pendingHrPhoto) app.photo = pendingHrPhoto;
  app.updatedAt = new Date().toISOString();
  return app;
}

function saveHrApplicationFromForm() {
  if (!canAccessRrhh()) return;
  const app = getHrApp(selectedHrAppId);
  if (!app) {
    toast("No hay solicitud abierta.");
    return;
  }
  readHrFormInto(app);
  if (!app.fullName) {
    toast("Escribe el nombre completo del solicitante.");
    return;
  }
  if (app.confidentialitySigned && !app.confidentialitySignedAt) {
    app.confidentialitySignedAt = new Date().toISOString();
  }
  if (Object.values(app.uniforms || {}).some((v) => v === true) && !app.uniformsDeliveredAt) {
    app.uniformsDeliveredAt = new Date().toISOString();
  }
  const idx = hrData.applications.findIndex((a) => a.id === app.id);
  if (idx >= 0) hrData.applications[idx] = normalizeHrApplication(app);
  saveHrData(true);
  fillHrForm(getHrApp(app.id));
  logActivity("hr_save", `RRHH guardó solicitud: ${app.fullName}`);
  toast("Solicitud guardada.");
}

function renderHrUniformToggles(uniforms) {
  const box = document.getElementById("hrUniformGrid");
  if (!box) return;
  box.innerHTML = HR_UNIFORM_ITEMS.map((item) => {
    const on = !!uniforms[item.key];
    return `<button type="button" class="hr-uniform-btn ${on ? "on" : ""}" data-uniform="${item.key}">
      <span class="hr-uniform-check">${on ? "✓" : ""}</span>
      ${escapeHtml(item.label)}
    </button>`;
  }).join("");
  box.querySelectorAll(".hr-uniform-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const app = getHrApp(selectedHrAppId);
      if (!app || app.status === "hired") return;
      app.uniforms = normalizeHrUniforms(app.uniforms);
      app.uniforms[btn.dataset.uniform] = !app.uniforms[btn.dataset.uniform];
      app.updatedAt = new Date().toISOString();
      saveHrData(true);
      renderHrUniformToggles(app.uniforms);
    });
  });
  const other = document.getElementById("hrUniformOtrosDetalle");
  if (other) other.value = uniforms.otrosDetalle || "";
}

function pickPsychModelId(app) {
  if (app.psychTest?.modelId) return app.psychTest.modelId;
  // Estable por id para que no cambie al reabrir
  let sum = 0;
  String(app.id || "").split("").forEach((ch) => {
    sum += ch.charCodeAt(0);
  });
  return (sum % HR_PSYCH_MODELS.length) + 1;
}

function getPsychModel(modelId) {
  return HR_PSYCH_MODELS.find((m) => m.id === modelId) || HR_PSYCH_MODELS[0];
}

function scorePsychAnswers(model, answers) {
  let violence = 0;
  let comprehension = 0;
  let maxC = 0;
  let maxV = 0;
  model.questions.forEach((q) => {
    maxC += 2;
    maxV += 3;
    const key = answers[q.id];
    const opt = q.options.find((o) => o.key === key);
    if (!opt) return;
    violence += opt.v;
    comprehension += opt.c;
  });
  // score alto = mejor perfil (menos violencia + más comprensión)
  const violencePenalty = maxV ? violence / maxV : 0;
  const compRatio = maxC ? comprehension / maxC : 0;
  const score = Math.round((1 - violencePenalty) * 55 + compRatio * 45);
  const violenceRisk = violence >= 12 ? "alto" : violence >= 6 ? "medio" : "bajo";
  const comprehensionLevel = compRatio >= 0.75 ? "alto" : compRatio >= 0.45 ? "medio" : "bajo";
  let recommendation = "Revisar con entrevista.";
  if (score >= 80 && violenceRisk === "bajo") recommendation = "Perfil favorable para vigilancia.";
  else if (violenceRisk === "alto" || comprehensionLevel === "bajo") recommendation = "No recomendado sin evaluación adicional.";
  else if (score >= 60) recommendation = "Aceptable con inducción y supervisión.";
  return {
    score: Math.max(0, Math.min(100, score)),
    maxScore: 100,
    violenceScore: violence,
    comprehensionScore: comprehension,
    violenceRisk,
    comprehension: comprehensionLevel,
    recommendation,
  };
}

function renderHrPsychPanel(app) {
  const modelId = pickPsychModelId(app);
  const model = getPsychModel(modelId);
  const title = document.getElementById("hrPsychModelTitle");
  if (title) title.textContent = model.title;
  const done = !!app.psychTest?.completedAt;
  const box = document.getElementById("hrPsychQuestions");
  if (!box) return;
  const answers = done ? app.psychTest.answers || {} : hrPsychAnswers;
  box.innerHTML = model.questions
    .map((q, idx) => {
      const opts = q.options
        .map((o) => {
          const checked = answers[q.id] === o.key ? "checked" : "";
          return `<label class="hr-psych-opt"><input type="radio" name="hrPsych_${q.id}" value="${o.key}" ${checked} ${done ? "disabled" : ""}/> <span>${escapeHtml(o.label)}</span></label>`;
        })
        .join("");
      return `<div class="form-card hr-psych-q"><p><strong>${idx + 1}.</strong> ${escapeHtml(q.text)}</p>${opts}</div>`;
    })
    .join("");
  if (!done) {
    box.querySelectorAll("input[type=radio]").forEach((input) => {
      input.addEventListener("change", () => {
        const qid = input.name.replace("hrPsych_", "");
        hrPsychAnswers[qid] = input.value;
      });
    });
  }
  const result = document.getElementById("hrPsychResult");
  if (result) {
    if (done) {
      const p = app.psychTest;
      result.innerHTML = `
        <div class="stats-grid">
          <div class="stat-box"><span class="muted">Puntuación</span><strong>${p.score}/100</strong></div>
          <div class="stat-box"><span class="muted">Riesgo violencia</span><strong>${escapeHtml(p.violenceRisk || "—")}</strong></div>
          <div class="stat-box"><span class="muted">Comprensión</span><strong>${escapeHtml(p.comprehension || "—")}</strong></div>
        </div>
        <p style="margin-top:12px"><strong>Recomendación:</strong> ${escapeHtml(p.recommendation || "—")}</p>
        <p class="muted" style="margin-top:6px">Modelo ${p.modelId} · ${escapeHtml((p.completedAt || "").slice(0, 16).replace("T", " "))}</p>
      `;
      result.hidden = false;
    } else {
      result.hidden = true;
      result.innerHTML = "";
    }
  }
  const btn = document.getElementById("btnHrScorePsych");
  const btnReset = document.getElementById("btnHrResetPsych");
  if (btn) btn.hidden = done || app.status === "hired";
  if (btnReset) btnReset.hidden = !done || app.status === "hired";
}

function scoreHrPsychFromForm() {
  const app = getHrApp(selectedHrAppId);
  if (!app) return;
  if (app.status === "hired") {
    toast("La solicitud ya fue contratada.");
    return;
  }
  const modelId = pickPsychModelId(app);
  const model = getPsychModel(modelId);
  const missing = model.questions.filter((q) => !hrPsychAnswers[q.id]);
  if (missing.length) {
    toast(`Faltan ${missing.length} respuesta(s). Completa todas.`);
    return;
  }
  const scored = scorePsychAnswers(model, hrPsychAnswers);
  app.psychTest = normalizeHrPsych({
    modelId,
    answers: { ...hrPsychAnswers },
    ...scored,
    completedAt: new Date().toISOString(),
  });
  app.updatedAt = new Date().toISOString();
  const idx = hrData.applications.findIndex((a) => a.id === app.id);
  if (idx >= 0) hrData.applications[idx] = app;
  saveHrData(true);
  logActivity("hr_psych", `Test RRHH ${app.fullName || app.id}: ${scored.score}/100 riesgo=${scored.violenceRisk}`);
  renderHrPsychPanel(app);
  renderHrHireSummary(app);
  toast(`Test calificado: ${scored.score}/100`);
}

function resetHrPsych() {
  const app = getHrApp(selectedHrAppId);
  if (!app || app.status === "hired") return;
  if (!window.confirm("¿Borrar el resultado del test para repetirlo (puede tocar otro modelo)?")) return;
  // Cambiar modelo rotando
  const next = (pickPsychModelId(app) % HR_PSYCH_MODELS.length) + 1;
  app.psychTest = normalizeHrPsych({ modelId: next });
  hrPsychAnswers = {};
  app.updatedAt = new Date().toISOString();
  saveHrData(true);
  renderHrPsychPanel(app);
  renderHrHireSummary(app);
  toast(`Nuevo modelo de test: ${next}`);
}

function renderHrHireSummary(app) {
  const el = document.getElementById("hrHireSummary");
  if (!el) return;
  const psych = app.psychTest?.completedAt
    ? `${app.psychTest.score}/100 · violencia ${app.psychTest.violenceRisk} · comprensión ${app.psychTest.comprehension}`
    : "Pendiente";
  const conf = app.confidentialitySigned ? "Firmada" : "Pendiente";
  const uniCount = HR_UNIFORM_ITEMS.filter((i) => app.uniforms && app.uniforms[i.key]).length;
  el.innerHTML = `
    <p><strong>Solicitante:</strong> ${escapeHtml(app.fullName || "—")}</p>
    <p><strong>Cédula:</strong> ${escapeHtml(app.cedula || "—")} · <strong>Tel:</strong> ${escapeHtml(app.phone || "—")}</p>
    <p><strong>Confidencialidad:</strong> ${conf}</p>
    <p><strong>Test psicológico:</strong> ${escapeHtml(psych)}</p>
    <p><strong>Uniformes/equipos marcados:</strong> ${uniCount}</p>
    ${app.hiredEmployeeId ? `<p class="muted">Ya contratado → empleado ${escapeHtml(app.hiredEmployeeId)}</p>` : ""}
  `;
  const btn = document.getElementById("btnHrHire");
  if (btn) btn.disabled = app.status === "hired" || !!app.hiredEmployeeId;
}

function hireHrApplication() {
  if (!canAccessRrhh()) return;
  if (typeof canWriteEmployees === "function" && !canWriteEmployees() && currentUser?.role !== "owner") {
    // Owner always; if user has rrhh they can hire into employees list
  }
  const app = getHrApp(selectedHrAppId);
  if (!app) return;
  readHrFormInto(app);
  if (app.status === "hired" || app.hiredEmployeeId) {
    toast("Esta solicitud ya fue contratada.");
    return;
  }
  if (!app.fullName) {
    toast("Falta el nombre para contratar.");
    return;
  }
  if (!app.cedula) {
    toast("Falta la cédula para contratar.");
    return;
  }
  if (!app.phone) {
    toast("Falta el teléfono para contratar.");
    return;
  }
  if (!app.confidentialitySigned) {
    toast("Debe estar marcada la hoja de confidencialidad firmada.");
    return;
  }
  if (!app.psychTest?.completedAt) {
    toast("Debe completar y calificar el test psicológico antes de contratar.");
    return;
  }
  if (app.psychTest.violenceRisk === "alto") {
    const okRisk = window.confirm("El test indica riesgo de violencia ALTO. ¿Contratar de todos modos?");
    if (!okRisk) return;
  }
  const dup = (employees || []).find(
    (e) => e.status !== "inactive" && (employeeKey(e.name) === employeeKey(app.fullName) || (e.cedula && e.cedula === app.cedula))
  );
  if (dup) {
    toast(`Ya existe un empleado activo similar: ${dup.name}`);
    return;
  }
  const noteParts = [
    "Alta desde RRHH",
    app.psychTest.recommendation ? `Test: ${app.psychTest.score}/100 (${app.psychTest.recommendation})` : "",
    app.hrNotes || "",
  ].filter(Boolean);
  const emp = normalizeEmployee({
    name: app.fullName,
    phone: app.phone,
    cedula: app.cedula,
    companyEntryDate: typeof localDateISO === "function" ? localDateISO() : new Date().toISOString().slice(0, 10),
    photo: app.photo || "",
    note: noteParts.join(" · "),
    status: "active",
  });
  employees.unshift(emp);
  employees.sort((a, b) => a.name.localeCompare(b.name, "es"));
  saveEmployees();
  app.status = "hired";
  app.hiredEmployeeId = emp.id;
  app.hiredAt = new Date().toISOString();
  app.updatedAt = new Date().toISOString();
  saveHrData(true);
  logActivity("hr_hire", `RRHH contrató: ${emp.name} (desde solicitud)`);
  fillHrForm(app);
  toast("Contratado. Ya está en la lista general de empleados.");
  if (typeof openEmployeeDetail === "function") {
    setTimeout(() => {
      if (window.confirm("¿Abrir la ficha del empleado ahora?")) {
        switchView("employeesView");
        openEmployeeDetail(emp.id);
      }
    }, 200);
  }
}

function deleteHrApplication(id) {
  if (!canAccessRrhh()) return;
  const app = getHrApp(id);
  if (!app) return;
  if (app.status === "hired") {
    toast("No se puede borrar una solicitud ya contratada (queda como historial).");
    return;
  }
  if (!window.confirm(`¿Eliminar la solicitud de ${app.fullName || "borrador"}?`)) return;
  hrData.applications = hrData.applications.filter((a) => a.id !== id);
  saveHrData(true);
  if (selectedHrAppId === id) {
    selectedHrAppId = null;
    setHrTab("list");
  } else {
    renderHrModule();
  }
  toast("Solicitud eliminada.");
}

function renderHrList() {
  const list = document.getElementById("hrAppList");
  const q = String(document.getElementById("hrSearch")?.value || "")
    .trim()
    .toLowerCase();
  if (!list) return;
  let rows = [...(hrData.applications || [])];
  if (q) {
    rows = rows.filter(
      (a) =>
        a.fullName.toLowerCase().includes(q) ||
        a.cedula.toLowerCase().includes(q) ||
        a.phone.toLowerCase().includes(q) ||
        (HR_STATUS[a.status] || "").toLowerCase().includes(q)
    );
  }
  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (!rows.length) {
    list.innerHTML = `<p class="empty">No hay solicitudes. Crea una con «Nueva solicitud».</p>`;
    return;
  }
  list.innerHTML = rows
    .map((a) => {
      const psych = a.psychTest?.completedAt ? `${a.psychTest.score}/100` : "Sin test";
      return `<article class="report-card">
        <div class="row">
          <div style="flex:1;min-width:0">
            <h3>${escapeHtml(a.fullName || "Sin nombre")}</h3>
            <span class="caja-code-pill">${escapeHtml(HR_STATUS[a.status] || a.status)}</span>
            <p style="margin-top:8px">${escapeHtml(a.cedula || "Sin cédula")} · ${escapeHtml(a.phone || "Sin tel")}</p>
            <p class="muted" style="margin-top:4px">Test: ${escapeHtml(psych)}</p>
          </div>
          <div style="text-align:right">
            ${a.photo ? `<img src="${a.photo}" alt="" style="width:52px;height:52px;object-fit:cover;border-radius:10px;margin-bottom:8px"/>` : ""}
            <button class="btn secondary btn-open-hr" type="button" data-id="${escapeHtml(a.id)}" style="width:auto;padding:6px 10px;font-size:12px">Abrir</button>
            ${a.status !== "hired" ? `<button class="btn danger btn-del-hr" type="button" data-id="${escapeHtml(a.id)}" style="width:auto;margin-top:6px;padding:6px 10px;font-size:12px">Borrar</button>` : ""}
          </div>
        </div>
      </article>`;
    })
    .join("");
  list.querySelectorAll(".btn-open-hr").forEach((btn) => btn.addEventListener("click", () => openHrApplication(btn.dataset.id)));
  list.querySelectorAll(".btn-del-hr").forEach((btn) => btn.addEventListener("click", () => deleteHrApplication(btn.dataset.id)));
}

function renderHrModule() {
  if (!canAccessRrhh()) return;
  const summary = document.getElementById("hrSummary");
  const apps = hrData.applications || [];
  const hired = apps.filter((a) => a.status === "hired").length;
  const pending = apps.filter((a) => a.status !== "hired" && a.status !== "rejected").length;
  if (summary) {
    summary.textContent = `${apps.length} solicitud(es) · ${pending} en proceso · ${hired} contratado(s)`;
  }
  if (hrTab === "list") renderHrList();
  else if (selectedHrAppId && getHrApp(selectedHrAppId)) fillHrForm(getHrApp(selectedHrAppId));
}

async function onHrPhotoSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    pendingHrPhoto = await compressImage(file, 720, 0.7);
    const img = document.getElementById("hrPhotoPreview");
    const wrap = document.getElementById("hrPhotoPreviewWrap");
    if (img && wrap) {
      img.src = pendingHrPhoto;
      wrap.hidden = false;
    }
    toast("Foto lista.");
  } catch (_) {
    toast("No se pudo procesar la foto.");
    pendingHrPhoto = null;
  }
}

function clearHrPhoto() {
  pendingHrPhoto = "";
  const input = document.getElementById("hrPhoto");
  if (input) input.value = "";
  const img = document.getElementById("hrPhotoPreview");
  const wrap = document.getElementById("hrPhotoPreviewWrap");
  if (wrap) wrap.hidden = true;
  if (img) img.removeAttribute("src");
  const app = getHrApp(selectedHrAppId);
  if (app) {
    app.photo = "";
    app.updatedAt = new Date().toISOString();
    saveHrData(true);
  }
}

function bindHrUi() {
  document.querySelectorAll(".hr-tabs .emp-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.hrTab === "form" && !selectedHrAppId) {
        startNewHrApplication();
        return;
      }
      setHrTab(btn.dataset.hrTab);
    });
  });
  document.querySelectorAll(".hr-section-tabs .emp-tab").forEach((btn) => {
    btn.addEventListener("click", () => setHrFormSection(btn.dataset.hrSection));
  });
  document.getElementById("btnHrNew")?.addEventListener("click", startNewHrApplication);
  document.getElementById("btnHrSave")?.addEventListener("click", saveHrApplicationFromForm);
  document.getElementById("btnHrBackList")?.addEventListener("click", () => setHrTab("list"));
  document.getElementById("btnHrScorePsych")?.addEventListener("click", scoreHrPsychFromForm);
  document.getElementById("btnHrResetPsych")?.addEventListener("click", resetHrPsych);
  document.getElementById("btnHrHire")?.addEventListener("click", hireHrApplication);
  document.getElementById("hrSearch")?.addEventListener("input", () => {
    if (hrTab === "list") renderHrList();
  });
  document.getElementById("hrPhoto")?.addEventListener("change", onHrPhotoSelected);
  document.getElementById("btnHrClearPhoto")?.addEventListener("click", clearHrPhoto);
  document.getElementById("hrUniformOtrosDetalle")?.addEventListener("change", () => {
    const app = getHrApp(selectedHrAppId);
    if (!app) return;
    app.uniforms = normalizeHrUniforms(app.uniforms);
    app.uniforms.otrosDetalle = document.getElementById("hrUniformOtrosDetalle").value.trim();
    app.updatedAt = new Date().toISOString();
    saveHrData(true);
  });
}

/* ==== FIN RRHH ==== */
