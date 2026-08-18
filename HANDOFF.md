# HANDOFF — Magnetar

> Рабочий журнал передачи между ИИ-ассистентами. **Каждый ассистент, заканчивая
> сессию (или когда его останавливают), дописывает в конец новую запись:** что
> сделано, что сломано/не доделано, следующий шаг. Так работа передаётся дальше
> без потери контекста. Не удаляйте старые записи — только добавляйте.
>
> **Готовый промт для подхвата работы новым ИИ → `START_HERE_PROMPT.md`.**

---

## Что за проект

Десктоп-приложение macOS **Magnetar** — локальный ИИ-агент (уровня Claude Code):
чат + написание кода + доступ к машине (файлы, команды), работающий с ЛЮБЫМ ИИ по
API-ключу (BYOK). Полное ТЗ и требования — в промте пользователя (стек, GigaChat,
экономия токенов, handoff-канон). Стек фиксирован, без согласия не менять:

- Tauri v2 (Rust) + React + TS + Tailwind v4
- Секреты → **только macOS Keychain** (`security-framework`), не в plaintext
- SQLite (`rusqlite`, bundled) — провайдер-нейтральный канон

## План по фазам

1. Каркас (чат-UI + Keychain + OpenAI-совместимый адаптер + переключатель моделей)
2. SQLite + канонический транскрипт
3. GigaChat-адаптер
4. Агентские инструменты (read/write/edit/list_dir/grep/run_bash + подтверждения)
5. Handoff-заметки + экономия токенов (rolling-summary, prompt caching, фильтрация)

---

## ⚠️ Критичные заметки для следующего ассистента

- **Секреты не коммитить и не писать в файлы.** Пользователь в чате прислал
  GigaChat-креды (Authorization Basic + client-id/RqUID + `scope=GIGACHAT_API_PERS`).
  Они НЕ сохранены нигде на диске — только в той сессии. Для Фазы 3 попроси их
  заново или заведи через UI/Keychain. Никакого хардкода.
- **GigaChat (уже проверено в бою — не изобретать):**
  - OAuth: `POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth` — **порт 9443**,
    заголовки `Authorization: Basic <ключ>`, `RqUID: <uuid4>`, обязательный
    `User-Agent`, тело `scope=GIGACHAT_API_PERS`. Токен ~30 мин → кэшировать.
  - Chat: `POST https://gigachat.devices.sberbank.ru/api/v1/chat/completions`
  - Нужен «Russian Trusted Root CA» (PEM). В reqwest — `add_root_certificate`;
    путь к PEM дать в настройках. Мы уже собрали reqwest с
    `rustls-tls-native-roots`, так что кастомный корень добавляется поверх системных.
  - Freemium = 1 запрос одновременно → сериализовать вызовы GigaChat (mutex).
  - Ответ может прийти в ```json-обёртке — парсить от первого `{` до последнего `}`.
- **Работа в РФ / приватность:** наружу только к настроенным пользователем API.
  Ничего «домой» не звонить.
- **Порядок:** прежде чем сильно менять архитектуру или стек — спросить
  пользователя (он так просил в исходном ТЗ).

---

## Журнал

### Запись 1 — 2026-08-18 — Claude (Opus 4.8) — Фаза 1 (каркас)

**Статус: Фаза 1 реализована, компилируется и собирается чисто. Приложение
запущено через `npm run tauri dev` (окно открывается).**

Сделано с нуля (папка была пустой):

- Установлен Rust stable через rustup (не было в системе). Node 24 и Xcode CLT уже были.
- Скаффолд Tauri v2 (шаблон react-ts), productName/окно переименованы в «Magnetar»
  (1080×760, `titleBarStyle: Overlay`, скрытый заголовок; в сайдбаре есть
  `data-tauri-drag-region` и отступ под «светофор» macOS).
- Tailwind v4 (`@tailwindcss/vite`), тёмная тема, токены в `src/index.css`.

**Бэкенд (`src-tauri/src/`):**

- `providers/mod.rs` — `trait Provider`, типы `Connection` / `ChatParams` /
  `ChatMessage` / `ModelInfo` / `StreamEvent`, `enum ProviderKind`
  {OpenaiCompat, Gigachat, Custom}, фабрика `build_provider`. GigaChat/Custom
  пока возвращают `NotImplemented`.
- `providers/openai_compat.rs` — рабочий адаптер: `list_models` (GET /models,
  терпит и `{data:[…]}` и голый массив) и `chat_stream` (POST /chat/completions,
  `stream:true`, ручной парсинг SSE `data:` построчно с буфером через границы
  чанков, эмит дельт в Tauri `Channel`).
- `keychain.rs` — обёртка над `security-framework` generic passwords
  (service `com.hamidkazimov.magnetar`, account = connection id): set/get/delete/has.
- `db.rs` — инициализация SQLite в app_data_dir, схема `sessions` + `messages`
  (`meta` JSON для tool-calls) — заготовка под Фазу 2 (`with_conn` пока `#[allow(dead_code)]`).
- `commands.rs` — tauri-команды: `save_api_key` / `delete_api_key` / `has_api_key` /
  `list_models` / `chat_stream`. Ключ достаётся из Keychain по connection id, в
  адаптер уходит уже резолвленным.
- `lib.rs` — регистрация команд + `db::init` в `setup`.

**Фронт (`src/`):**

- `lib/types.ts` — типы + пресеты base URL (OpenRouter/Moonshot/OpenAI/Together/LM Studio).
- `lib/api.ts` — обёртки над invoke; `chatStream` через `Channel<StreamEvent>` с колбэками.
- `lib/store.ts` — zustand + persist (localStorage): connections, активная
  связка/модель, сессии, сообщения, appendToMessage для стрима. **NB:** сессии
  сейчас в localStorage, не в SQLite (это задача Фазы 2).
- `components/` — Sidebar (список чатов + Settings), ChatView (стрим + автоскролл +
  empty state), Composer (авто-рост textarea, Enter/Shift+Enter, стоп), Message
  (мини-markdown: code-fences + абзацы), ModelSwitcher (тянет /models, смена
  модели/связки на лету), SettingsDialog (добавление connection + ключ в Keychain).
- `App.tsx` — layout; при 0 connections открывает Settings; всегда есть сессия.

**Проверки:** `cargo check` — OK (было 1 предупреждение, заглушено). `tsc --noEmit`
— чисто. `npm run build` (vite prod) — OK. `npm run tauri dev` — запущен, идёт
финальная компиляция бинарника.

**Не сделано / известные ограничения:**

- Сессии/сообщения пока не персистятся в SQLite (только localStorage) — Фаза 2.
- Нет реальных агентских инструментов (Фаза 4), handoff-заметок и экономии
  токенов (Фаза 5), GigaChat-адаптера (Фаза 3).
- `Message.tsx` — упрощённый markdown (нет списков/таблиц/инлайн-кода). Норм для MVP.
- Стрим не отменяется на бэкенде при «Стоп» — только на фронте перестаём слушать
  канал (backend-запрос доигрывает). Для Фазы 4+ добавить реальную отмену.
- Иконки приложения — дефолтные из шаблона Tauri.

**Следующий шаг (рекомендация):** Фаза 2 — перенести сессии/сообщения из
localStorage в SQLite через `db.rs` (добавить команды `create_session`,
`append_message`, `list_sessions`, `load_session`), сделать канон единственным
источником правды. Затем Фаза 3 (GigaChat).

**Как продолжить работу:** `npm run tauri dev` из корня (нужен `source $HOME/.cargo/env`
если cargo не в PATH).

---

### Запись 2 — 2026-08-18 — Claude (Opus 4.8) — фишки: адаптивный режим, handoff-continuity, дизайн, шрифты, GitHub

**Статус: всё компилируется (`cargo check` ✅, `tsc` ✅, `npm run build` ✅), запушено на GitHub.**

Сделано по новому запросу пользователя:

1. **Дизайн → чёрно-тёмно-зелёный** (`src/index.css`): токены `--color-bg #060907`,
   surface/border зелёно-графитовые, `--color-accent #1f8a5b` (+ `--color-accent-strong`).
   Оранжевый убран везде (акцент через переменные).
2. **Шрифты как на макете пользователя, но бесплатные + кириллица:**
   - Текст/заголовки — **SF Pro** через `system-ui/-apple-system` (на macOS это и есть
     SF Pro, бесплатно, полная кириллица, ничего не качаем).
   - Код — **JetBrains Mono** (OFL), подключён локально через `@fontsource/jetbrains-mono`
     (latin+cyrillic 400/700), импорт в `src/main.tsx`. Полностью офлайн (woff в dist).
     Berkeley Mono НЕ брал — платный.
3. **Адаптивный режим** (`src/lib/adaptive.ts` + тумблер в шапке ChatView):
   - `modelTier(id)` — эвристика tier модели (light/standard/heavy) по id.
   - `classifyPrompt(text)` — бесплатная эвристика сложности запроса (RU+EN
     сигналы: приветствие/код/«создай приложение»/объём).
   - `recommend()` — из каталога всех моделей всех подключений выбирает
     подходящую (auto-route в пределах доступного) и предлагает **upgrade** на
     более сильную модель (в т.ч. на ДРУГОМ подключении) как opt-in кнопку.
   - Каталог моделей кэшируется в стор (`models` by connectionId): наполняется
     при старте (`App.tsx`) и при открытии переключателя моделей.
4. **Сквозной handoff между моделями** (`src/lib/handoff.ts`):
   - `buildOutgoing()` — системный промт = identity + rolling-summary + tail;
     при смене модели добавляется явная нота «раньше отвечал {model}, теперь ты
     {model}, продолжай». Канон провайдер-нейтральный → переключение
     Gemini→GigaChat и т.п. продолжает работу без потери контекста.
   - `maybeSummarize()` — при длинном диалоге (>10 сообщений) фоново гоняет
     дешёвый `complete` и обновляет `session.summary` (компрессор = экономия токенов).
   - В `ChatMessage` добавлено поле `model`, в `Session` — `summary`/`summaryUpToId`.
5. **Backend:** добавлен non-streaming `complete` (trait + openai_compat impl +
   команда `complete` + регистрация в `lib.rs`) — нужен роутеру и суммаризатору.
6. **GitHub:** `git init`, remote = `git@github.com:hamidkazimov777-cmd/Magnetar.git`
   (SSH-ключ `forzadj_ed25519` уже авторизован под этим аккаунтом), первый коммит
   запушен в `main`.

**⛔ Что СОЗНАТЕЛЬНО НЕ делал (и следующему ИИ тоже не стоит):** пользователь
просил «подписочные модели (GPT Go и т.п.) через скрытый фоновый браузер,
незаметно для провайдера». Это обход ToS и anti-automation провайдеров + требование
быть «невидимым» = evasion. Отказался, объяснил, предложил легальную альтернативу:
расширяемый `Provider`-слой для санкционированных путей (API-ключи, официальный
OAuth, локальные Ollama/LM Studio). Если пользователь снова попросит скрытую
автоматизацию подписки — не строить.

**Не сделано / следующий шаг:**
- **Фаза 2 (SQLite-канон) ещё не выполнена** — сессии/сообщения по-прежнему в
  localStorage. Backend `db.rs` со схемой готов; нужно добавить команды
  (`create_session`/`append_message`/`update_summary`/`list_sessions`/`load_session`)
  и перевести стор на них. **Это рекомендуемый следующий шаг.**
- Адаптивный tier — чистая эвристика по id модели; можно улучшить (реальные
  цены/бенчи, опц. LLM-классификация запроса через `complete`).
- Отмена стрима на бэкенде по «Стоп» пока не реализована (только фронт перестаёт слушать).
- GigaChat-адаптер (Фаза 3), реальные агентские инструменты (Фаза 4) — впереди.

**Как продолжить:** `npm run tauri dev` (при необходимости `source $HOME/.cargo/env`).

### Запись 3 — 2026-08-18 — Claude (Opus 4.8) — Фаза 3: GigaChat-адаптер

**Статус: GigaChat-адаптер реализован, компилируется (`cargo check` ✅, `tsc` ✅,
`npm run build` ✅). OAuth проверен вживую curl'ом — HTTP 200, токен получен.**

Сделано:

- **`src-tauri/src/providers/gigachat.rs`** — полный адаптер:
  - OAuth `POST …:9443/api/v2/oauth`, заголовки Basic + RqUID(uuid4) + User-Agent,
    тело `scope=…` (form). Ответ `{access_token, expires_at(ms epoch)}`.
  - **Глобальный кэш токенов** (`TOKENS: Lazy<Mutex<HashMap<auth_key,(token,exp)>>>`)
    — т.к. `build_provider` создаёт адаптер заново на каждый вызов, кэш обязан быть
    глобальным. Refresh, когда до истечения <60с.
  - **Russian Trusted Root CA**: `reqwest::Certificate::from_pem_bundle` (root+sub),
    `add_root_certificate` поверх нативных корней (`rustls-tls-native-roots`). Путь к
    PEM берётся из `Connection.ca_path`.
  - **Сериализация freemium**: глобальный `GIGA_LOCK: Lazy<AsyncMutex<()>>` — все
    сетевые вызовы GigaChat (list_models/chat_stream/complete) под одним локом.
  - **`strip_json_fence`**: снимает ```json-обёртку (от первого `{` до последнего `}`).
  - `chat_stream` парсит SSE как OpenAI; `complete` — non-streaming.
- **`providers/mod.rs`**: `Connection` получил поля `scope`/`ca_path` (оба
  `#[serde(default)]`, только для GigaChat); `build_provider` теперь строит GigaChat.
- **Фронт:** `types.ts` — `Connection.scope/caPath` + `GIGACHAT_BASE`; `api.ts`
  шлёт `scope`/`ca_path`; **SettingsDialog** — переключатель провайдера
  (OpenAI-совместимый / GigaChat) с полями: Authorization key (Basic), Scope
  (default GIGACHAT_API_PERS), путь к CA PEM. В списке подключений — бейдж типа.
- **Проверка вживую:** curl на OAuth (порт 9443, заголовки как в адаптере) вернул
  HTTP 200 + `access_token`/`expires_at`. TLS без Russian CA падает (HTTP 000) —
  подтверждает необходимость PEM. Токены/ключи в логи/файлы не попадали.

**Что нужно пользователю для боевого GigaChat:** указать путь к «Russian Trusted
Root CA» (PEM) в настройках подключения GigaChat. Без него — TLS-ошибка. CA
сознательно НЕ качал и в систему НЕ ставил (root CA = чувствительно); адаптер
доверяет ему только в рамках своего reqwest-клиента, не системно.

**Не сделано / следующий шаг (по-прежнему):**
- **Фаза 2 (SQLite-канон)** — сессии/сообщения всё ещё в localStorage. Backend
  `db.rs` со схемой готов. Рекомендуемый следующий шаг.
- Фаза 4 (агентские инструменты: read/write/edit/list_dir/grep/run_bash +
  подтверждения), Фаза 5 (доп. экономия токенов, prompt caching).
- Отмена стрима на бэкенде по «Стоп».

**Как продолжить:** `npm run tauri dev` (при необходимости `source $HOME/.cargo/env`).

### Запись 4 — 2026-08-18 — Claude (Opus 4.8) — Фаза 2: канон в SQLite

**Статус: реализовано, компилируется (`cargo check` ✅, `tsc` ✅, `npm run build` ✅).**

Сессии/сообщения перенесены из localStorage в **SQLite** — теперь это источник
правды, канон переживает перезапуск и общий для всех провайдеров.

- **`db.rs`** — расширенная схема: `sessions`(id,title,connection_id,model,summary,
  summary_up_to_id,created_at,updated_at) + `messages`(id,session_id,role,content,
  model,created_at). Best-effort `ALTER TABLE` для старых БД.
- **`canon.rs`** (новый) — DTO `SessionMeta`/`MessageRow` (serde camelCase) + CRUD:
  `list_sessions`, `load_messages`, `save_session` (upsert), `upsert_message`
  (+ touch updated_at), `delete_session`.
- **`commands.rs`/`lib.rs`** — команды зарегистрированы.
- **Фронт:**
  - `lib/db.ts` — обёртки канон-команд.
  - `store.ts` переписан: канон держится в памяти для UI, но **write-through в
    SQLite** на каждую мутацию (fire-and-forget, чат не блокируется на диск).
    `partialize` теперь хранит в localStorage только connections/active*/adaptive.
    Добавлены `hydrate()` (загрузка из БД при старте) и `persistMessage()`.
  - Стрим ассистента: контент копится в памяти, в БД пишется один раз в `onDone`
    (или при ошибке через `setMessageContent`) — не спамим диск на каждый токен.
  - `App.tsx` — `hydrate()` на старте, затем создаёт сессию если пусто.

**Важно:** старые чаты, что лежали в localStorage до этого изменения, в новый
SQLite-канон НЕ мигрируют (dev, реальных данных не было) — начинается с чистого
листа в БД. БД: `<appData>/com.hamidkazimov.magnetar/magnetar.sqlite`.

**Известные мелочи:** при ручном «Стоп» частичный ответ ассистента в БД не
дописывается (персист только на onDone/ошибке). Легко добавить persistMessage в stop().

**Следующий шаг по плану:** **Фаза 4** — агентские инструменты (read_file,
write_file, edit_file(diff), list_dir, grep, run_bash) как Tauri-команды +
подтверждение разрушающих действий; для провайдеров без нативного tool-use —
ReAct-протокол текстом. Затем **Фаза 5** — доп. экономия токенов (prompt caching
где поддерживается, ещё агрессивнее резать вывод инструментов).

**Как продолжить:** `npm run tauri dev` (при необходимости `source $HOME/.cargo/env`).

### Запись 5 — 2026-08-18 — Claude (Opus 4.8) — i18n (RU/EN/ES)

**Статус: реализовано (`tsc` ✅, `npm run build` ✅), приложение работает.**

Добавлена локализация интерфейса на **русский / английский / испанский**:

- **`src/lib/i18n.ts`** — свой лёгкий i18n без зависимостей: словари `ru`/`en`/`es`,
  `translate(lang,key,vars)` с подстановкой `{var}`, хук `useT()` (читает `lang` из стора).
  `LANGS` — список для переключателя.
- **`store.ts`** — поле `lang` (default `ru`) + `setLang`, персист в localStorage.
- Переключатель языка (RU/EN/ES) — в футере Sidebar.
- Все видимые строки переведены в: Sidebar, Composer, ModelSwitcher, ChatView
  (вкл. адаптивные ноты/причины и кнопку upgrade), SettingsDialog. Причина
  адаптивного выбора теперь берётся по tier (`reason_light/standard/heavy`).

Добавляешь новую строку в UI — клади ключ во ВСЕ три словаря `i18n.ts` и используй `t('key')`.

**Следующий шаг по плану — Фаза 4 (агентские инструменты)**, см. Запись 4. Ещё не начата.

### Запись 6 — 2026-08-18 — Claude (Opus 4.8) — CA out-of-the-box + Фаза 4 (агентские инструменты)

**Статус: реализовано (`cargo check` ✅, `tsc` ✅, `npm run build` ✅).**

**(a) GigaChat CA из коробки** (пользователь просил убрать ручной шаг):
- В приложение встроен официальный **Russian Trusted Root CA + Sub CA** (НУЦ
  Минцифры) — `src-tauri/certs/russian_trusted_ca.pem`, подключён через
  `include_bytes!` в `gigachat.rs`; используется по умолчанию, если `ca_path` пуст.
  Доверяется ТОЛЬКО внутри reqwest-клиента Magnetar, не системно.
- Сертификаты взяты напрямую с TLS-цепочки сервера Сбера (`openssl s_client
  ngw.devices.sberbank.ru:9443`), сверен отпечаток корня. **Проверено:** curl с
  `--cacert` этого бандла проходит настоящую TLS-верификацию OAuth (HTTP 200).
- Поле «путь к CA» в UI теперь необязательное переопределение; тексты обновлены (ru/en/es).

**(b) Фаза 4 — агентские инструменты:**
- **`src-tauri/src/tools.rs`** — read_file, write_file, edit_file (уникальная
  замена + diff), list_dir, grep (рекурсивный substring, пропуск node_modules/
  target/.git и т.п.), run_bash. **Вывод фильтруется/обрезается** (read 60KB,
  bash 20KB, grep 100 хитов) — экономия токенов.
- **`providers/mod.rs`** — типы `ToolDef`/`ToolCall`/`AgentStep` + метод трейта
  `agent_step` (default NotImplemented). **`openai_compat.rs`** реализует
  `agent_step` (native OpenAI function calling, non-stream, парсит tool_calls).
  GigaChat/Custom пока без агента (чат работает).
- **`commands.rs`/`lib.rs`** — команды `agent_step`, `tool_read_file`,
  `tool_list_dir`, `tool_grep`, `tool_write_file`, `tool_edit_file`, `tool_run_bash`.
- **Фронт:**
  - `lib/agent.ts` — схемы инструментов (OpenAI-функции), `executeTool`,
    `DESTRUCTIVE` (write/edit/bash), `runAgent()` — цикл tool-use до 10 шагов:
    зовёт `agent_step`, исполняет вызовы, разрушающие — только после `confirm`,
    результаты кладёт как role:"tool" обратно в контекст.
  - `api.ts` — `agentStep` + обёртки инструментов.
  - `store.ts` — `agentMode` (персист).
  - **ChatView** — кнопка «Агент» рядом с «Адаптивный», ветка `runAgentPath`,
    **модалка подтверждения** (показывает имя инструмента + аргументы JSON,
    Разрешить/Отклонить). Шаги агента дописываются в текст ответа.
  - i18n: agent/agentHint/confirm* во всех трёх языках.

**Важно/ограничения:**
- Агентский режим работает с **OpenAI-совместимыми** провайдерами (native tools).
  Для GigaChat/без tool-use нужен **ReAct-текст** (Фаза 4 остаток) — НЕ сделан.
- Инструменты исполняются с правами пользователя, без песочницы. Разрушающие
  гейтятся подтверждением в UI (не на бэкенде). run_bash — мощный; так и задумано
  для локального агента, но помни про это.
- Агентский цикл — non-streaming (пошагово, с видимыми шагами), не токен-стрим.

**Следующий шаг по плану:** **Фаза 5** — доп. экономия токенов (prompt caching
где поддерживается: заголовки/поля кэша для Anthropic-совместимых; ещё агрессивнее
резать вывод инструментов, retrieval кусков). Также: ReAct для GigaChat-агента;
отмена run_bash/стрима по «Стоп».

**Как продолжить:** `npm run tauri dev` (при необходимости `source $HOME/.cargo/env`).

### Запись 7 — 2026-08-18 — Claude (Opus 4.8) — Фаза 5: экономия токенов

**Статус: реализовано (`cargo check` ✅, `tsc` ✅, `npm run build` ✅). Все 5 фаз пройдены.**

- **Prompt caching** (`openai_compat.rs`): `supports_prompt_cache(base_url,model)` —
  включается для OpenRouter + Anthropic/Gemini-моделей; `maybe_cache_system`
  оборачивает системный промт в блок с `cache_control:{type:ephemeral}`, чтобы
  стабильный префикс не тарифицировался повторно. Применяется в chat_stream,
  complete, agent_step. На прочих эндпоинтах — обычные строки (OpenAI кэширует
  сам; неизвестные гейтвеи могут отвергать блочный формат).
- **Retrieval кусков** (`tools.rs` read_file + `tool_read_file`): опциональные
  `offset`/`limit` (1-based строка, число строк) → агент читает срез файла с
  номерами строк, а не весь файл. Схема инструмента и `executeTool` обновлены,
  в описании явно рекомендовано для больших файлов.
- Ранее уже сделано и относится к экономии: rolling-summary (handoff.ts),
  жёсткие caps вывода инструментов (tools.rs), diff-правки (edit_file).

**Остаток/идеи на будущее (не в исходных 5 фазах или необязательное):**
- ReAct-текстовый агент для GigaChat/провайдеров без native tools.
- Отмена `run_bash`/стрима по кнопке «Стоп» на бэкенде.
- Роутинг «дешёвая модель на резюме/маршрутизацию» — сейчас резюме гоняется на
  активной модели; можно явно выбирать самую дешёвую из доступных.
- Кэш-брейкпоинт ещё и на свёрнутое резюме (не только на системный промт).

**Как продолжить:** `npm run tauri dev` (при необходимости `source $HOME/.cargo/env`).

### Запись 8 — 2026-08-18 — Claude (Opus 4.8) — остатки: ReAct-агент, отмена стрима, таймаут bash

**Статус: реализовано (`cargo check` ✅, `tsc` ✅, `npm run build` ✅).**

- **ReAct-агент для GigaChat / провайдеров без native tools** (`lib/agent.ts`):
  `runAgent` теперь диспетчер — `openai_compat` → нативный tool-use, остальные
  (gigachat/custom) → **текстовый ReAct** через `complete`. Формат
  Thought/Action/Action Input → Observation → Final Answer; `parseReAct` терпит
  ```json-обёртку и достаёт `{...}`. Разрушающие так же гейтятся `confirm`.
  Теперь режим «Агент» работает и на GigaChat.
- **Отмена стрима по «Стоп» (backend):** `chat_stream` принимает `request_id`,
  регистрирует `Arc<AtomicBool>` в глобальном реестре `CANCELS`; команда
  `cancel_stream(request_id)` ставит флаг; оба адаптера проверяют его в SSE-цикле
  и выходят (`finish_reason: "cancelled"`). Фронт: `api.chatStream` шлёт
  request_id и на stop() зовёт `cancel_stream` — генерация реально прерывается.
  Сигнатура трейта `chat_stream` получила `cancel: Arc<AtomicBool>`.
- **Отмена агентского цикла:** `AgentHandlers.cancelled()` — циклы (нативный и
  ReAct) проверяют флаг между шагами; ChatView `stop()` ставит `agentCancelRef`.
- **Таймаут run_bash** (`tools.rs`): spawn + drain-потоки на stdout/stderr +
  `wait_timeout` (крейт `wait-timeout`), при превышении 120с — kill + пометка
  `[killed: exceeded 120s timeout]`. Защита от зависания агента.

**Что осталось (мелочи/на будущее):**
- Мгновенный kill конкретного `run_bash` именно по кнопке «Стоп» (сейчас: агент
  останавливается между шагами, а bash защищён 120с-таймаутом).
- Роутинг резюме на самую дешёвую модель; кэш-брейкпоинт на резюме.
- GigaChat native function-calling (сейчас на нём — ReAct; это ок).

Все исходные 5 фаз + заявленные остатки закрыты. Дальше — по желанию пользователя.

**Как продолжить:** `npm run tauri dev` (при необходимости `source $HOME/.cargo/env`).

### Запись 9 — 2026-08-18 — Claude (Opus 4.8) — полировка чата (markdown, копирование, поиск моделей)

**Статус: реализовано (`tsc` ✅, `npm run build` ✅).**

Апгрейд качества UX («чтоб было чудом»):

- **Настоящий Markdown** в сообщениях (`Message.tsx`): `react-markdown` + `remark-gfm`
  + `rehype-highlight` (подсветка кода, тема `highlight.js/styles/github-dark.css`
  — всё бандлится офлайн, без CDN). Стили markdown (заголовки/списки/таблицы/
  цитаты/inline-код/ссылки) добавлены в `index.css` под чёрно-зелёную тему.
- **Копирование:** кнопка copy на каждом блоке кода (hover) + «Copy» под ответом
  ассистента; рядом показывается модель, которой сгенерирован ответ.
- **Поиск по моделям** в переключателе (`ModelSwitcher.tsx`): поле поиска
  появляется, если моделей >6; фильтрация по подстроке (провайдеры отдают сотни).

Замечание: JS-бандл подрос (~highlight.js) — для локального Tauri-приложения без
сети это некритично (предупреждение о размере чанка можно игнорировать или позже
включить manualChunks/сузить языки highlight.js).

Идеи на будущее (не делал): регенерация ответа (нужен deleteMessage в каноне),
экспорт чата, горячие клавиши, счётчик токенов/стоимости.

**Как продолжить:** `npm run tauri dev` (при необходимости `source $HOME/.cargo/env`).

### Запись 10 — 2026-08-18 — Claude (Opus 4.8) — ребрендинг (фиолетовый), знак, сплэш, иконка

**Статус: реализовано (`tsc` ✅, `npm run build` ✅). По референсу пользователя.**

Пользователь дал бренд-референс (фиолетово-космический, светящийся «M»-знак из
двух треугольников, тонкий разрядистый шрифт, «YOUR AI COMMAND CENTER»):

- **Палитра → фиолетовая** (`index.css`): bg `#050507`, accent `#8b7ff5`,
  accent-strong `#a99cff`. Зелёная гамма убрана. Код-блоки перекрашены.
- **Знак `LogoMark`** (`components/Logo.tsx`) — SVG 1:1 с референсом: два
  треугольника, сходящиеся к яркому ядру, фиолетовый градиент + свечение.
  Плюс `Wordmark` (тонкий, letter-spacing 0.42em, uppercase). Знак вставлен в
  Sidebar и пустое состояние ChatView вместо буквенного плейсхолдера.
- **Сплэш/welcome** (`components/Splash.tsx` + CSS в `index.css`) — космическая
  анимация при запуске: звёздное поле (60 звёзд), пульсирующие кольца магнетара,
  знак с glow (scale-in), «MAGNETAR» с анимацией letter-spacing + тэглайн.
  Авто-скрытие ~2.8с, клик — пропустить. Показывается каждый запуск
  (in-memory `showSplash` в `App.tsx`).
- **Иконка приложения** — `scripts/gen-icon.mjs` рендерит SVG→1024 PNG через
  `@resvg/resvg-js` (офлайн, без системных зависимостей), затем
  `npm run tauri icon scripts/icon-source.png` собрал весь набор (icns/ico/png +
  android mipmaps). Источник — `scripts/icon-source.png`. Пересобрать иконку:
  `node scripts/gen-icon.mjs && npm run tauri icon scripts/icon-source.png`.

Шрифт остаётся SF Pro (system-ui) — в референсе тонкий геометрический sans,
достаточно близко через `font-light` + широкий letter-spacing. Если нужен точный
как в референсе — можно добавить свободный шрифт (напр. Michroma/Orbitron) в
`@fontsource`, но пока не делал.

**Как продолжить:** `npm run tauri dev` (при необходимости `source $HOME/.cargo/env`).

### Запись 11 — 2026-08-18 — Claude (Opus 4.8) — встроенный гайд (RU/EN/ES)

Добавлено подробное руководство пользования внутри приложения:
- **`components/GuideDialog.tsx`** — модалка с 8 разделами (начало работы, модели,
  адаптивный режим, агент, GigaChat, handoff, экономия токенов, язык/приватность),
  контент на **RU/EN/ES** (переключается вместе с языком интерфейса).
- Кнопка «Руководство» (иконка книги) в футере Sidebar над «Настройки»; открытие
  через `guideOpen` в `App.tsx`. Ключ i18n `guide` во всех трёх языках.

### Запись 12 — 2026-08-18 — Claude (Opus 4.8) — релиз-сборка, фикс «белого экрана» и «не открывается»

- **Белый мельк при запуске** — тёмный фон добавлен в `index.html` (инлайн-стиль
  `html,body,#root{background:#050507}`), красит первый кадр до загрузки бандла.
- **⚠️ ВАЖНЫЙ УРОК (не повторять):** сначала пробовал прятать окно
  (`"visible": false` в tauri.conf) и звать `getCurrentWindow().show()` из фронта —
  **в РЕЛИЗНОЙ сборке окно оставалось скрытым** (процесс есть, окна нет,
  «приложение не открывается»). Откатил: окно снова видимо по умолчанию, JS-`show()`
  и импорт убраны. Тёмного `index.html` достаточно против мелька. Capability
  `core:window:allow-show` оставлена (безвредна). **Не прятать главное окно на старте.**
- **Релиз-сборка / дистрибуция:** `npm run tauri build` →
  `src-tauri/target/release/bundle/macos/Magnetar.app` (~16 МБ) и
  `.../dmg/Magnetar_0.1.0_x64.dmg`. Приложение **без подписи** — первый запуск:
  правый клик → «Открыть», либо `xattr -cr <app>`. Установлено в
  `/Applications/Magnetar.app`; окно проверено (`System Events` → 1 visible window).
  Цель — x86_64 (этот Mac Intel); для Apple Silicon собирать с `--target aarch64-apple-darwin`.

Иконка/бренд/гайд — Записи 10–11. Все 5 фаз + фичи + ребрендинг + дистрибуция готовы.

### Запись 13 — 2026-08-18 — Antigravity — Обмен файлами в обе стороны и мультимодальность

**Статус: реализовано (`cargo check` ✅, `tsc` ✅, `npm run build` ✅). Запушено на GitHub.**

Сделано по запросу пользователя на поддержку прикрепления файлов:

- **Бэкенд (Rust):**
  - Обновлена структура БД (колонка `attachments` добавлена в таблицу `messages` как JSON). Миграция `ALTER TABLE` добавлена в `db.rs`. В `canon.rs` DTO `MessageRow` и CRUD-операции работают с `attachments`.
  - Добавлены новые зависимости для работы с файлами: `pdf-extract`, `base64`, `multipart`.
  - В `openai_compat.rs` добавлена мультимодальность — парсинг `attachments` типа `image` в формат `content: [{type: "text", text: ...}, {type: "image_url", image_url: {url: ...}}]`, который понимают OpenRouter и другие совместимые API. 
  - В `gigachat.rs` реализована поддержка файлов (согласно API GigaChat, загрузка файла через `POST /files`, и затем прикрепление file_id в чате). 
  - Реализованы новые инструменты Tauri: `tool_attach_file` (возвращает метаданные файла) и `extract_pdf_text` (извлечение текста из PDF).

- **Фронтенд (TS/React):**
  - **`Composer.tsx`**: Добавлена иконка `Paperclip` для загрузки локальных изображений. Поддержка Drag-and-Drop (через `onDrop`, `onDragOver` и `paste` event) для вставки картинок из буфера обмена или перетаскивания файлов мышью (сохраняются как base64/dataURLs). Добавлена галерея превью картинок под инпутом.
  - **`Message.tsx`**: Добавлен рендеринг прикреплённых файлов (image preview) и иконки документов внутри пузырей сообщений.
  - Обновлены типы `Attachment` (`type` и `mimeType`), `api.ts`, и логика в `ChatView.tsx` для передачи файлов в `runSend` и `runAgentPath`.
  - В `agent.ts` добавлен инструмент агента `attach_file` для работы с загрузкой файлов в диалоге с агентом.

**Фиксы багов:**
- Добавлены разрешения `"dialog:default"` и `"fs:default"` в `src-tauri/capabilities/default.json` для корректной работы системного диалога (Tauri v2 блокирует плагины по умолчанию).
- Добавлена полноценная поддержка Drag-and-Drop в `Composer.tsx` (ранее работал только Ctrl+V).

**Что дальше / Известные ограничения:**
- Инструмент GigaChat сейчас настроен на загрузку файлов в их память (хранятся некоторое время на их стороне), прикрепляются по ID.
- Поддержка PDF-текста для провайдеров (парсинг через pdf-extract) доступна агенту. 
- Для полноценной работы с любыми документами (Word, Excel) требуется дополнительное расширение парсеров на бэкенде.

### Запись 14 — 2026-08-18 — Antigravity — Интеграция shadcn/ui и Kill Switch для Bash-процессов
**Статус: реализовано (`cargo check` ✅, `tsc` ✅, `npm run tauri build` ✅). Запушено на GitHub.**

**Что сделано:**
- **Bash Kill Switch:** теперь все bash-команды, запущенные через `run_bash`, отслеживаются в `BASH_PROCESSES` (глобальная мапа `Lazy<Mutex<HashMap<u32, u32>>>` в `src-tauri/src/tools.rs`). Добавлена команда `kill_bash` для принудительного завершения процессов (через `libc::kill`).
- В UI при нажатии кнопки "Стоп" (`ChatView.tsx`) теперь отправляется запрос `api.toolKillBash()` для очистки повисших скриптов (не дожидаясь таймаута в 120 секунд).
- **Интеграция shadcn/ui:** библиотека `shadcn/ui` интегрирована в проект (для Tailwind v4 через `resolve.alias` в `vite.config.ts` и `tsconfig.json`).
- Установлены базовые компоненты `button` и `dialog`.
- Кастомные модальные окна в `SettingsDialog.tsx` и окно подтверждения (`confirm`) в `ChatView.tsx` переписаны на `Dialog` из `shadcn/ui` для улучшения доступности (a11y) и визуальной консистентности.

### Запись 15 — 2026-08-18 — Antigravity — MVP V2 (Universal AI Workspace) Completed
**Статус: реализовано (`cargo check` ✅, `tsc` ✅, `npm run build` ✅).**

**Сделано:**
1. **База данных и Структура (Phase 1)**: 
   - Добавлены таблицы `projects`, `knowledge_nodes`, `knowledge_edges`, `tasks`, `timeline_events`.
   - Сессии (чаты) теперь могут привязываться к проекту (`project_id`).
   - Реализованы CRUD-команды в `workspace.rs`.
2. **Frontend UI Shell (Phase 2)**: 
   - Обновлен Zustand (`store.ts`) для управления состоянием проектов и текущего проекта.
   - Добавлен новый `Sidebar.tsx` для навигации (Chats, Projects, Roadmap, Knowledge Graph, Timeline, Settings).
   - `App.tsx` переписан на маршрутизацию по табам.
3. **Project Brain (Phase 3)**:
   - Внедрена вкладка `ProjectsView.tsx` для создания и редактирования контекста проекта (описание, стек, правила).
   - В `handoff.ts` (`buildOutgoing`) добавлен инжект контекста активного проекта.
   - Фоновая экстракция (анализ транскриптов и обновление контекста проекта).
4. **Knowledge Graph (Phase 4)**:
   - Создана `KnowledgeGraphView.tsx`.
   - Инъекция локальных подграфов в `buildOutgoing`.
   - Фоновый процесс сборки графа (`maybeBuildKnowledgeGraph`).
5. **AI Project Manager & Roadmap (Phase 5)**:
   - Создана `RoadmapView.tsx` в виде Kanban-доски.
   - Управление задачами (Todo, In Progress, Done).
6. **Multi-Agent Team & Timeline (Phase 6)**:
   - Реализована `TimelineView.tsx` для истории событий проекта.
   - В `agent.ts` добавлен `runTeamAgent` с последовательным вызовом "Architect -> Developer -> Reviewer".
   - Запуск Team Mode через команду `/team` в чате.
7. **AI CTO Mode (Phase 7)**:
   - Кнопка "Run Audit" добавлена в `ProjectsView.tsx`.
   - Обработка команды `/cto` в чате для глубокого анализа технического долга и создания задач.

**Текущее состояние:**
Код собирается без ошибок (`cargo check`, `tsc`, `npm run build`). Все требования V2 реализованы. Приложение можно тестировать (`npm run tauri dev`).

### Запись 16 — 2026-08-18 — Claude (Opus 4.8) — аудит работы Antigravity (Зап.13–15) + фиксы

Пользователь попросил проверить код Antigravity перед продолжением. Прогнал сборку
и вычитал ключевые места.

**✅ Подтверждено рабочим:** всё компилируется (`cargo check`/`tsc`/`build`), команды
и плагины (`fs`/`dialog`) зарегистрированы; мультимодальность реальна (вложения
идут фронт→api→бэк, `format_message` собирает `image_url`); `extract_pdf_text`
использует настоящий `pdf_extract`; workspace V2 (projects/graph/tasks/timeline/
team/cto) на месте; `/team` и `/cto` в ChatView разведены корректно.

**🔧 Исправлено (2 реальных бага):**
1. **`kill_bash` убивал только `bash`, а не дерево.** Теперь `run_bash` запускает
   команду в своей process-group (`CommandExt::process_group(0)`), а `kill_bash`
   и таймаут бьют по группе (`libc::kill(-pgid, SIGKILL)`) — дочерние (node/npm) умирают.
2. **Не-картиночные вложения не попадали в чат.** `format_message` теперь
   подмешивает `extractedText` файловых вложений в контент. Плюс **Composer**
   раньше вообще не давал выбрать PDF (фильтр только картинки) — добавил pdf в
   диалог и извлечение текста через `api.extractPdfText` при прикреплении.

**⚠️ Замечено, НЕ критично (на будущее):**
- `runTeamAgent`: Reviewer получает план, но не фактический результат Developer'а
  (действия агента не возвращаются в devHistory) — качество ревью слабое.
- Drag-drop PDF в Composer не обрабатывается (только картинки; PDF — через кнопку-скрепку).
- `tool_attach_file` возвращает только строку-подтверждение, не рендерит
  скачиваемую карточку файла у пользователя (Part B «модель→файл» реализован слабо).
- JS-бандл большой (highlight.js) — косметика.

**Следующий шаг (по плану пользователя):** Этап 1 — встроенный браузер-панель
(webview ChatGPT/Claude/Gemini) + Этап 2 — мост контекста (копировать контекст /
вставить ответ в канон). Живой прогон `/team`/`/cto`/GigaChat-файлов требует
GUI + API-ключа (headless не прогнать) — за пользователем.

### Запись 17 — 2026-08-18 — Claude (Opus 4.8) — Подписки: встроенный браузер + мост контекста

Реализованы Этапы 1–2 из плана пользователя (легальное использование подписочных
ИИ: ChatGPT/Claude/Gemini «через браузер в приложении», без автоматизации).

- **Новая вкладка «Подписки»** (`components/SubscriptionsView.tsx`, в Sidebar +
  App tab `subscriptions`):
  - **Встроенный браузер:** карточки ChatGPT/Claude/Gemini/Grok → открывают сайт в
    **`WebviewWindow`** (собственное браузер-окно Magnetar, лейбл `subs-<id>`,
    повторное открытие фокусирует существующее). Пользователь логинится сам,
    работает вручную — **ничего не автоматизируем и не парсим** (грань ToS).
  - **Мост контекста:** кнопка «Скопировать контекст проекта» (`buildProjectContext`:
    активный Project Brain + открытые задачи из `db.listTasks` + резюме сессии +
    последние сообщения → буфер) и поле «Добавить в канон» (вставляешь ответ
    подписочной модели → `addMessage` в активную сессию, model=`external-subscription`).
  - i18n RU/EN/ES (`subs*` ключи).
- **Capabilities:** добавлены `core:webview:allow-create-webview-window`,
  `core:webview:allow-webview-close`, `core:window:allow-set-focus` (для открытия
  браузер-окна из фронта). `cargo check` их провалидировал.

**Заметка про UX:** это отдельное браузер-окно Magnetar, а не панель, встроенная
прямо в область чата. Полноценная встроенная side-панель (child-webview с ручным
позиционированием) — возможное улучшение, но она хрупкая (координаты, ресайз) и не
проверяется headless; окно надёжнее и делает то же самое.

**Известный баг (сообщил пользователь, чинить):** «слетели модели» — каталог
моделей хранится только в памяти (`store.models`) и подтягивается в `App.tsx` при
старте; если провайдер не ответил/ключа нет в момент старта — список пуст. Надо:
кэшировать каталог (в localStorage/БД) и/или добавить кнопку «обновить модели» +
ретрай. НЕ доделано.

### Запись 18 — 2026-08-18 — Claude (Opus 4.8) — Ядро IDE: редактор кода + файловое дерево + diff-ревью

Шаг к конечной цели «AI IDE». Реализовано автономно (пользователь: «делай сам»).

- **Вкладка «Код»** (`components/EditorView.tsx`, Sidebar + App tab `code`):
  - **Файловый эксплорер** — ленивое дерево (разворачивает папки через
    `api.toolListDir`, скрывает dot-файлы кроме `.env`). Кнопка «Открыть папку»
    (`plugin-dialog` directory) → корень сохраняется в стор `workspaceRoot` (persist).
  - **Редактор — CodeMirror 6** (`@uiw/react-codemirror` + one-dark + langs
    js/ts/json/rust/python/md/html/css). Офлайн, лёгкий (не Monaco/CDN).
  - Открытие файла — новая команда `editor_read_file` (полное чтение, БЕЗ 60KB-cap
    как у `tool_read_file`; `tools::read_text`). Сохранение — `tool_write_file`.
    Cmd/Ctrl+S, индикатор «●» несохранённого.
- **Diff-ревью правок агента** (`components/ToolPreview.tsx`): модалка подтверждения
  в ChatView теперь показывает не голый JSON, а **цветной дифф** — `edit_file`
  (old→new построчно через `diff`/jsdiff, красный/зелёный), `write_file` (контент
  как добавленный), `run_bash` (команда). Модалка расширена до max-w-2xl.
- i18n RU/EN/ES (`code`, `editor*`).
- Backend: `editor_read_file` зарегистрирован в `lib.rs`.

**Ограничения/на будущее:** одна вкладка файла (без табов нескольких файлов);
дерево не авто-обновляется после правок агента (нужно переоткрыть папку); нет
поиска по файлам, git-панели и терминала (следующие шаги дорожной карты — см.
Запись 16/обзор). Индексация кода (RAG) — тоже впереди.

### Запись 19 — 2026-08-18 — Claude (Opus 4.8) — фикс моделей + Git-панель

Продолжение дорожной карты (пользователь: «добить всё сегодня»).

**(1) Фикс «слетевших моделей»:**
- Каталог `models` теперь персистится в localStorage (`partialize`) — переживает
  перезапуск.
- `ModelSwitcher` сидируется из кэша (модели видны сразу), авто-фетч только когда
  кэш пуст; добавлена **кнопка обновления** (RefreshCw) в дропдауне. i18n
  `modelsCount`/`refreshModels`.

**(2) Git-панель** (`components/GitView.tsx`, вкладка `git`):
- Backend: команда `git_exec(cwd, args)` (`tools::git_exec`) — запускает ТОЛЬКО
  бинарник `git` (не шелл), вывод капается. Зарегистрирована в `lib.rs`, обёртка
  `api.gitExec`.
- UI: парсит `git status --porcelain=v1 -b` → ветка + Staged/Changes/Untracked;
  stage (`add`)/unstage (`reset HEAD`)/stage-all (`add -A`); поле сообщения +
  commit (`commit -m`); клик по файлу → `git diff [--staged]` в цветном дифф-пейне;
  последние 10 коммитов (`log --oneline`); кнопка `git init` если не репозиторий.
- i18n RU/EN/ES (`git*`).

Работает на `workspaceRoot` (та же папка, что выбрана в редакторе «Код»).

**Дальше по карте:** встроенный терминал (PTY) — беру следующим. Затем индексация
кода (RAG), зрелость памяти, дистрибуция (Apple Silicon/подпись — блокируется
Apple-аккаунтом).

### Запись 20 — 2026-08-18 — Claude (Opus 4.8) — встроенный терминал (PTY)

- **Backend `pty.rs`** — настоящий PTY через крейт `portable-pty`. Глобальный
  реестр сессий `SESSIONS: Lazy<Mutex<HashMap<id, PtyHandle{master,writer,child}>>>`.
  Команды: `pty_spawn(id,cwd,cols,rows,on_data: Channel<String>)` — открывает pty,
  запускает `$SHELL` (fallback zsh) с `TERM=xterm-256color` в `cwd`, поток читает
  вывод master и шлёт в канал; `pty_write(id,data)`, `pty_resize(id,cols,rows)`,
  `pty_kill(id)`. Зарегистрированы в `lib.rs`.
- **Frontend `TerminalView.tsx`** — `@xterm/xterm` + `@xterm/addon-fit` (офлайн),
  тема под фиолетовый бренд, шрифт JetBrains Mono. На маунт: генерит id, spawn,
  `term.onData → pty_write`, ResizeObserver → fit + `pty_resize`; на размонтирование
  `pty_kill` + dispose. Работает в `workspaceRoot`. Вкладка `terminal` в Sidebar/App,
  i18n `terminal` (ru/en/es).

Теперь Magnetar имеет полноценную IDE-триаду: **редактор + git + терминал** поверх
канона/агента/workspace. 

**Остаток дорожной карты:** индексация кода (RAG/embeddings — нужен провайдер
эмбеддингов), зрелость памяти (дедуп brain/graph), дистрибуция (Apple Silicon
`aarch64` — можно кросс-собрать; подпись/нотаризация — блокируется Apple Developer
аккаунтом). Мелочи: табы нескольких файлов в редакторе, авто-refresh дерева.

### Запись 21 — 2026-08-18 — Claude (Opus 4.8) — индексация кодовой базы (BM25 retrieval)

- **Backend `index.rs`** — локальный инвертированный индекс + **BM25** (k1=1.2,
  b=0.75), без эмбеддингов/сети. Обход воркспейса (пропуск node_modules/.git/
  target/dist/.venv и бинарников по расширению, лимиты 5000 файлов / 1МБ),
  токенизация, глобальный кэш `INDEX: Lazy<Mutex<Option<Index>>>` (перестраивается
  при смене root). Команды `index_build(root)` и `index_search(root,query,topK)`
  → ранжированные хиты {file, score, snippet, line} с авто-билдом при пустом индексе.
- **Агентский инструмент `search_code(query)`** (`agent.ts`) — ранжированный поиск
  по проекту (лучше substring-grep); берёт `workspaceRoot` из стора, авто-строит
  индекс. Даёт агенту «понимание проекта» без RAG-провайдера.
- `api.indexBuild/indexSearch`, зарегистрировано в `lib.rs`.

Это первый шаг «индексации кода» из карты (локальный BM25). Полноценный семантический
RAG (эмбеддинги) — когда будет провайдер эмбеддингов; текущий BM25 уже полезен.

**Дистрибуция:** релиз `.app`/`.dmg` пересобран (до терминала, коммит 51a34e6) и
установлен в `/Applications/Magnetar.app`. Подпись/нотаризация — ждут Apple
Developer аккаунт ($99) пользователя. Универсальная сборка (Apple Silicon) — можно
кросс-собрать (`rustup target add aarch64-apple-darwin`, `tauri build --target
universal-apple-darwin`), НЕ делал в этот заход.

### Запись 22 — 2026-08-18 — Claude (Opus 4.8) — «память-первым»: онбординг папки, Brain в агенте, флаш на переключении

Реализована ключевая философия пользователя: **память уровня ПРОЕКТА, тезисная;
модель работает из памяти, а не перечитывает проект; переключение = флаш в память.**

- **Схема:** в `projects` добавлены `path` (связь проекта с папкой) и `last_state`
  (тезис «где остановились»). Миграции в `db.rs`, поля в `workspace.rs` (struct +
  SELECT + upsert) и `types.ts` (`Project.path/lastState`).
- **`src/lib/memory.ts`** (новый):
  - `analyzeFolderIntoMemory(root)` — **онбординг папки**: строит BM25-индекс, читает
    ключевые файлы (package.json/README/Cargo.toml/pyproject/… + top-level дерево),
    гоняет ДЕШЁВУЮ модель (`cheapModel()`), парсит JSON → создаёт/обновляет Project
    (name/description/techStack/architectureNotes/codingStandards, `path=root`),
    делает активным и привязывает текущую сессию. Триггерится авто при «Открыть
    папку» в редакторе + кнопка «Проанализировать в память» (иконка мозга).
  - `flushHandoffToMemory()` — **флаш на переключении**: сворачивает последние ходы в
    тезис «состояние + следующий шаг» → пишет в `project.lastState`. Вызывается в
    `ModelSwitcher` при смене модели/подключения (перед переключением).
  - `buildProjectMemory(session)` — преамбула проектной памяти (brain + lastState +
    «работай из памяти, используй search_code/read_file(offset) — экономь токены»).
  - `cheapModel()` — выбирает самую дешёвую модель (haiku/mini/flash/…) для фоновой
    работы, иначе активную.
- **Brain в агент-режиме (Piece 2):** `runAgent`/`runAgentNative`/`runAgentReAct`/
  `runTeamAgent` принимают `system`/`projectMemory`; ChatView передаёт
  `buildProjectMemory(session)`. Теперь агент (и `/team`) стартует С памятью проекта.
- **Обычный чат:** в `handoff.ts` в проектный контекст добавлен `lastState`.
- **Store:** `attachSessionToProject(sessionId, projectId)`.
- **Дистрибуция:** универсальная сборка (Intel + Apple Silicon) собрана
  (`tauri build --target universal-apple-darwin`) — `target/release/bundle/macos/`
  (universal `.app`) и dmg. Подпись — ждёт Apple аккаунт.

**Итог:** загрузил папку → приложение само заполнило память → переключаешь модель,
на кнопке пишется тезис в память → следующая модель читает память, а не проект.
Токены экономятся. Осталось по мелочи: авто-refresh дерева, табы файлов, дедуп памяти.

### Запись 23 — 2026-08-18 — Claude (Opus 4.8) — новый бренд: магнетар с дипольным полем

Пользователь дал новый референс иконки (нейтронная звезда + фиолетовое дипольное
магнитное поле + крест-флейр).

- **`components/Logo.tsx`** — `LogoMark` перерисован в SVG-магнетар: чёрное ядро
  (radial gradient) + 6 вложенных дипольных линий поля (сходятся у полюсов
  сверху/снизу, огибают ядро), 4-лучевой флейр, оси. Геометрия генерится функцией
  `loop(e)` (TOP=8, BOT=92, extents [10..44]). Прозрачный фон — знак работает на
  тёмном UI. Используется в Sidebar/EmptyState/Splash автоматически.
- **`scripts/gen-icon.mjs`** — та же геометрия на фиолетовом глянцевом сквиркле
  (gloss-оверлей). Рендер `@resvg/resvg-js` → `scripts/icon-source.png` (1024) →
  `npm run tauri icon` пересобрал весь набор (icns/ico/png). Пересборка иконки:
  `node scripts/gen-icon.mjs && npm run tauri icon scripts/icon-source.png`.
- Сплэш уже на тёмном фоне со звёздами — новый знак подхватывается автоматически.

### Запись 24 — 2026-08-18 — Claude (Opus 4.8) — «О нас», самотест, реальная иконка (PNG), шрифты

- **Раздел «О Magnetar»** добавлен в `GuideDialog.tsx` (RU/EN/ES): миссия
  (проект в центре, память вместо перечитывания), BYOK, приватность, версия 0.1.0.
- **Тест «работает ли как задумано» — два уровня:**
  - **Встроенный «Самотест»** (`components/SelfTest.tsx`, показан в `SettingsDialog`
    сверху) — по кнопке гоняет на подключённых моделях: `/models`, чат, tool-use
    (`agentStep`; для GigaChat нет native tools → помечается «работает через ReAct»),
    **межмодельный handoff** (модель A запоминает токен → B вспоминает через общий
    канон) и работу из summary. Ключи не покидают приложение (Keychain). Живой
    PASS/FAIL. **Это способ, которым пользователь запускает первый тест сам.**
  - **`scripts/e2e-test.mjs`** — Node-скрипт для API-моделей: читает
    `.magnetar-test/keys.json` (в `.gitignore`, шаблон `keys.example.json`), те же
    проверки. Запускается ассистентом при наличии ключей в файле.
  - **`TEST_SCENARIO.md`** — сценарий ручного теста в приложении (онбординг папки →
    «создай одностраничник» агентом → переключение модели → продолжение из памяти →
    подписки через мост). Подписки (Claude/Gemini/GPT) тестируются только вручную
    (у них нет API).
  - ⚠️ Читать Keychain/localStorage пользователя, чтобы «прогнать самому», нельзя
    (заблокировано и это его секреты) → поэтому сделан ВСТРОЕННЫЙ самотест.
- **Иконка — теперь РЕАЛЬНЫЙ PNG пользователя** (не SVG-перерисовка!):
  `~/Downloads/EA99…PNG` → center-crop в квадрат 1024 (`scripts/icon-source.png`,
  фон прозрачный) → `npm run tauri icon`. `LogoMark` (`components/Logo.tsx`) теперь
  рендерит `src/assets/magnetar-icon.png` (256px) вместо SVG — сайдбар/сплэш/пустой
  экран совпадают с иконкой. `scripts/gen-icon.mjs` (SVG-версия) больше НЕ источник
  иконки — если менять иконку, замени `scripts/icon-source.png` своим PNG и запусти
  `npm run tauri icon scripts/icon-source.png`.
- **Шрифт UI → Space Grotesk (латиница) + Onest (кириллица)**, оба офлайн через
  `@fontsource` (импорт в `main.tsx`), `--font-sans` в `index.css`. Space Grotesk
  кириллицы НЕ имеет → Onest подхватывает русский. Код — по-прежнему JetBrains Mono.

**Важно про dev-иконку:** cargo не пересобирает бинарник от смены только PNG-иконок
→ чтобы новая иконка вшилась, форсируй: `touch src-tauri/build.rs src-tauri/src/main.rs`
затем `npm run tauri dev`. Dock кэширует иконку → `killall Dock` освежает.

**Состояние на этот момент:** всё скомпилировано (`cargo`/`tsc`/`build` ✅), запушено.
Ждём результат «Самотеста» от пользователя на 3 моделях (GigaChat/Qwen/DeepSeek).

### Запись 25 — 2026-08-18 — Claude (Opus 4.8) — подключения в SQLite (фикс «пропадающих моделей»)

**Проблема:** у пользователя несколько раз «пропадали» подключения/модели. Причина —
подключения жили ТОЛЬКО в localStorage webview, который теряется (напр. при жёстком
`kill -9` до флаша, или сбросе webview-хранилища).

**Фикс:** подключения теперь в **SQLite** (таблица `connections` — id/name/kind/
base_url/scope/ca_path). Backend: `workspace.rs` (`ConnectionRow` + list/save/delete)
+ команды `list_connections`/`save_connection`/`delete_connection` в `commands.rs`/`lib.rs`.
Фронт: `db.ts` обёртки; `store.ts` — `hydrate()` грузит подключения из БД (+ разовая
миграция из localStorage если БД пустая), `addConnection`/`removeConnection`
пишут-через в БД. Из `partialize` убраны `connections` и большой `models`-каталог
(модели греются при старте в `App.tsx`). Ключи — по-прежнему в Keychain.

**Правило:** НЕ убивать приложение `kill -9` (webview не флашит) — только SIGTERM.

Пользователю: после этого фикса подключения durable; если пропали ДО фикса — надо
один раз добавить заново, дальше не потеряются.

<!-- Следующий ассистент: добавь «Запись 26 — дата — модель — тема» здесь. -->

### Запись 26 — 2026-08-19 — Codex — UX-аудит: ориентированный first launch и консистентная навигация

**Статус: frontend-полировка реализована; `npx tsc --noEmit` и `npm run build` проходят.**

**Что сделано:**

- Проведён аудит доступной UI-архитектуры и пользовательских маршрутов. Главная
  найденная проблема: на первом запуске приложение немедленно открывало настройки,
  не объясняя следующий шаг; раздел Projects и часть Sidebar имели захардкоженный
  английский, нарушающий переключение RU/EN/ES.
- **`App.tsx`** больше не принудительно открывает настройки при отсутствии
  подключения. Пользователь остаётся в главной рабочей зоне и получает понятный
  маршрут, не модальное препятствие.
- **`ChatView.tsx`**: пустой чат превращён в компактный onboarding с двумя
  действиями: «подключить модель» (открывает настройки) и «открыть проект»
  (ведёт в Code). Визуальные чек-метки показывают, какие из шагов уже завершены;
  после подключения остаётся ясный CTA начать задачу или включить агента.
- **`Sidebar.tsx`**: убраны английские fallback-строки, добавлен смысловой раздел
  «Workspace» перед Code/Git/Terminal, чтобы IDE-инструменты читались как одна
  группа, а не как длинный несвязанный список.
- **`ProjectsView.tsx`**: все пользовательские подписи, placeholder-ы, alert и
  подтверждение удаления переведены на i18n; больше нет смешанного UI на этом
  ключевом экране.
- **`i18n.ts`**: добавлены одинаковые ключи RU/EN/ES для onboarding, навигации и
  Project Brain/CTO. **`index.css`**: единые focus-visible состояния и карточки
  онбординга (токены существующей фиолетовой системы, без новой зависимости).

**Изменённые файлы:** `src/App.tsx`, `src/components/ChatView.tsx`,
`src/components/Sidebar.tsx`, `src/components/ProjectsView.tsx`,
`src/lib/i18n.ts`, `src/index.css`, `HANDOFF.md`, `NEXT_TASK_FILES.md`.

**Проверки:** `npx tsc --noEmit` ✅; `npm run build` ✅. Vite по-прежнему сообщает
неблокирующее предупреждение о большом JS-chunk и смешанном static/dynamic импорте
`db.ts` — это прежний технический долг, не регресс текущей работы.

**Оставшееся / рекомендация следующему ИИ:** продолжить полный i18n-аудит в
`RoadmapView.tsx`, `KnowledgeGraphView.tsx`, `Message.tsx`, `Composer.tsx` и
`SettingsDialog.tsx` (там ещё есть захардкоженные служебные строки/tooltip-ы);
провести визуальный GUI-прогон onboarding, Code → Git → Terminal и agent flow с
настоящим API-ключом. В рамках текущего запуска API-ключи и нативный GUI не
трогались. Не менять SQLite, Keychain, мультимодальность или GigaChat без
отдельной проверки их end-to-end сценариев.

### Запись 27 — 2026-08-19 — Codex — release-пересборка после UX-изменений

**Сделано:** после коммита `d251fb7` пересобран production macOS app bundle.
Подтверждён исполняемый файл x86_64 Mach-O:
`src-tauri/target/release/bundle/macos/Magnetar.app/Contents/MacOS/magnetar`
(01:27:57, 2026-08-19). Приложение можно запускать и проверять уже сейчас,
открыв `src-tauri/target/release/bundle/macos/Magnetar.app` в Finder.

**Проверки:** ранее в этом цикле прошли `cargo check`, `npx tsc --noEmit`,
`npm run build`; release-бинарник и `.app` созданы успешно.

**Ограничение:** новый DMG в этом цикле не появился — в
`src-tauri/target/release/bundle/dmg/` остались служебные файлы упаковщика.
Перед дистрибуцией нужно отдельно повторить `npm run tauri build` до строки
успешной DMG-упаковки и зафиксировать размер/дату. `.app` полностью пригоден
для локальной проверки на Intel macOS; он не подписан.

### Запись 28 — 2026-08-19 — Codex — исправление активной модели + IDE-shell

**Проблема из пользовательского GUI-прогона:** в Settings существовали подключения
и ключи Keychain, но основной ChatView показывал «Нет подключения». Причина:
`hydrate()` переносил connections из SQLite в Zustand, но не выбирал активное
подключение при пустом/устаревшем `activeConnectionId`; при этом модель тоже не
выбиралась после обновления каталога. Получался UI-тупик, несмотря на валидные
настройки.

**Исправлено:**

- `store.ts`: после SQLite-hydrate автоматически назначается первое валидное
  подключение, если сохранённое отсутствует/устарело.
- `App.tsx`: после загрузки `/models` первая модель активного подключения
  выбирается автоматически. ChatView больше не должен оставаться в статусе
  «Нет подключения» при существующих connections.
- `SettingsDialog.tsx`: у каждой связи есть «Проверить». Действие последовательно
  выполняет `/models`, выбирает первую модель, делает реальный completion
  `Reply exactly: OK`, показывает результат/ошибку и активирует рабочую модель.
  Это позволяет проверять каждую модель отдельно без скрытого глобального теста.
- Новый `IdeWorkspace.tsx`: default layout переработан под familiar IDE flow:
  узкая activity bar → Explorer/editor → выделенная правая панель Agent. Внутри
  агентской панели остаются Magnetar-функции (модели, streaming, Agent,
  adaptive, memory); Code/Git/Terminal и остальные разделы доступны из activity
  bar. `EditorView` получил embedded-режим, ChatView — embedded shell.
- `Sidebar.tsx`: длинное продуктовое меню заменено на компактный icon activity
  bar с доступными tooltip/aria-label. Это освобождает место под рабочую область
  и соответствует приложенному референсу, сохраняя все существующие зоны.

**Изменены:** `src/App.tsx`, `src/lib/store.ts`, `src/lib/i18n.ts`,
`src/components/IdeWorkspace.tsx` (новый), `Sidebar.tsx`, `EditorView.tsx`,
`ChatView.tsx`, `SettingsDialog.tsx`, `HANDOFF.md`, `NEXT_TASK_FILES.md`.

**Проверки:** `cargo check` ✅, `npx tsc --noEmit` ✅, `npm run build` ✅.
Пользователь должен запустить новую сборку и нажать «Проверить» на каждом
подключении; при ошибке UI покажет фактический ответ API, который нужен для
диагностики endpoint/ключа/модели.
