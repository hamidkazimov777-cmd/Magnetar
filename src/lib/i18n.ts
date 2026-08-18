import { useStore } from "./store";

export type Lang = "ru" | "en" | "es";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

type Dict = Record<string, string>;

const ru: Dict = {
  newChat: "Новый чат",
  noChats: "Пока нет чатов.",
  settingsKeys: "Настройки и ключи",
  noConnection: "Нет подключения",
  adaptive: "Адаптивный",
  adaptiveHint: "Адаптивный режим: Magnetar подбирает подходящую модель под запрос",
  agent: "Агент",
  agentHint: "Режим агента: модель может читать/менять файлы и выполнять команды (разрушающие — с подтверждением)",
  confirmTitle: "Подтвердить действие",
  confirmApprove: "Разрешить",
  confirmDecline: "Отклонить",
  addConnection: "Добавить подключение",
  connection: "Подключение",
  loadingModels: "Загрузка моделей…",
  noModels: "Модели не найдены.",
  selectModel: "Выбрать модель",
  sendHint: "Enter — отправить · Shift+Enter — новая строка",
  messagePlaceholder: "Сообщение Magnetar…",
  addConnFirst: "Добавь подключение, чтобы начать…",
  emptyReady: "Спроси что угодно. Модель можно переключать на лету сверху.",
  emptyNotReady: "Добавь подключение и вставь API-ключ, чтобы начать.",
  adaptiveUsing: "Адаптивно: {model} — {reason}",
  reason_light: "короткий/бытовой запрос",
  reason_standard: "обычный запрос",
  reason_heavy: "сложная задача (код/большой объём)",
  upgradeSuggest: "Задача сложная — подключить {model} ({conn})?",
  switchedTo: "Переключено на {model}",
  // settings
  connectionsTitle: "Подключения",
  addConnectionBtn: "Добавить",
  providerOpenai: "OpenAI-совместимый",
  providerGiga: "GigaChat",
  fieldName: "Название",
  fieldBaseUrl: "Base URL",
  fieldApiKey: "API key",
  fieldGigaAuth: "Authorization key (Basic)",
  fieldScope: "Scope",
  fieldCaPath: "Свой CA-сертификат (PEM) — необязательно",
  gigaNote:
    "Russian Trusted Root CA уже встроен — просто вставь ключ и работай. OAuth идёт на порт 9443, токен кэшируется, запросы сериализуются (freemium — 1 за раз).",
  keychainNote: "Ключи хранятся в macOS Keychain, не в открытом виде на диске.",
  keyInKeychain: "Ключ в Keychain",
  noKey: "Нет ключа",
  errFillNameKey: "Заполни имя и ключ.",
  errNeedBaseUrl: "Нужен base URL.",
  language: "Язык",
};

const en: Dict = {
  newChat: "New chat",
  noChats: "No chats yet.",
  settingsKeys: "Settings & keys",
  noConnection: "No connection",
  adaptive: "Adaptive",
  adaptiveHint: "Adaptive mode: Magnetar picks the right-sized model per prompt",
  agent: "Agent",
  agentHint: "Agent mode: the model can read/change files and run commands (destructive ones need confirmation)",
  confirmTitle: "Confirm action",
  confirmApprove: "Allow",
  confirmDecline: "Decline",
  addConnection: "Add a connection",
  connection: "Connection",
  loadingModels: "Loading models…",
  noModels: "No models returned.",
  selectModel: "Select model",
  sendHint: "Enter to send · Shift+Enter for newline",
  messagePlaceholder: "Message Magnetar…",
  addConnFirst: "Add a connection to start…",
  emptyReady: "Ask anything. Switch the model on the fly up top.",
  emptyNotReady: "Add a connection and paste an API key to begin.",
  adaptiveUsing: "Adaptive: {model} — {reason}",
  reason_light: "short/casual prompt",
  reason_standard: "regular prompt",
  reason_heavy: "complex task (code/large)",
  upgradeSuggest: "This looks complex — switch to {model} ({conn})?",
  switchedTo: "Switched to {model}",
  connectionsTitle: "Connections",
  addConnectionBtn: "Add",
  providerOpenai: "OpenAI-compatible",
  providerGiga: "GigaChat",
  fieldName: "Name",
  fieldBaseUrl: "Base URL",
  fieldApiKey: "API key",
  fieldGigaAuth: "Authorization key (Basic)",
  fieldScope: "Scope",
  fieldCaPath: "Custom CA certificate (PEM) — optional",
  gigaNote:
    "The Russian Trusted Root CA is built in — just paste your key and go. OAuth uses port 9443; the token is cached; requests are serialized (freemium — 1 at a time).",
  keychainNote: "Keys are stored in the macOS Keychain, never on disk in plaintext.",
  keyInKeychain: "Key in Keychain",
  noKey: "No key",
  errFillNameKey: "Fill in name and key.",
  errNeedBaseUrl: "Base URL is required.",
  language: "Language",
};

const es: Dict = {
  newChat: "Nuevo chat",
  noChats: "Aún no hay chats.",
  settingsKeys: "Ajustes y claves",
  noConnection: "Sin conexión",
  adaptive: "Adaptativo",
  adaptiveHint: "Modo adaptativo: Magnetar elige el modelo adecuado para cada mensaje",
  agent: "Agente",
  agentHint: "Modo agente: el modelo puede leer/cambiar archivos y ejecutar comandos (los destructivos requieren confirmación)",
  confirmTitle: "Confirmar acción",
  confirmApprove: "Permitir",
  confirmDecline: "Rechazar",
  addConnection: "Añadir conexión",
  connection: "Conexión",
  loadingModels: "Cargando modelos…",
  noModels: "No se devolvieron modelos.",
  selectModel: "Elegir modelo",
  sendHint: "Enter para enviar · Shift+Enter para salto de línea",
  messagePlaceholder: "Mensaje a Magnetar…",
  addConnFirst: "Añade una conexión para empezar…",
  emptyReady: "Pregunta lo que quieras. Cambia el modelo al vuelo arriba.",
  emptyNotReady: "Añade una conexión y pega una clave API para empezar.",
  adaptiveUsing: "Adaptativo: {model} — {reason}",
  reason_light: "mensaje corto/cotidiano",
  reason_standard: "mensaje normal",
  reason_heavy: "tarea compleja (código/extensa)",
  upgradeSuggest: "Parece complejo — ¿cambiar a {model} ({conn})?",
  switchedTo: "Cambiado a {model}",
  connectionsTitle: "Conexiones",
  addConnectionBtn: "Añadir",
  providerOpenai: "Compatible con OpenAI",
  providerGiga: "GigaChat",
  fieldName: "Nombre",
  fieldBaseUrl: "Base URL",
  fieldApiKey: "Clave API",
  fieldGigaAuth: "Clave de autorización (Basic)",
  fieldScope: "Scope",
  fieldCaPath: "Certificado CA propio (PEM) — opcional",
  gigaNote:
    "El Russian Trusted Root CA ya está integrado — solo pega tu clave y listo. OAuth usa el puerto 9443; el token se cachea; las solicitudes se serializan (freemium — 1 a la vez).",
  keychainNote: "Las claves se guardan en el Keychain de macOS, nunca en texto plano.",
  keyInKeychain: "Clave en Keychain",
  noKey: "Sin clave",
  errFillNameKey: "Rellena nombre y clave.",
  errNeedBaseUrl: "Se requiere el Base URL.",
  language: "Idioma",
};

const DICTS: Record<Lang, Dict> = { ru, en, es };

export function translate(
  lang: Lang,
  key: string,
  vars?: Record<string, string>,
): string {
  let s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

/** Hook: returns a `t(key, vars?)` bound to the current language. */
export function useT() {
  const lang = useStore((s) => s.lang);
  return (key: string, vars?: Record<string, string>) =>
    translate(lang, key, vars);
}
