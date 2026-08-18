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

- [x] **Фаза 1 — Каркас.** Tauri v2 + чат-UI (тёмная тема), Keychain, один
      OpenAI-совместимый адаптер со стримингом, переключатель моделей на лету
      (модели тянутся из `/models`), сессии/история (пока в локальном сторе).
- [ ] **Фаза 2 — SQLite + канон.** Перенос сессий/сообщений в БД, нейтральная
      схема транскрипта (уже создаётся в `db.rs`).
- [ ] **Фаза 3 — GigaChat.** OAuth (порт 9443, кэш токена ~30 мин), Russian
      Trusted Root CA в reqwest, mutex на одновременный запрос, парсинг ```json.
- [ ] **Фаза 4 — Агентские инструменты.** read/write/edit(diff)/list_dir/grep/
      run_bash + подтверждения; ReAct-текст для провайдеров без tool-use.
- [ ] **Фаза 5 — Handoff + экономия токенов.** rolling-summary, prompt caching,
      фильтрация вывода инструментов (~90%), retrieval кусков, роутинг моделей.

Заготовки под Custom/self-hosted и GigaChat уже есть в `ProviderKind`, но в UI
Custom скрыт (на будущее).
