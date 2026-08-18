# Magnetar

Локальный десктоп-агент для macOS: чат + код + доступ к машине, работающий с
**любым** ИИ по вашему API-ключу (BYOK). Ключи — только в macOS Keychain, наружу
приложение ходит исключительно к тем эндпоинтам, что вы настроили.

## Стек

- **Tauri v2** (Rust-бэкенд) + **React + TypeScript + Tailwind v4**
- Секреты: **macOS Keychain** (`security-framework`), никогда не в открытом виде
- Локальная БД: **SQLite** (`rusqlite`, bundled) — канонический транскрипт

## Запуск (dev)

```bash
npm install
npm run tauri dev
```

Prerequisites: Node 20+, Rust stable (`rustup`), Xcode Command Line Tools.

При первом старте откроется окно «Connections» — вставьте API-ключ (например
OpenRouter), выберите модель сверху в чате и работайте.

## Архитектура

```
src-tauri/src/
  providers/         # BYOK-шлюз
    mod.rs           #   trait Provider + Connection/ChatParams + фабрика
    openai_compat.rs #   OpenAI-совместимый адаптер (SSE-стриминг)
  keychain.rs        # macOS Keychain wrapper
  db.rs              # SQLite: sessions + провайдер-нейтральный canon
  commands.rs        # tauri-команды (мост к фронту)
src/
  lib/               # types, zustand-store, api-обёртки, cn
  components/        # Sidebar, ChatView, Composer, Message, ModelSwitcher, Settings
```

Ключевая идея — **провайдер-нейтральный канон**: единый транскрипт, который каждый
адаптер сериализует в формат своего провайдера. Это даёт handoff между разными
API без потери контекста.

## Статус по фазам

- [x] **Фаза 1 — Каркас.** Tauri v2 + чат-UI (тёмная тема), Keychain, OpenAI-
      совместимый адаптер со стримингом, переключатель моделей на лету.
- [x] **Фаза 2 — SQLite + канон.** Сессии/сообщения в SQLite (`db.rs`/`canon.rs`),
      write-through, hydrate при старте.
- [x] **Фаза 3 — GigaChat.** OAuth (порт 9443, кэш токена), Russian Trusted Root
      CA **встроен в приложение** (из коробки), mutex на запрос, парсинг ```json.
- [x] **Фаза 4 — Агентские инструменты.** read/write/edit(diff)/list_dir/grep/
      run_bash + фильтрация вывода + подтверждение разрушающих; цикл tool-use
      (native OpenAI function calling). *ReAct для GigaChat — остаток.*
- [x] **Фаза 5 — Экономия токенов.** rolling-summary, prompt caching (где
      поддерживается), жёсткие caps вывода инструментов, retrieval кусков (read_file
      по диапазону строк), diff-правки.

Дополнительно: **адаптивный режим** (роутер модели под запрос), **межмодельный
handoff** (продолжение при смене модели), **i18n RU/EN/ES**, чёрно-зелёный дизайн,
SF Pro + JetBrains Mono. Заготовка Custom/self-hosted есть в `ProviderKind`, в UI скрыта.

Полный журнал разработки — [HANDOFF.md](HANDOFF.md).
