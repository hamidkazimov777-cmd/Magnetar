import { X } from "lucide-react";
import { useStore } from "../lib/store";
import type { Lang } from "../lib/i18n";
import { LogoMark } from "./Logo";

interface Section {
  title: string;
  items: string[];
}

const GUIDE: Record<Lang, { heading: string; intro: string; sections: Section[] }> = {
  ru: {
    heading: "Руководство",
    intro:
      "Magnetar — локальный ИИ-агент: чат, код и доступ к твоему компьютеру, работает с любым ИИ по твоему API-ключу.",
    sections: [
      {
        title: "1. Начало работы",
        items: [
          "Открой «Настройки и ключи» (внизу слева).",
          "Нажми тип провайдера: «OpenAI-совместимый» (OpenRouter, Kimi и др.) или «GigaChat».",
          "Вставь API-ключ и нажми «Добавить». Ключ хранится в macOS Keychain, не в открытом виде.",
          "Сверху в чате выбери модель — и пиши.",
        ],
      },
      {
        title: "2. Модели на лету",
        items: [
          "Переключатель моделей — сверху слева. Модели тянутся из провайдера автоматически.",
          "Если моделей много — появляется поиск: просто начни печатать.",
          "Можно подключить несколько провайдеров и переключаться между ними в том же переключателе.",
        ],
      },
      {
        title: "3. Адаптивный режим",
        items: [
          "Кнопка «Адаптивный» вверху справа.",
          "Magnetar сам подбирает модель под запрос: на «как дела» — лёгкую и дешёвую, на «создай приложение» — сильную.",
          "Если задача сложная, а выбрана слабая модель — предложит переключиться на более мощную (в т.ч. из другого подключения).",
        ],
      },
      {
        title: "4. Режим «Агент»",
        items: [
          "Кнопка «Агент» вверху справа. Модель получает инструменты: чтение/запись/правка файлов, список папки, поиск (grep), выполнение команд (bash).",
          "Разрушающие действия (запись, правка, команды) выполняются только после твоего подтверждения — появится окно с деталями.",
          "Шаги агента видно прямо в ответе. Кнопка «Стоп» останавливает работу.",
          "Работает и с GigaChat (через текстовый протокол), и с OpenAI-совместимыми (нативно).",
        ],
      },
      {
        title: "5. GigaChat",
        items: [
          "Выбери «GigaChat» в настройках, вставь Authorization key (Basic). Сертификат (Russian Trusted Root CA) уже встроен — ничего искать не надо.",
          "Авторизация и обновление токена — автоматически. Запросы сериализуются под freemium.",
        ],
      },
      {
        title: "6. Память между моделями (handoff)",
        items: [
          "История хранится в едином провайдер-нейтральном виде.",
          "Переключил модель посреди работы (например с одной на GigaChat) — новая модель продолжает с того же места без потери контекста.",
        ],
      },
      {
        title: "7. Экономия токенов",
        items: [
          "Длинные диалоги автоматически сворачиваются в краткое резюме.",
          "Где поддерживается — включается кэширование промпта.",
          "Вывод инструментов агрессивно обрезается; файлы можно читать по диапазону строк.",
        ],
      },
      {
        title: "8. Язык и приватность",
        items: [
          "Язык интерфейса (RU/EN/ES) — внизу слева.",
          "Всё работает локально. Наружу приложение ходит только к тем API, ключи которых ты вставил. Ничего «домой» не отправляется.",
        ],
      },
    ],
  },
  en: {
    heading: "User Guide",
    intro:
      "Magnetar is a local AI agent: chat, code and access to your computer, working with any AI via your own API key.",
    sections: [
      {
        title: "1. Getting started",
        items: [
          "Open “Settings & keys” (bottom left).",
          "Pick a provider type: “OpenAI-compatible” (OpenRouter, Kimi, …) or “GigaChat”.",
          "Paste your API key and click “Add”. Keys live in the macOS Keychain, never in plaintext.",
          "Choose a model up top and start typing.",
        ],
      },
      {
        title: "2. Models on the fly",
        items: [
          "The model switcher is at the top left. Models are pulled from the provider automatically.",
          "With many models a search box appears — just start typing.",
          "Connect several providers and switch between them in the same menu.",
        ],
      },
      {
        title: "3. Adaptive mode",
        items: [
          "The “Adaptive” button is at the top right.",
          "Magnetar picks the right-sized model per prompt: a small/cheap one for “how are you”, a strong one for “build an app”.",
          "If the task is complex but a weak model is selected, it suggests switching to a stronger one (even on another connection).",
        ],
      },
      {
        title: "4. Agent mode",
        items: [
          "The “Agent” button is at the top right. The model gets tools: read/write/edit files, list a directory, search (grep), run commands (bash).",
          "Destructive actions (write, edit, commands) run only after you confirm — a dialog shows the details.",
          "Agent steps are shown inline in the reply. “Stop” halts it.",
          "Works with GigaChat (text protocol) and OpenAI-compatible providers (native tools).",
        ],
      },
      {
        title: "5. GigaChat",
        items: [
          "Choose “GigaChat” in settings and paste the Authorization key (Basic). The Russian Trusted Root CA is already built in — nothing to hunt for.",
          "Auth and token refresh are automatic. Requests are serialized for the freemium tier.",
        ],
      },
      {
        title: "6. Cross-model handoff",
        items: [
          "History is kept in a single provider-neutral form.",
          "Switch model mid-task (e.g. to GigaChat) and the new model continues from the same place without losing context.",
        ],
      },
      {
        title: "7. Token economy",
        items: [
          "Long chats are automatically compressed into a short summary.",
          "Prompt caching is enabled where supported.",
          "Tool output is aggressively trimmed; files can be read by line range.",
        ],
      },
      {
        title: "8. Language & privacy",
        items: [
          "UI language (RU/EN/ES) is at the bottom left.",
          "Everything runs locally. The app only reaches the APIs whose keys you added. Nothing phones home.",
        ],
      },
    ],
  },
  es: {
    heading: "Guía de uso",
    intro:
      "Magnetar es un agente de IA local: chat, código y acceso a tu ordenador, funciona con cualquier IA mediante tu propia clave API.",
    sections: [
      {
        title: "1. Primeros pasos",
        items: [
          "Abre «Ajustes y claves» (abajo a la izquierda).",
          "Elige el tipo de proveedor: «Compatible con OpenAI» (OpenRouter, Kimi, …) o «GigaChat».",
          "Pega tu clave API y pulsa «Añadir». Las claves se guardan en el Keychain de macOS, nunca en texto plano.",
          "Elige un modelo arriba y empieza a escribir.",
        ],
      },
      {
        title: "2. Modelos al vuelo",
        items: [
          "El selector de modelos está arriba a la izquierda. Los modelos se obtienen del proveedor automáticamente.",
          "Con muchos modelos aparece un buscador — solo empieza a escribir.",
          "Conecta varios proveedores y cambia entre ellos en el mismo menú.",
        ],
      },
      {
        title: "3. Modo adaptativo",
        items: [
          "El botón «Adaptativo» está arriba a la derecha.",
          "Magnetar elige el modelo adecuado para cada mensaje: uno pequeño/barato para «¿qué tal?», uno potente para «crea una app».",
          "Si la tarea es compleja pero hay un modelo débil seleccionado, sugiere cambiar a uno más potente (incluso de otra conexión).",
        ],
      },
      {
        title: "4. Modo agente",
        items: [
          "El botón «Agente» está arriba a la derecha. El modelo obtiene herramientas: leer/escribir/editar archivos, listar carpetas, buscar (grep), ejecutar comandos (bash).",
          "Las acciones destructivas (escribir, editar, comandos) solo se ejecutan tras tu confirmación — un diálogo muestra los detalles.",
          "Los pasos del agente se ven en la respuesta. «Stop» lo detiene.",
          "Funciona con GigaChat (protocolo de texto) y con proveedores compatibles con OpenAI (herramientas nativas).",
        ],
      },
      {
        title: "5. GigaChat",
        items: [
          "Elige «GigaChat» en ajustes y pega la Authorization key (Basic). El Russian Trusted Root CA ya está integrado — no hay que buscar nada.",
          "La autorización y la renovación del token son automáticas. Las solicitudes se serializan para el nivel freemium.",
        ],
      },
      {
        title: "6. Continuidad entre modelos",
        items: [
          "El historial se guarda en un formato único e independiente del proveedor.",
          "Cambia de modelo a mitad de tarea (p. ej. a GigaChat) y el nuevo modelo continúa desde el mismo punto sin perder contexto.",
        ],
      },
      {
        title: "7. Ahorro de tokens",
        items: [
          "Las conversaciones largas se comprimen automáticamente en un resumen breve.",
          "Se activa el caché de prompts donde es compatible.",
          "La salida de las herramientas se recorta de forma agresiva; los archivos se pueden leer por rango de líneas.",
        ],
      },
      {
        title: "8. Idioma y privacidad",
        items: [
          "El idioma de la interfaz (RU/EN/ES) está abajo a la izquierda.",
          "Todo funciona localmente. La app solo contacta las APIs cuyas claves añadiste. No envía nada a terceros.",
        ],
      },
    ],
  },
};

export function GuideDialog({ onClose }: { onClose: () => void }) {
  const lang = useStore((s) => s.lang);
  const g = GUIDE[lang];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <LogoMark size={22} />
            <h2 className="text-base font-semibold">{g.heading}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 py-5">
          <p className="text-sm text-[var(--color-text-dim)]">{g.intro}</p>
          {g.sections.map((s) => (
            <div key={s.title}>
              <h3 className="mb-1.5 text-sm font-semibold text-[var(--color-accent-strong)]">
                {s.title}
              </h3>
              <ul className="space-y-1.5">
                {s.items.map((it, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-sm leading-relaxed text-[var(--color-text)]"
                  >
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
