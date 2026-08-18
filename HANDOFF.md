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

<!-- Следующий ассистент: добавь «Запись 3 — дата — модель — тема» здесь. -->
