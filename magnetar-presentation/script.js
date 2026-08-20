/* Magnetar presentation — i18n (same three languages as the app: ru / en / es)
   + scroll reveals. No dependencies, works over file:// */

const I18N = {
  en: {
    "nav.problem": "Problem",
    "nav.solution": "Solution",
    "nav.how": "How it works",
    "nav.stack": "Stack",
    "nav.security": "Security",

    "hero.sub": "Local-first AI IDE. Persistent project memory. Model swapping without losing context.",
    "hero.cta": "View on GitHub ↗",
    "hero.cta2": "How it works",
    "hero.badge.telemetry": "Zero telemetry",

    "term.collecting": "… collecting current state",
    "term.writing": "outgoing model is writing a handoff note",
    "term.note.head": "handoff — where we stopped",
    "term.done": "done",
    "term.done.v": "auth middleware, token refresh",
    "term.next": "next",
    "term.next.v": "wire refresh into the retry queue",
    "term.watch": "watch",
    "term.watch.v": "refresh race on 401 storms",
    "term.injected": "memory injected into the first request",
    "term.continues": "kimi-k3 continues from the note — nothing re-explained",

    "problem.label": "The problem",
    "problem.title": "The model changed.<br>The context didn't survive.",
    "problem.lead": "Every AI chat keeps everything it learns inside the conversation. Close it, switch the model, hit the context limit — and the next session starts from zero.",
    "problem.1.t": "Re-explaining, forever",
    "problem.1.p": "You describe the architecture, the conventions, the decisions — again and again, to every new chat and every new model.",
    "problem.2.t": "Context evaporates",
    "problem.2.p": "Decisions made in chat stay in chat. Restart the app and the project you built together is a stranger again.",
    "problem.3.t": "Locked to one model",
    "problem.3.p": "Moving a task to a stronger or cheaper model means copy-pasting history and hoping nothing important got dropped.",

    "solution.label": "The solution",
    "solution.title": "The project is at the centre.<br>Models are interchangeable.",
    "solution.lead": "Magnetar maintains persistent project memory — an accumulated, structured understanding of your codebase. It lives outside any conversation and is attached to every request you send, to any model.",
    "solution.1.t": "Project memory",
    "solution.1.p": "Lives outside the chat — survives restarts, new sessions and model swaps.",
    "solution.2.t": "Injected per request",
    "solution.2.p": "Collected memory is appended to every request. The model starts already knowing the project.",
    "solution.3.t": "Handoff notes",
    "solution.3.p": "The outgoing model writes where it stopped; the next one continues from that exact point.",
    "solution.quote": "«The project is the constant. The model is the variable. Switching models is a serialisation detail, not a context loss.»",

    "how.label": "How it works",
    "how.title": "Memory is written by four triggers",
    "how.lead": "Updates happen in the background. Every write reports success or failure — with the reason — into a memory log you can actually read. No silent failures.",
    "how.1.t": "Open a folder",
    "how.1.p": "First audit: Magnetar scans the project and writes what it sees — stack, structure, entry points.",
    "how.2.t": "Chat grows",
    "how.2.p": "After ~10 messages the transcript is mined for facts, decisions and open questions into a knowledge graph.",
    "how.3.t": "Switch a model",
    "how.3.p": "The outgoing model writes a handoff note — where it stopped. The incoming model continues from it.",
    "how.4.t": "Save state",
    "how.4.p": "One click captures the current working state — decisions, next steps, what to watch out for.",
    "pipe.db": "local, bundled",
    "pipe.inject": "every request<br><span>memory attached</span>",

    "stack.label": "The stack",
    "stack.title": "Native where it matters,<br>familiar where it counts.",
    "stack.1.p": "Tauri backend — rusqlite, PTY, streaming HTTP.",
    "stack.2.p": "Zustand stores, Radix primitives.",
    "stack.3.p": "Strict mode, ESNext modules, end to end.",
    "stack.4.p": "Native window at a fraction of Electron's weight.",
    "stack.5.p": "Bundled — canon transcript, sessions, memory log.",
    "stack.6.p": "VS Code's editor, with CodeMirror language modes.",
    "stack.7.p": "Design system v3 via <code>@tailwindcss/vite</code>.",
    "stack.8.p": "A real terminal with working <code>clear</code> and control codes.",
    "byok.title": "BYOK providers:",
    "byok.react": "ReAct fallback for smaller models",

    "sec.label": "Security & privacy",
    "sec.title": "Your code never leaves the machine.<br>Your keys neither.",
    "sec.1.t": "Local-first",
    "sec.1.p": "The project, the memory, the transcripts — everything lives on your machine in a local SQLite database.",
    "sec.2.t": "BYOK",
    "sec.2.p": "Your own API keys go straight to the provider. There is no Magnetar account and no proxy in between.",
    "sec.3.t": "Locked-down secrets",
    "sec.3.p": "Keys are stored in <code>secrets.json</code> with <code>0600</code> permissions — only your user can read the file.",
    "sec.4.t": "Zero telemetry",
    "sec.4.p": "No analytics, no crash beacons. Trust-store TLS certificates — nothing breaks behind corporate MITM proxies.",

    "cta.title": "Models are interchangeable.<br>Your project isn't.",
    "cta.lead": "Free, open source, local-first. The roadmap is public — invite codes are next, then the game engine.",
    "footer.tag": "open source · local-first",
  },

  ru: {
    "nav.problem": "Проблема",
    "nav.solution": "Решение",
    "nav.how": "Как это работает",
    "nav.stack": "Стек",
    "nav.security": "Безопасность",

    "hero.sub": "Локальная AI IDE. Персистентная память проекта. Смена моделей без потери контекста.",
    "hero.cta": "Открыть на GitHub ↗",
    "hero.cta2": "Как это работает",
    "hero.badge.telemetry": "Ноль телеметрии",

    "term.collecting": "… собираю текущее состояние",
    "term.writing": "исходящая модель пишет handoff-заметку",
    "term.note.head": "handoff — где мы остановились",
    "term.done": "done",
    "term.done.v": "auth-мидлварь, обновление токена",
    "term.next": "next",
    "term.next.v": "подключить refresh к очереди ретраев",
    "term.watch": "watch",
    "term.watch.v": "гонка refresh при шквале 401",
    "term.injected": "память подключена к первому запросу",
    "term.continues": "kimi-k3 продолжает с заметки — ничего не объясняли заново",

    "problem.label": "Проблема",
    "problem.title": "Модель сменилась.<br>Контекст не выжил.",
    "problem.lead": "Каждый AI-чат хранит всё, что он узнал, внутри разговора. Закрой его, смени модель, упрёшься в лимит контекста — и следующая сессия начинается с нуля.",
    "problem.1.t": "Объясняешь снова и снова",
    "problem.1.p": "Архитектура, конвенции, решения — ты описываешь их заново каждому новому чату и каждой новой модели.",
    "problem.2.t": "Контекст испаряется",
    "problem.2.p": "Решения, принятые в чате, остаются в чате. Перезапусти приложение — и проект, который вы строили вместе, снова чужой.",
    "problem.3.t": "Привязка к одной модели",
    "problem.3.p": "Перенести задачу на более сильную или дешёвую модель — значит копипастить историю и надеяться, что ничего важное не потерялось.",

    "solution.label": "Решение",
    "solution.title": "Проект — в центре.<br>Модели взаимозаменяемы.",
    "solution.lead": "Magnetar ведёт персистентную память проекта — накопленное, структурированное понимание твоей кодовой базы. Она живёт вне любого разговора и прикрепляется к каждому запросу, к любой модели.",
    "solution.1.t": "Память проекта",
    "solution.1.p": "Живёт вне чата — переживает рестарты, новые сессии и смену моделей.",
    "solution.2.t": "Инжекция в каждый запрос",
    "solution.2.p": "Собранная память добавляется в каждый запрос. Модель с первого слова уже знает проект.",
    "solution.3.t": "Handoff-заметки",
    "solution.3.p": "Исходящая модель записывает, где остановилась; следующая продолжает ровно с этой точки.",
    "solution.quote": "«Проект — константа. Модель — переменная. Смена модели — это деталь сериализации, а не потеря контекста.»",

    "how.label": "Как это работает",
    "how.title": "Память пишут четыре триггера",
    "how.lead": "Обновления происходят в фоне. Каждая запись рапортует успех или ошибку — с причиной — в memory log, который реально можно прочитать. Никаких тихих падений.",
    "how.1.t": "Открытие папки",
    "how.1.p": "Первый аудит: Magnetar сканирует проект и записывает, что видит — стек, структуру, точки входа.",
    "how.2.t": "Рост чата",
    "how.2.p": "После ~10 сообщений транскрипт майнится на факты, решения и открытые вопросы — в граф знаний.",
    "how.3.t": "Смена модели",
    "how.3.p": "Исходящая модель пишет handoff-заметку — где остановилась. Входящая продолжает с неё.",
    "how.4.t": "Save state",
    "how.4.p": "Один клик сохраняет текущее рабочее состояние — решения, следующие шаги, за чем следить.",
    "pipe.db": "локально, bundled",
    "pipe.inject": "каждый запрос<br><span>память прикреплена</span>",

    "stack.label": "Стек",
    "stack.title": "Нативно там, где важно,<br>привычно там, где нужно.",
    "stack.1.p": "Бэкенд на Tauri — rusqlite, PTY, стриминг HTTP.",
    "stack.2.p": "Zustand-сторы, примитивы Radix.",
    "stack.3.p": "Strict mode, ESNext-модули, от края до края.",
    "stack.4.p": "Нативное окно при доле веса Electron.",
    "stack.5.p": "Bundled — canon-транскрипт, сессии, memory log.",
    "stack.6.p": "Редактор из VS Code + языковые режимы CodeMirror.",
    "stack.7.p": "Дизайн-система v3 через <code>@tailwindcss/vite</code>.",
    "stack.8.p": "Настоящий терминал с рабочим <code>clear</code> и control-кодами.",
    "byok.title": "BYOK-провайдеры:",
    "byok.react": "ReAct-фолбэк для небольших моделей",

    "sec.label": "Безопасность и приватность",
    "sec.title": "Твой код не покидает машину.<br>Твои ключи — тоже.",
    "sec.1.t": "Local-first",
    "sec.1.p": "Проект, память, транскрипты — всё живёт на твоей машине в локальной базе SQLite.",
    "sec.2.t": "BYOK",
    "sec.2.p": "Твои API-ключи идут напрямую провайдеру. Ни аккаунта Magnetar, ни прокси между вами.",
    "sec.3.t": "Закрытые секреты",
    "sec.3.p": "Ключи хранятся в <code>secrets.json</code> с правами <code>0600</code> — файл может прочитать только твой пользователь.",
    "sec.4.t": "Ноль телеметрии",
    "sec.4.p": "Ни аналитики, ни маяков о падениях. TLS-сертификаты из trust store — ничего не ломается за корпоративными MITM-прокси.",

    "cta.title": "Модели взаимозаменяемы.<br>Твой проект — нет.",
    "cta.lead": "Бесплатно, open source, local-first. Роадмап публичный — дальше инвайт-коды, затем игровой движок.",
    "footer.tag": "open source · local-first",
  },

  es: {
    "nav.problem": "El problema",
    "nav.solution": "La solución",
    "nav.how": "Cómo funciona",
    "nav.stack": "Stack",
    "nav.security": "Seguridad",

    "hero.sub": "IDE de IA local-first. Memoria persistente del proyecto. Cambio de modelos sin perder el contexto.",
    "hero.cta": "Ver en GitHub ↗",
    "hero.cta2": "Cómo funciona",
    "hero.badge.telemetry": "Cero telemetría",

    "term.collecting": "… recopilando el estado actual",
    "term.writing": "el modelo saliente está escribiendo una nota de handoff",
    "term.note.head": "handoff — dónde nos detuvimos",
    "term.done": "done",
    "term.done.v": "middleware de auth, refresco de token",
    "term.next": "next",
    "term.next.v": "conectar el refresh a la cola de reintentos",
    "term.watch": "watch",
    "term.watch.v": "carrera de refresh en tormentas de 401",
    "term.injected": "memoria inyectada en la primera petición",
    "term.continues": "kimi-k3 continúa desde la nota — nada que volver a explicar",

    "problem.label": "El problema",
    "problem.title": "El modelo cambió.<br>El contexto no sobrevivió.",
    "problem.lead": "Cada chat de IA guarda todo lo que aprende dentro de la conversación. Ciérralo, cambia el modelo, llega al límite de contexto — y la próxima sesión empieza desde cero.",
    "problem.1.t": "Explicando una y otra vez",
    "problem.1.p": "Describes la arquitectura, las convenciones, las decisiones — una y otra vez, a cada chat nuevo y a cada modelo nuevo.",
    "problem.2.t": "El contexto se evapora",
    "problem.2.p": "Las decisiones tomadas en el chat se quedan en el chat. Reinicia la app y el proyecto que construisteis juntos vuelve a ser un extraño.",
    "problem.3.t": "Atado a un solo modelo",
    "problem.3.p": "Mover una tarea a un modelo más potente o más barato significa copiar y pegar el historial y rezar para que no se pierda nada importante.",

    "solution.label": "La solución",
    "solution.title": "El proyecto está en el centro.<br>Los modelos son intercambiables.",
    "solution.lead": "Magnetar mantiene una memoria persistente del proyecto: una comprensión acumulada y estructurada de tu código. Vive fuera de cualquier conversación y se adjunta a cada petición que envías, a cualquier modelo.",
    "solution.1.t": "Memoria del proyecto",
    "solution.1.p": "Vive fuera del chat — sobrevive reinicios, nuevas sesiones y cambios de modelo.",
    "solution.2.t": "Inyectada en cada petición",
    "solution.2.p": "La memoria recopilada se adjunta a cada petición. El modelo empieza conociendo ya el proyecto.",
    "solution.3.t": "Notas de handoff",
    "solution.3.p": "El modelo saliente escribe dónde se detuvo; el siguiente continúa desde ese punto exacto.",
    "solution.quote": "«El proyecto es la constante. El modelo es la variable. Cambiar de modelo es un detalle de serialización, no una pérdida de contexto.»",

    "how.label": "Cómo funciona",
    "how.title": "La memoria se escribe con cuatro disparadores",
    "how.lead": "Las actualizaciones ocurren en segundo plano. Cada escritura informa éxito o error — con la razón — en un registro de memoria que de verdad puedes leer. Sin fallos silenciosos.",
    "how.1.t": "Abrir una carpeta",
    "how.1.p": "Primera auditoría: Magnetar escanea el proyecto y escribe lo que ve — stack, estructura, puntos de entrada.",
    "how.2.t": "El chat crece",
    "how.2.p": "Tras ~10 mensajes, la transcripción se mina en busca de hechos, decisiones y preguntas abiertas hacia un grafo de conocimiento.",
    "how.3.t": "Cambiar de modelo",
    "how.3.p": "El modelo saliente escribe una nota de handoff — dónde se detuvo. El entrante continúa desde ella.",
    "how.4.t": "Guardar estado",
    "how.4.p": "Un clic captura el estado de trabajo actual — decisiones, próximos pasos, qué vigilar.",
    "pipe.db": "local, incluida",
    "pipe.inject": "cada petición<br><span>memoria adjunta</span>",

    "stack.label": "El stack",
    "stack.title": "Nativo donde importa,<br>familiar donde cuenta.",
    "stack.1.p": "Backend Tauri — rusqlite, PTY, HTTP en streaming.",
    "stack.2.p": "Stores Zustand, primitivas Radix.",
    "stack.3.p": "Modo estricto, módulos ESNext, de punta a punta.",
    "stack.4.p": "Ventana nativa con una fracción del peso de Electron.",
    "stack.5.p": "Incluida — transcripción canónica, sesiones, registro de memoria.",
    "stack.6.p": "El editor de VS Code, con modos de lenguaje CodeMirror.",
    "stack.7.p": "Sistema de diseño v3 vía <code>@tailwindcss/vite</code>.",
    "stack.8.p": "Un terminal real con <code>clear</code> y códigos de control funcionando.",
    "byok.title": "Proveedores BYOK:",
    "byok.react": "Fallback ReAct para modelos pequeños",

    "sec.label": "Seguridad y privacidad",
    "sec.title": "Tu código nunca sale de la máquina.<br>Tus claves tampoco.",
    "sec.1.t": "Local-first",
    "sec.1.p": "El proyecto, la memoria, las transcripciones — todo vive en tu máquina en una base SQLite local.",
    "sec.2.t": "BYOK",
    "sec.2.p": "Tus propias claves API van directo al proveedor. No hay cuenta Magnetar ni proxy en medio.",
    "sec.3.t": "Secretos bajo llave",
    "sec.3.p": "Las claves se guardan en <code>secrets.json</code> con permisos <code>0600</code> — solo tu usuario puede leer el archivo.",
    "sec.4.t": "Cero telemetría",
    "sec.4.p": "Sin analítica, sin balizas de fallos. Certificados TLS del trust store — nada se rompe tras proxies MITM corporativos.",

    "cta.title": "Los modelos son intercambiables.<br>Tu proyecto no.",
    "cta.lead": "Gratis, open source, local-first. La hoja de ruta es pública — siguen los códigos de invitación, luego el motor de juegos.",
    "footer.tag": "open source · local-first",
  },
};

/* ------------------------------------------------------------------ i18n */
const SUPPORTED = ["ru", "en", "es"];

function applyLang(lang) {
  const dict = I18N[lang] || I18N.en;
  document.documentElement.lang = lang;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const value = dict[key] ?? I18N.en[key];
    if (value == null) return;
    // keys that embed markup (br, code) use innerHTML; plain ones use textContent
    if (/<[a-z]+/i.test(value)) el.innerHTML = value;
    else el.textContent = value;
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    const value = dict[key] ?? I18N.en[key];
    if (value != null) el.innerHTML = value;
  });

  document.querySelectorAll(".lang-switch button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });

  try { localStorage.setItem("magnetar-pres-lang", lang); } catch (_) {}
}

function detectLang() {
  let saved = null;
  try { saved = localStorage.getItem("magnetar-pres-lang"); } catch (_) {}
  if (SUPPORTED.includes(saved)) return saved;
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  return SUPPORTED.includes(nav) ? nav : "en";
}

document.querySelectorAll(".lang-switch button").forEach((btn) => {
  btn.addEventListener("click", () => applyLang(btn.dataset.lang));
});

applyLang(detectLang());

/* ------------------------------------------------------- Scroll reveals */
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reduceMotion && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -32px 0px" }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
} else {
  document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
}
