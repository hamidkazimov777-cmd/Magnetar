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
      "Magnetar — это AI IDE с постоянной памятью проекта. В центре не модель, а проект: модель — сменный исполнитель, а память проекта остаётся и переживает любую смену модели.",
    sections: [
      {
        title: "1. Порядок первого запуска",
        items: [
          "Подключите модель: значок ключа внизу слева → выберите провайдера (OpenAI-совместимый, GigaChat, локальный) → вставьте ключ → «Проверить». Ключ хранится в macOS Keychain.",
          "Откройте папку проекта. Это главное действие: папка и есть проект. Magnetar сам создаст проект, привяжет к нему путь, построит индекс кода и соберёт первые факты о проекте.",
          "Создавать проект кнопкой «Новый проект» стоит только если папки нет — такой проект остаётся без пути, и агент не сможет читать файлы.",
          "Режим агента включается автоматически при открытии папки.",
        ],
      },
      {
        title: "2. Интерфейс",
        items: [
          "Левый рельс разделён на две группы. Верхняя — код: Файлы, Поиск, Git, Проблемы, Изменения агента. Нижняя — проект: Память проекта и Чаты.",
          "Кнопка «i» вверху рельса включает режим подсказок: наведите курсор на любой элемент — и получите объяснение, что он делает и когда срабатывает.",
          "Тема (светлая, тёмная, как в системе) — значок солнца/луны внизу рельса, а также в Настройках и в ⌘K.",
          "⌘K — палитра команд, ⌘J — терминал, ⌘B — левая панель, ⌘⇧A — панель агента, ⌘S — сохранить, ⌘W — закрыть вкладку.",
        ],
      },
      {
        title: "3. Память проекта: чем она заполняется",
        items: [
          "Описание, технологии, архитектура, стандарты кода — заполняются аудитом при открытии папки. Аудит читает package.json, README, Cargo.toml и подобные файлы. Повторить его можно кнопкой «Проанализировать в память» в панели «Файлы».",
          "Ключевые решения — извлекаются автоматически из переписки, когда в чате накопится примерно десять сообщений. Их можно и нужно править руками.",
          "Где остановились — записывается при переключении модели: уходящая модель оставляет заметку, с которой начинает следующая. Не хотите переключать модель — нажмите «Зафиксировать состояние» в панели «Память проекта».",
          "Граф знаний строится из той же переписки одновременно с ключевыми решениями.",
          "Внизу панели «Память проекта» есть журнал: что и когда записано, а что не удалось и почему. Если память пуста — ответ всегда там.",
        ],
      },
      {
        title: "4. Чат и привязка к проекту",
        items: [
          "Чат привязывается к проекту в момент создания. Память пополняется только из привязанных чатов.",
          "Если чат создан до того, как появился проект, панель «Память проекта» покажет предупреждение и кнопку привязки.",
          "Выбор проекта в списке подхватывает текущий чат, если тот ещё пустой или ни к чему не привязан. Чужую переписку Magnetar не переносит.",
        ],
      },
      {
        title: "5. Режим агента",
        items: [
          "Кнопка «Агент» над полем ввода. С ней модель получает инструменты: чтение, правка и создание файлов, поиск по коду, список папок, команды в терминале.",
          "Без агента это обычный чат: модель не видит ни одного файла и честно об этом скажет.",
          "Правки применяются сразу и попадают в раздел «Изменения агента», где каждую можно посмотреть и откатить. Команды в терминале требуют подтверждения — это настраивается.",
          "Значок глаза в шапке панели показывает, что именно ушло модели в последнем запросе.",
        ],
      },
      {
        title: "6. Проблемы",
        items: [
          "Раздел «Проблемы» запускает проверки самого проекта: типы, линтер, тесты.",
          "Команды не выдумываются: они берутся из скриптов package.json, а для Rust — из Cargo.toml. Если скриптов нет, список будет пустым.",
          "Вывод разбирается в список ошибок; клик по строке открывает файл.",
        ],
      },
      {
        title: "7. Модели",
        items: [
          "Переключатель моделей — в шапке панели агента. Фиолетовая точка отмечает активную модель: это единственное место в интерфейсе, где цвет означает «здесь работает ИИ».",
          "Адаптивный режим сам подбирает модель под сложность запроса.",
          "Фоновую работу (аудит, резюме, решения, граф) выполняет отдельная дешёвая модель. Её можно закрепить в Настройках → Память проекта — так надёжнее, чем автоподбор.",
        ],
      },
      {
        title: "8. Подписки",
        items: [
          "Раздел «Подписки» открывает ChatGPT, Claude, Gemini или DeepSeek во встроенном браузере — вы входите своей подпиской, ничего не автоматизируется.",
          "«Скопировать контекст проекта» собирает память и открытые задачи в один текст для вставки в чат подписки.",
          "Ответ можно вставить обратно и добавить в канон проекта.",
          "Если Google не пускает по кнопке «Войти через Google», используйте вход по почте и паролю — Google ограничивает вход во встроенных браузерах.",
        ],
      },
      {
        title: "9. Приватность",
        items: [
          "Всё работает локально. Наружу приложение обращается только к тем API, ключи от которых вы вставили сами.",
          "Ключи хранятся в macOS Keychain, переписка и память — в локальной базе SQLite.",
        ],
      },
    ],
  },
  en: {
    heading: "User Guide",
    intro:
      "Magnetar is an AI IDE with persistent project memory. The project is at the centre, not the model: models are swappable executors, while project memory stays and survives any model switch.",
    sections: [
      {
        title: "1. First run, in order",
        items: [
          "Connect a model: the key icon at the bottom left → pick a provider (OpenAI-compatible, GigaChat, local) → paste the key → Test. Keys live in the macOS Keychain.",
          "Open a project folder. This is the main action: the folder is the project. Magnetar creates the project, binds the path, builds the code index and collects the first facts.",
          "Use \u201cNew project\u201d only when there is no folder — such a project has no path, and the agent cannot read files.",
          "Agent mode turns itself on when you open a folder.",
        ],
      },
      {
        title: "2. Layout",
        items: [
          "The left rail has two groups. Code: Files, Search, Git, Problems, Agent changes. Project: Project memory and Chats.",
          "The \u201ci\u201d button at the top of the rail turns on hints — hover any control to learn what it does and when it runs.",
          "Theme (light, dark, match system) sits at the bottom of the rail, in Settings, and in \u2318K.",
          "\u2318K command palette, \u2318J terminal, \u2318B sidebar, \u2318\u21e7A agent panel, \u2318S save, \u2318W close tab.",
        ],
      },
      {
        title: "3. Project memory: what fills it",
        items: [
          "Description, stack, architecture and coding standards come from the audit that runs when you open a folder; it reads package.json, README, Cargo.toml and similar. Re-run it from the Files panel.",
          "Key decisions are mined from the conversation once a chat reaches roughly ten messages. Editing them by hand is expected.",
          "Where we stopped is written when you switch models: the outgoing model leaves the note the next one starts from. Don't want to switch? Use \u201cSave current state\u201d in the Project memory panel.",
          "The knowledge graph is built from the same transcript, alongside the decisions.",
          "The bottom of the Project memory panel holds a log: what was written and what failed. If memory looks empty, the answer is there.",
        ],
      },
      {
        title: "4. Chats and project binding",
        items: [
          "A chat binds to a project when it is created. Only bound chats feed memory.",
          "If a chat predates the project, the Project memory panel shows a warning and a button to attach it.",
          "Selecting a project adopts the current chat when that chat is empty or unbound. Someone else's conversation is never moved.",
        ],
      },
      {
        title: "5. Agent mode",
        items: [
          "The Agent toggle sits above the composer. With it the model gets tools: read, edit and create files, search code, list folders, run terminal commands.",
          "Without it this is a plain chat — the model sees no files and will say so.",
          "Edits apply immediately and land in Agent changes, where each one can be reviewed and reverted. Shell commands ask first; that is configurable.",
          "The eye icon shows exactly what the last request sent to the model.",
        ],
      },
      {
        title: "6. Problems",
        items: [
          "The Problems panel runs the project's own checks: types, linter, tests.",
          "Commands are not invented — they come from package.json scripts, or Cargo.toml for Rust. No scripts, no checks.",
          "Output is parsed into a list; clicking an entry opens the file.",
        ],
      },
      {
        title: "7. Models",
        items: [
          "The model switcher is in the agent panel header. A violet dot marks the active model — the one place colour means \u201cAI is working here\u201d.",
          "Adaptive mode routes each request to a model that fits it.",
          "Background work (audit, summaries, decisions, graph) runs on a separate cheap model. Pin it in Settings → Project memory; that beats the automatic pick.",
        ],
      },
      {
        title: "8. Subscriptions",
        items: [
          "Subscriptions opens ChatGPT, Claude, Gemini or DeepSeek in a built-in browser — you sign in with your own subscription, nothing is automated.",
          "\u201cCopy project context\u201d packs memory and open tasks into one block to paste there.",
          "Paste the reply back to add it to the project canon.",
          "If Google refuses the \u201cSign in with Google\u201d button, use email and password — Google restricts sign-in inside embedded browsers.",
        ],
      },
      {
        title: "9. Privacy",
        items: [
          "Everything runs locally. The app only talks to the APIs whose keys you entered yourself.",
          "Keys live in the macOS Keychain; conversations and memory in a local SQLite database.",
        ],
      },
    ],
  },
  es: {
    heading: "Guía de uso",
    intro:
      "Magnetar es un IDE con IA y memoria persistente del proyecto. En el centro está el proyecto, no el modelo: los modelos son ejecutores intercambiables y la memoria permanece.",
    sections: [
      {
        title: "1. Primer arranque, en orden",
        items: [
          "Conecta un modelo: icono de llave abajo a la izquierda → elige proveedor (compatible con OpenAI, GigaChat, local) → pega la clave → «Probar». Las claves van al Keychain de macOS.",
          "Abre una carpeta de proyecto. Es la acción principal: la carpeta es el proyecto. Magnetar crea el proyecto, vincula la ruta, construye el índice y reúne los primeros datos.",
          "Usa «Nuevo proyecto» solo si no hay carpeta: ese proyecto queda sin ruta y el agente no puede leer archivos.",
          "El modo agente se activa solo al abrir una carpeta.",
        ],
      },
      {
        title: "2. Interfaz",
        items: [
          "La barra izquierda tiene dos grupos. Código: Archivos, Búsqueda, Git, Problemas, Cambios del agente. Proyecto: Memoria del proyecto y Chats.",
          "El botón «i» activa las pistas: pasa el cursor sobre cualquier control para saber qué hace y cuándo actúa.",
          "El tema (claro, oscuro, según el sistema) está abajo en la barra, en Ajustes y en ⌘K.",
          "⌘K paleta, ⌘J terminal, ⌘B panel izquierdo, ⌘⇧A panel del agente, ⌘S guardar, ⌘W cerrar pestaña.",
        ],
      },
      {
        title: "3. Memoria del proyecto: qué la llena",
        items: [
          "Descripción, stack, arquitectura y estándares salen de la auditoría al abrir la carpeta, que lee package.json, README, Cargo.toml y similares.",
          "Las decisiones clave se extraen de la conversación cuando el chat llega a unos diez mensajes. Se pueden editar a mano.",
          "«Dónde nos quedamos» se escribe al cambiar de modelo. Si no quieres cambiar, usa «Guardar el estado» en el panel de memoria.",
          "El grafo de conocimiento se construye del mismo historial.",
          "Abajo del panel hay un registro: qué se escribió y qué falló. Si la memoria está vacía, la respuesta está ahí.",
        ],
      },
      {
        title: "4. Chats y vínculo con el proyecto",
        items: [
          "Un chat se vincula a un proyecto al crearse. Solo los chats vinculados alimentan la memoria.",
          "Si el chat es anterior al proyecto, el panel muestra un aviso y un botón para vincularlo.",
          "Elegir un proyecto adopta el chat actual si está vacío o sin vincular. Nunca se mueve una conversación ajena.",
        ],
      },
      {
        title: "5. Modo agente",
        items: [
          "El interruptor «Agente» está sobre el campo de texto. Con él el modelo obtiene herramientas: leer, editar y crear archivos, buscar en el código, ejecutar comandos.",
          "Sin él es un chat normal: el modelo no ve ningún archivo y lo dirá.",
          "Las ediciones se aplican y aparecen en «Cambios del agente», donde se revisan y revierten una a una.",
          "El icono del ojo muestra qué se envió exactamente en la última petición.",
        ],
      },
      {
        title: "6. Problemas",
        items: [
          "El panel «Problemas» ejecuta las comprobaciones del propio proyecto: tipos, linter, pruebas.",
          "Los comandos salen de package.json o de Cargo.toml; no se inventan.",
          "La salida se convierte en una lista y al pulsar se abre el archivo.",
        ],
      },
      {
        title: "7. Modelos",
        items: [
          "El selector está en la cabecera del panel del agente. Un punto violeta marca el modelo activo.",
          "El modo adaptativo enruta cada petición a un modelo adecuado.",
          "El trabajo en segundo plano usa un modelo barato aparte. Fíjalo en Ajustes → Memoria del proyecto.",
        ],
      },
      {
        title: "8. Suscripciones",
        items: [
          "«Suscripciones» abre ChatGPT, Claude, Gemini o DeepSeek en un navegador integrado: entras con tu suscripción y nada se automatiza.",
          "«Copiar el contexto del proyecto» reúne la memoria y las tareas abiertas en un bloque.",
          "Pega la respuesta de vuelta para añadirla al canon del proyecto.",
          "Si Google rechaza el botón de acceso, entra con correo y contraseña: Google limita el acceso en navegadores integrados.",
        ],
      },
      {
        title: "9. Privacidad",
        items: [
          "Todo es local. La aplicación solo habla con las APIs cuyas claves introdujiste.",
          "Las claves en el Keychain de macOS; conversaciones y memoria en SQLite local.",
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
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-overlay)] p-4"
      onMouseDown={onClose}
    >
      <div
        className="anim-in flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--r-xl)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--e-3)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <LogoMark size={22} />
            <h2 className="text-[length:var(--fs-lg)] font-semibold">{g.heading}</h2>
          </div>
          <button
            onClick={onClose}
            className="icon-btn"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 py-5">
          <p className="text-[length:var(--fs-md)] leading-relaxed text-[var(--color-text-dim)]">
            {g.intro}
          </p>
          {g.sections.map((s) => (
            <div key={s.title}>
              <h3 className="mb-1.5 text-[length:var(--fs-md)] font-semibold text-[var(--color-accent-strong)]">
                {s.title}
              </h3>
              <ul className="space-y-1.5">
                {s.items.map((it, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-[length:var(--fs-base)] leading-relaxed text-[var(--color-text)]"
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
