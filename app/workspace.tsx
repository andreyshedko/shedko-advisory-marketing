"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Handshake,
  Mail,
  ChartNoAxesCombined,
  Wallet,
  ListTodo,
  FileBarChart2,
  Plug,
  History,
  ArrowUpRight,
  Plus,
  Search,
  ChevronRight,
  LogOut,
  RefreshCw,
  CheckCircle2,
  Download,
  ShieldCheck,
  Menu,
} from "lucide-react";
import type { DashboardData, Organization } from "@/lib/types";
import { ResearchPanel, ResearchJsonForm } from "./research-panel";
import Forms, { type ModalState } from "./forms";
import {
  Badge,
  Empty,
  External,
  Modal,
  Form,
  dateTime,
  money,
  kinds,
  statuses,
} from "./ui";
const navigation = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "organizations", label: "Компании и поиск", icon: Building2 },
  { id: "partners", label: "Партнёрские заявки", icon: Handshake },
  { id: "outreach", label: "Письма и ответы", icon: Mail },
  { id: "ads", label: "Google Ads", icon: ChartNoAxesCombined },
  { id: "spend", label: "Расходы", icon: Wallet },
  { id: "tasks", label: "Следующие действия", icon: ListTodo },
  { id: "reports", label: "Отчёты", icon: FileBarChart2 },
  { id: "integrations", label: "Интеграции", icon: Plug },
  { id: "activity", label: "Журнал", icon: History },
];
const titles: Record<
  string,
  { title: string; description: string; tag: string }
> = {
  overview: {
    title: "Системный маркетинг. Реальные сделки.",
    description: "От проверенного источника до содержательного разговора.",
    tag: "РАБОЧАЯ ПАНЕЛЬ",
  },
  organizations: {
    title: "Следующие партнёры — здесь.",
    description:
      "Находите и изучайте компании, которым нужна независимая техническая экспертиза.",
    tag: "ПОИСК И ИССЛЕДОВАНИЕ",
  },
  partners: {
    title: "Партнёрства, которые работают.",
    description:
      "Программы, материалы и персонализированные заявки под вашим контролем.",
    tag: "PARTNER DEVELOPMENT",
  },
  outreach: {
    title: "Каждое обращение — по делу.",
    description:
      "Проверенный контакт. Персональный текст. Ваше решение об отправке.",
    tag: "КОРПОРАТИВНАЯ ПЕРЕПИСКА",
  },
  ads: {
    title: "Реклама в цифрах.",
    description:
      "Расходы и результаты из CSV или подтверждённого Google Ads Script.",
    tag: "GOOGLE ADS",
  },
  spend: {
    title: "Понятные расходы.",
    description: "Инструменты, площадки и реклама с отдельным учётом валют.",
    tag: "БЮДЖЕТ",
  },
  tasks: {
    title: "Следующий шаг имеет значение.",
    description: "Проверки, follow-up и оповещения о расходах.",
    tag: "ОПЕРАЦИОННЫЙ ПЛАН",
  },
  reports: {
    title: "От активности к результату.",
    description: "Кому написали, кто ответил и что привело к разговору.",
    tag: "МАРКЕТИНГОВЫЕ ОТЧЁТЫ",
  },
  integrations: {
    title: "Подключения без догадок.",
    description: "Конфигурация и фактическая синхронизация показаны отдельно.",
    tag: "ИНФРАСТРУКТУРА",
  },
  activity: {
    title: "Каждое действие записано.",
    description: "Журнал изменений, ручных утверждений и фоновых проверок.",
    tag: "АУДИТ",
  },
};
const modalTitles: Record<string, string> = {
  organization: "Новая компания",
  "org-detail": "Карточка компании",
  contact: "Проверенный контакт",
  evidence: "Источник и доказательства",
  draft: "Новое персональное письмо",
  message: "Письмо и согласование",
  reply: "Фактический ответ",
  followup: "Задача follow-up",
  "followup-draft": "Единственный follow-up",
  resolve: "Проверка результата SMTP",
  partner: "Партнёрская программа",
  "partner-detail": "Заявка и материалы",
  spend: "Запись расхода",
  opportunity: "Новая возможность",
  "opportunity-detail": "Переговоры и результат",
  task: "Следующее действие",
  import: "Импорт Google Ads",
  "research-import": "Результаты поиска ChatGPT",
};
async function fetchDashboard(
  from: string,
  to: string,
  kind: string,
  signal?: AbortSignal,
): Promise<DashboardData> {
  const r = await fetch(
    `/api/admin?${new URLSearchParams({ from, to, kind })}`,
    { cache: "no-store", signal },
  );
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || "Ошибка загрузки");
  return json;
}
function initialDate(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}
export default function Workspace({
  section,
  email,
}: {
  section: string;
  email: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [from, setFrom] = useState(initialDate(30));
  const [to, setTo] = useState(initialDate(0));
  const [kind, setKind] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(
    "M&A advisor software acquisitions United States United Kingdom",
  );
  const [mobile, setMobile] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const next = await fetchDashboard(from, to, kind, signal);
    if (!signal?.aborted) setData(next);
  }, [from, to, kind]);
  const mailboxConfigured = Boolean(data?.connections.imap);
  useEffect(() => {
    if (
      !["outreach", "integrations"].includes(section) ||
      !mailboxConfigured ||
      modal ||
      busy
    )
      return;
    const controller = new AbortController();
    let running = false;
    async function syncReplies() {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        const response = await fetch("/api/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "mailbox.sync",
            data: { force: false },
          }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (response.ok && result.throttled !== true && !controller.signal.aborted)
          await load(controller.signal);
      } catch {
        // Background checks stay quiet; manual sync reports connection errors.
      } finally {
        running = false;
      }
    }
    void syncReplies();
    const timer = setInterval(() => void syncReplies(), 5 * 60 * 1000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [section, mailboxConfigured, modal, busy, load]);
  useEffect(() => {
    const controller = new AbortController();
    fetchDashboard(from, to, kind, controller.signal)
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [from, to, kind]);
  function open(value: ModalState) {
    setError("");
    setNotice("");
    setModal(value);
  }
  async function invoke(action: string, payload: unknown, keepOpen = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data: payload }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || "Не удалось выполнить операцию");
      await load();
      if (!keepOpen) setModal(null);
      setNotice(
        action === "mailbox.sync"
          ? json.throttled === true
            ? "Проверка уже выполняется. Результат появится после обновления."
            : `Проверено писем: ${json.scanned}. Найдено ответов: ${json.matched}. Добавлено: ${json.imported}.${json.hasMore ? " Остались письма; запустите проверку ещё раз." : ""}`
          : "Действие выполнено и записано в журнал.",
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка операции");
      await load().catch(() => {});
      return false;
    } finally {
      setBusy(false);
    }
  }
  const mailboxIntegration = data?.integrations.find(
    (integration) => integration.name === "porkbun_imap",
  );
  const adsConnected = data?.integrations.some(
    (integration) =>
      integration.name === "google_ads_scripts" &&
      integration.status === "connected",
  );
  const chosenOrg = (o: Organization) => kind === "all" || o.kind === kind;
  const period = (value: string) =>
    value.slice(0, 10) >= from && value.slice(0, 10) <= to;
  const visibleOrg =
    data?.organizations.filter(
      (o) =>
        chosenOrg(o) &&
        period(o.created_at) &&
        o.name.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  const inOrg = (organizationId: string) =>
    data?.organizations.some((o) => o.id === organizationId && chosenOrg(o));
  const messages =
    data?.messages.filter(
      (m) =>
        inOrg(m.organization_id) &&
        (period(m.created_at) ||
          (m.sent_at && period(m.sent_at)) ||
          data.events.some(
            (e) => e.message_id === m.id && period(e.created_at),
          )),
    ) || [];
  const partners =
    data?.partners.filter(
      (p) => inOrg(p.organization_id) && period(p.created_at),
    ) || [];
  const opportunities =
    data?.opportunities.filter(
      (o) =>
        inOrg(o.organization_id) &&
        (period(o.created_at) ||
          data.opportunityEvents.some(
            (e) => e.opportunity_id === o.id && period(e.entered_at),
          )),
    ) || [];
  const sentInPeriod = messages.filter(
    (m) => m.status === "sent" && m.sent_at && period(m.sent_at),
  );
  const openTasks =
    data?.tasks.filter(
      (t) =>
        t.status === "open" && (!t.organization_id || inOrg(t.organization_id)),
    ) || [];
  function orgTable(rows: Organization[]) {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Компания / платформа</th>
              <th>Тип и география</th>
              <th>Проверка</th>
              <th>Статус</th>
              <th aria-label="Открыть" />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>
                  <button
                    className="org-name"
                    onClick={() => open({ kind: "org-detail", id: o.id })}
                  >
                    <span className="avatar small">
                      {o.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <strong>
                        {o.name}
                        {o.demo && " · DEMO"}
                      </strong>
                      <small>{o.domain}</small>
                    </span>
                  </button>
                </td>
                <td>
                  {kinds[o.kind]}
                  <small>{o.country}</small>
                </td>
                <td>
                  <span className={`dot ${o.verified_at ? "green" : ""}`} />
                  {o.verified_at ? "Проверено вручную" : "Не проверено"}
                </td>
                <td>
                  <Badge value={o.status} />
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Открыть ${o.name}`}
                    onClick={() => open({ kind: "org-detail", id: o.id })}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  function taskList(limit = 100) {
    return openTasks.length ? (
      <div className="task-list">
        {openTasks.slice(0, limit).map((t) => (
          <div className="task-row" key={t.id}>
            <button
              disabled={busy}
              className="complete"
              aria-label={`Завершить: ${t.title}`}
              onClick={() => invoke("task.complete", { id: t.id })}
            >
              <CheckCircle2 size={19} />
            </button>
            <div>
              <strong>{t.title}</strong>
              <small>
                {t.organization || "Рабочее пространство"} ·{" "}
                {dateTime(t.due_at)}
              </small>
              {t.message_id && t.kind === "followup" && (
                <button
                  className="text-button"
                  onClick={() =>
                    open({ kind: "followup-draft", id: t.message_id! })
                  }
                >
                  Подготовить follow-up
                  <ArrowUpRight size={13} />
                </button>
              )}
            </div>
            {new Date(t.due_at) < new Date() && (
              <span className="badge status-review">К действию</span>
            )}
          </div>
        ))}
      </div>
    ) : (
      <Empty
        title="План пока свободен"
        detail="Назначайте следующие действия в карточках компаний или создайте задачу."
      />
    );
  }
  function downloadReport() {
    if (!data) return;
    const lines = [
      `# Shedko Advisory — маркетинговый отчёт`,
      `${from} — ${to}. Тип: ${kind === "all" ? "Все" : kinds[kind]}`,
      ``,
      ...Object.entries(data.metrics).map(([k, v]) => `${k}: ${v}`),
      "",
      "## Письма",
      ...sentInPeriod.map(
        (m) =>
          `- ${m.organization} → ${m.recipient}: ${m.subject}; ${statuses[m.status] || m.status}`,
      ),
      "",
      "## Ответы",
      ...data.events
        .filter(
          (e) =>
            ["reply", "positive_reply", "opt_out"].includes(e.kind) &&
            period(e.created_at) &&
            messages.some((m) => m.id === e.message_id),
        )
        .map(
          (e) =>
            `- ${dateTime(e.created_at)} · ${data.messages.find((m) => m.id === e.message_id)?.organization}: ${e.kind} — ${e.detail}`,
        ),
      "",
      "## Переговоры и предложения",
      ...opportunities.map(
        (o) => `- ${o.organization}: ${statuses[o.stage]} — ${o.notes}`,
      ),
      "",
      "## Следующие действия",
      ...openTasks.map(
        (t) =>
          `- ${t.title} (${t.organization || "общее"}), ${dateTime(t.due_at)}`,
      ),
      "",
      "## Расходы — все организации, отдельные валюты",
      ...data.totals.map(
        (t) => `- ${t.source}: ${money(t.amount, t.currency)}`,
      ),
      "",
      "Стоимость привлечения не рассчитана: отсутствует подтверждённая атрибуция расходов к заказам.",
    ];
    const href = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = `shedko-report-${from}-${to}.md`;
    a.click();
    URL.revokeObjectURL(href);
  }
  const title = titles[section] || titles.overview;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <Link className="wordmark" href="/">
          SHEDKO<span>ADVISORY</span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-mark">S</span>
          <div>
            Marketing Automation<small>PRIVATE WORKSPACE</small>
          </div>
        </div>
        <nav aria-label="Главная навигация">
          {navigation.map((n, i) => (
            <Link
              key={n.id}
              className={`${section === n.id ? "active" : ""} ${i === 8 ? "nav-break" : ""}`}
              href={n.id === "overview" ? "/" : `/${n.id}`}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "tasks" && openTasks.length > 0 && (
                <span className="nav-count">{openTasks.length}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="guard">
            <ShieldCheck size={17} />
            <span>
              Решения остаются за вами<small>Отправка только вручную</small>
            </span>
          </div>
          <div className="user">
            <span className="avatar">AS</span>
            <div>
              Администратор<small title={email}>{email}</small>
            </div>
            <button
              className="icon-button"
              title="Выйти"
              aria-label="Выйти"
              onClick={async () => {
                await fetch("/api/auth/sign-out", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                });
                router.push("/");
                router.refresh();
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-toggle"
              onClick={() => setMobile(!mobile)}
              aria-label="Меню"
              aria-expanded={mobile}
            >
              <Menu size={20} />
            </button>
            <span>Shedko Advisory</span>
            <ChevronRight size={14} />
            <strong>{navigation.find((n) => n.id === section)?.label}</strong>
          </div>
          <span className="live-indicator">
            <span className={`dot ${data ? "green" : ""}`} />
            {data ? "Данные PostgreSQL" : "Подключение…"}
          </span>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">{title.tag}</span>
              <h1>{title.title}</h1>
              <p>{title.description}</p>
            </div>
            <div className="button-row">
              {section === "overview" || section === "organizations" ? (
                <button
                  className="primary"
                  onClick={() => open({ kind: "organization" })}
                >
                  <Plus size={17} />
                  Добавить компанию
                </button>
              ) : section === "outreach" ? (
                <button
                  className="primary"
                  onClick={() => open({ kind: "draft" })}
                >
                  <Plus size={17} />
                  Подготовить письмо
                </button>
              ) : section === "partners" ? (
                <button
                  className="primary"
                  onClick={() => open({ kind: "partner" })}
                >
                  <Plus size={17} />
                  Новая заявка
                </button>
              ) : section === "ads" ? (
                <button
                  className="primary"
                  onClick={() => open({ kind: "import" })}
                >
                  <Plus size={17} />
                  Импорт CSV
                </button>
              ) : section === "spend" ? (
                <button
                  className="primary"
                  onClick={() => open({ kind: "spend" })}
                >
                  <Plus size={17} />
                  Добавить расход
                </button>
              ) : section === "tasks" ? (
                <button
                  className="primary"
                  onClick={() => open({ kind: "task" })}
                >
                  <Plus size={17} />
                  Новая задача
                </button>
              ) : section === "reports" ? (
                <button className="primary" onClick={downloadReport}>
                  <Download size={17} />
                  Скачать отчёт
                </button>
              ) : null}
            </div>
          </div>
          <div className="filterbar">
            <span className="filter-caption">Период · UTC</span>
            <label className="sr-only" htmlFor="filter-from">
              Начало периода
            </label>
            <input
              id="filter-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span>—</span>
            <label className="sr-only" htmlFor="filter-to">
              Конец периода
            </label>
            <input
              id="filter-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <span className="filter-divider" />
            <label className="sr-only" htmlFor="filter-kind">
              Тип организации
            </label>
            <select
              id="filter-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="all">Все типы организаций</option>
              {Object.entries(kinds).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button
              className="icon-button refresh"
              aria-label="Обновить данные"
              onClick={() => load().catch((e) => setError(e.message))}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {error && !modal && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && !modal && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          {!data ? (
            <div className="loading">
              <RefreshCw size={24} />
              <p>
                {error
                  ? "Не удалось загрузить данные."
                  : "Загружаем рабочее пространство…"}
              </p>
            </div>
          ) : (
            <>
              {section === "overview" && (
                <>
                  <div className="metric-grid">
                    {[
                      ["organizations", "Новые компании", Building2],
                      ["contacts", "Проверенные контакты", ShieldCheck],
                      ["sent", "Письма · SMTP принял", Mail],
                      ["replies", "Ответившие компании", Handshake],
                      [
                        "qualified",
                        "Квалифицированные лиды",
                        ChartNoAxesCombined,
                      ],
                      ["won", "Заказы", CheckCircle2],
                    ].map(([key, label, Icon]) => {
                      const MetricIcon = Icon as typeof Building2;
                      return (
                        <div className="metric" key={String(key)}>
                          <span>
                            {String(label)}
                            <MetricIcon size={15} />
                          </span>
                          <strong>{data.metrics[String(key)] ?? 0}</strong>
                          <small>За выбранный период</small>
                        </div>
                      );
                    })}
                  </div>
                  <div className="overview-grid">
                    <section className="panel funnel-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">
                            ОТ ОБРАЩЕНИЯ К РЕЗУЛЬТАТУ
                          </span>
                          <h2>Воронка привлечения</h2>
                        </div>
                        <Link className="text-button" href="/reports">
                          Отчёт
                          <ArrowUpRight size={15} />
                        </Link>
                      </div>
                      <div className="funnel">
                        {[
                          ["drafts", "Черновики"],
                          ["positive", "Позитивные ответы"],
                          ["negotiations", "Переговоры"],
                          ["proposals", "Предложения"],
                          ["won", "Заказы"],
                        ].map(([k, l], i) => (
                          <div className="funnel-stage" key={k}>
                            <span className="stage-index">0{i + 1}</span>
                            <div>
                              <span>{l}</span>
                              <strong>{data.metrics[k] || 0}</strong>
                              <div className="stage-track">
                                <i
                                  style={{
                                    width: `${Math.max(4, (100 * (data.metrics[k] || 0)) / Math.max(1, ...Object.values(data.metrics)))}%`,
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="muted fine">
                        Стадии показывают факты за период; показатели не
                        означают автоматическую атрибуцию.
                      </p>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">В ФОКУСЕ</span>
                          <h2>Следующие действия</h2>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="Новая задача"
                          onClick={() => open({ kind: "task" })}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                      {taskList(4)}
                      <Link href="/tasks" className="panel-link">
                        Открыть план
                        <ArrowUpRight size={16} />
                      </Link>
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">ИССЛЕДОВАНИЕ РЫНКА</span>
                        <h2>Последние компании</h2>
                      </div>
                      <Link className="text-button" href="/organizations">
                        Все компании
                        <ArrowUpRight size={15} />
                      </Link>
                    </div>
                    {visibleOrg.length ? (
                      orgTable(visibleOrg.slice(0, 5))
                    ) : (
                      <Empty
                        title="Начните с подходящей компании"
                        detail="Добавьте компанию и источник. Затем проверьте контакт и подготовьте персональное обращение."
                      >
                        <button
                          className="secondary"
                          onClick={() => open({ kind: "organization" })}
                        >
                          Добавить первую компанию
                          <Plus size={15} />
                        </button>
                      </Empty>
                    )}
                  </section>
                  <div className="connection-strip">
                    <span>
                      <Plug size={16} />
                      Подключения
                    </span>
                    {[
                      ["smtp", "Porkbun SMTP"],
                      ["imap", "Ответы IMAP"],
                      ["search", "Web search"],
                    ].map(([k, l]) => (
                      <span key={k}>
                        <i
                          className={`dot ${data.connections[k] ? "green" : ""}`}
                        />
                        {l} ·{" "}
                        {data.connections[k] ? "настроено" : "не подключено"}
                      </span>
                    ))}
                    <Link href="/integrations">
                      Настроить
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                </>
              )}
              {section === "organizations" && (
                <>
                  <ResearchPanel
                    data={data}
                    busy={busy}
                    sync={() => invoke("research.sync", { force: true })}
                    importJson={() => open({ kind: "research-import" })}
                    openOrganization={(id) => open({ kind: "org-detail", id })}
                    onSynced={load}
                  />
                  <section className="panel discovery">
                    <div>
                      <span className="eyebrow">МЕЖДУНАРОДНЫЙ ПОИСК</span>
                      <h2>Ищите там, где происходят сделки.</h2>
                      <p className="muted">
                        M&A advisers, покупатели software, search funds и
                        private equity в США, Великобритании, Европе и Канаде.
                      </p>
                    </div>
                    <div className="search-query">
                      <label className="sr-only" htmlFor="research-query">
                        Поисковый запрос
                      </label>
                      <input
                        id="research-query"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => invoke("discovery.search", { query })}
                      >
                        <Search size={16} />
                        Поиск через API
                      </button>
                      <External
                        href={`https://www.google.com/search?q=${encodeURIComponent(query)}`}
                      >
                        Открыть публичный поиск
                      </External>
                    </div>
                    <div className="query-chips">
                      {[
                        "software acquirer Canada acquisitions",
                        "search fund technology acquisition United Kingdom",
                        "technical due diligence partner directory Europe",
                        "M&A advisory technology United States",
                      ].map((q) => (
                        <button key={q} onClick={() => setQuery(q)}>
                          {q}
                          <ArrowUpRight size={13} />
                        </button>
                      ))}
                    </div>
                    <small className="muted">
                      {data.connections.search
                        ? "Brave Search настроен. Результаты сохраняются как непроверенные."
                        : "Поисковый API не подключён. Публичные поисковые ссылки работают без интеграции."}
                    </small>
                  </section>
                  {data.discoveries.length > 0 && (
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Найдено · требует проверки</h2>
                      </div>
                      {data.discoveries.map((r) => (
                        <div className="discovery-result" key={r.id}>
                          <External href={r.url}>{r.title}</External>
                          <p>{r.description}</p>
                          <Badge value="unverified" />
                        </div>
                      ))}
                    </section>
                  )}
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        База компаний{" "}
                        <span className="count">{visibleOrg.length}</span>
                      </h2>
                      <div className="search-input">
                        <Search size={16} />
                        <input
                          aria-label="Поиск по компании"
                          placeholder="Найти компанию…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    {visibleOrg.length ? (
                      orgTable(visibleOrg)
                    ) : (
                      <Empty
                        title="Список компаний пуст"
                        detail="Сохраните релевантную компанию вместе с подтверждающим источником."
                      />
                    )}
                  </section>
                </>
              )}
              {section === "partners" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      Заявки на партнёрство{" "}
                      <span className="count">{partners.length}</span>
                    </h2>
                    <span className="muted fine">
                      Подача только вручную после проверки
                    </span>
                  </div>
                  {partners.length ? (
                    <div className="card-grid">
                      {partners.map((p) => (
                        <button
                          className="record-card"
                          key={p.id}
                          onClick={() =>
                            open({ kind: "partner-detail", id: p.id })
                          }
                        >
                          <div>
                            <Handshake size={20} />
                            <Badge value={p.status} />
                          </div>
                          <h3>{p.organization}</h3>
                          <p>{p.channel.replaceAll("_", " ")}</p>
                          <span>
                            Материалы и текст заявки
                            <ArrowUpRight size={15} />
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Партнёрства начинаются с исследования"
                      detail="Добавьте платформу или партнёра в базу, найдите программу и подготовьте заявку."
                    />
                  )}
                </section>
              )}
              {section === "outreach" && (
                <>
                  <div className="outreach-summary">
                    <span>
                      <i
                        className={`dot ${data.connections.smtp ? "green" : ""}`}
                      />
                      Porkbun SMTP:{" "}
                      {data.connections.smtp
                        ? "настроен, соединение проверяется при ручной отправке"
                        : "не подключено"}
                    </span>
                    <span>
                      Ответы IMAP:{" "}
                      {data.connections.imap ? "настроено" : "не подключено"}
                      {mailboxIntegration?.last_success_at
                        ? ` · проверка ${dateTime(mailboxIntegration.last_success_at)}`
                        : " · успешной проверки ещё нет"}
                    </span>
                    <span>Follow-up: один, через 7+ дней</span>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Входящие ответы</h2>
                        <p className="muted">
                          Ответы на отправленные письма добавляются через IMAP.
                          Позитивный ответ или отказ отметьте в карточке письма.
                          {" "}Проверка выполняется каждые 5 минут, пока открыта
                          эта страница, и ежедневно в 06:00 UTC.
                        </p>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy || !data.connections.imap}
                        onClick={() => invoke("mailbox.sync", { force: true })}
                      >
                        <RefreshCw size={16} />
                        Проверить ответы
                      </button>
                    </div>
                    <p className="muted padded">
                      {mailboxIntegration?.detail ||
                        (data.connections.imap
                          ? "Настройки сохранены. Первую успешную проверку покажем здесь."
                          : "Подключите корпоративный ящик в настройках сервера.")}
                    </p>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        Очередь обращений{" "}
                        <span className="count">{messages.length}</span>
                      </h2>
                    </div>
                    {messages.length ? (
                      <div className="message-list">
                        {messages.map((m) => (
                          <button
                            className="message-row"
                            key={m.id}
                            onClick={() => open({ kind: "message", id: m.id })}
                          >
                            <span className="avatar">
                              <Mail size={18} />
                            </span>
                            <div>
                              <strong>{m.subject}</strong>
                              <small>
                                {m.organization} · {m.recipient}
                                {m.parent_id ? " · FOLLOW-UP" : ""}
                              </small>
                            </div>
                            <Badge value={m.status} />
                            <ArrowUpRight size={17} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="Здесь будут персональные обращения"
                        detail="Сначала добавьте компанию, источник и проверенный контакт. Затем подготовьте черновик."
                      />
                    )}
                  </section>
                </>
              )}
              {section === "ads" && (
                <>
                  <div className="notice">
                    Данные рекламы относятся ко всем организациям; фильтр типа
                    компании не применяется. Изменение кампаний, ставок и
                    бюджетов в приложении отключено.
                  </div>
                  <div className="metric-grid ads-metrics">
                    {[
                      [
                        "Показы",
                        data.campaigns.reduce((s, c) => s + c.impressions, 0),
                      ],
                      [
                        "Клики",
                        data.campaigns.reduce((s, c) => s + c.clicks, 0),
                      ],
                      [
                        "CTR",
                        (() => {
                          const impressions = data.campaigns.reduce(
                            (s, c) => s + c.impressions,
                            0,
                          );
                          return impressions
                            ? `${((100 * data.campaigns.reduce((s, c) => s + c.clicks, 0)) / impressions).toFixed(2)}%`
                            : "—";
                        })(),
                      ],
                      [
                        "Конверсии",
                        data.campaigns.reduce((s, c) => s + c.conversions, 0),
                      ],
                    ].map(([label, value]) => (
                      <div className="metric" key={label}>
                        <span>{label}</span>
                        <strong>{data.campaigns.length ? value : "—"}</strong>
                        <small>
                          {data.campaigns.length
                            ? "Из импортированных данных"
                            : "Данные не импортированы"}
                        </small>
                      </div>
                    ))}
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Кампании и аккаунты</h2>
                      <External href="/google-ads-script.js">
                        Скачать Ads Script
                      </External>
                    </div>
                    {data.campaigns.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Кампания / аккаунт</th>
                              <th>Источник</th>
                              <th>Показы</th>
                              <th>Клики / CTR</th>
                              <th>Стоимость</th>
                              <th>Конверсии</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.campaigns.map((c) => (
                              <tr
                                key={`${c.account_id}-${c.external_id}-${c.source}-${c.name}`}
                              >
                                <td>
                                  <strong>{c.name}</strong>
                                  <small>
                                    {c.account_id} · ID {c.external_id}
                                  </small>
                                </td>
                                <td>
                                  <Badge value={c.source} />
                                </td>
                                <td>{c.impressions}</td>
                                <td>
                                  {c.clicks}
                                  <small>
                                    {c.impressions
                                      ? (
                                          (100 * c.clicks) /
                                          c.impressions
                                        ).toFixed(2)
                                      : "0"}
                                    %
                                  </small>
                                </td>
                                <td>{money(c.cost, c.currency)}</td>
                                <td>{c.conversions}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title={
                          adsConnected
                            ? "Google Ads подключён, статистики пока нет"
                            : "Google Ads пока не подключён"
                        }
                        detail={
                          adsConnected
                            ? "В выбранном периоде нет статистики кампаний. Соединение подтверждено; скрипт читает семь завершённых дней без текущего дня."
                            : "Загрузите ежедневную статистику из CSV или настройте приём данных из Google Ads Scripts."
                        }
                      >
                        <button
                          className="secondary"
                          onClick={() => open({ kind: "import" })}
                        >
                          Импортировать CSV
                        </button>
                      </Empty>
                    )}
                  </section>
                  <section className="panel info-panel">
                    <h2>Два проверяемых пути к данным</h2>
                    <p>
                      CSV: один ряд на кампанию и дату, повторный импорт
                      обновляет существующий ряд. Формат и заголовки приведены в
                      шаблоне.
                    </p>
                    <p>
                      Scripts: установите read-only скрипт в своём аккаунте
                      Google Ads, задайте URL приложения и отдельный секрет
                      ADS_INGEST_SECRET, затем подтвердите авторизацию Google и
                      запустите скрипт.
                    </p>
                    <External href="/ads-template.csv">Шаблон CSV</External>
                  </section>
                </>
              )}
              {section === "spend" && (
                <>
                  <div className="notice">
                    Расходы показаны по всем организациям за выбранный период.
                    Валюты не конвертируются; суммы из Ads и дополнительные
                    ручные расходы учитываются отдельно.
                  </div>
                  <div className="spend-cards">
                    {data.totals.map((t) => (
                      <div className="metric" key={`${t.currency}-${t.source}`}>
                        <span>
                          {t.source === "ads_data"
                            ? "Реклама · импорт Ads"
                            : t.source === "manual"
                              ? "Внесено вручную"
                              : "Подтверждено источником"}
                        </span>
                        <strong>{money(t.amount, t.currency)}</strong>
                        <small>Отдельная валюта · {t.currency}</small>
                      </div>
                    ))}
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Расходы на инструменты и площадки</h2>
                    </div>
                    {data.spend.filter((s) => s.day >= from && s.day <= to)
                      .length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Описание</th>
                              <th>Категория</th>
                              <th>Дата</th>
                              <th>Сумма</th>
                              <th>Основание</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.spend
                              .filter((s) => s.day >= from && s.day <= to)
                              .map((s) => (
                                <tr key={s.id}>
                                  <td>{s.label}</td>
                                  <td>
                                    {
                                      {
                                        tools: "Инструменты",
                                        platforms: "Площадки",
                                        advertising: "Дополнительная реклама",
                                      }[s.category]
                                    }
                                  </td>
                                  <td>{s.day}</td>
                                  <td>{money(s.amount, s.currency)}</td>
                                  <td>
                                    <Badge value={s.confirmation} />
                                    {s.evidence_url && (
                                      <External href={s.evidence_url}>
                                        Источник
                                      </External>
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="Расходы пока не внесены"
                        detail="Добавляйте фактические затраты. Импортированная реклама учитывается автоматически."
                      />
                    )}
                  </section>
                  <p className="muted fine">
                    Стоимость привлечения: недоступна без подтверждённой
                    атрибуции расходов к заказам.
                  </p>
                </>
              )}
              {section === "tasks" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      Открытые действия{" "}
                      <span className="count">{openTasks.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => invoke("jobs.run", {})}
                    >
                      <RefreshCw size={15} />
                      Запустить безопасные проверки
                    </button>
                  </div>
                  {taskList()}
                  <details className="history-details">
                    <summary>Завершённые и отменённые задачи</summary>
                    {data.tasks
                      .filter((t) => t.status !== "open")
                      .map((t) => (
                        <div className="mini-row" key={t.id}>
                          <span>{t.title}</span>
                          <Badge value={t.status} />
                        </div>
                      ))}
                  </details>
                </section>
              )}
              {section === "reports" && (
                <>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Еженедельная активность</h2>
                      <span className="muted fine">Даты недель · UTC</span>
                    </div>
                    {data.weekly.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Неделя с</th>
                              <th>Письма</th>
                              <th>Ответы</th>
                              <th>Переговоры</th>
                              <th>Предложения</th>
                              <th>Заказы</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.weekly.map((w) => (
                              <tr key={w.week}>
                                <td>{w.week}</td>
                                <td>{w.sent}</td>
                                <td>{w.replies}</td>
                                <td>{w.negotiations}</td>
                                <td>{w.proposals}</td>
                                <td>{w.won}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="Первые результаты появятся здесь"
                        detail="Отчёт использует фактические отправки, ответы и стадии переговоров."
                      />
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Лиды и переговоры</h2>
                      <button
                        className="secondary"
                        onClick={() => open({ kind: "opportunity" })}
                      >
                        <Plus size={16} />
                        Добавить возможность
                      </button>
                    </div>
                    {opportunities.length ? (
                      <div className="card-grid">
                        {opportunities.map((o) => (
                          <button
                            key={o.id}
                            className="record-card"
                            onClick={() =>
                              open({ kind: "opportunity-detail", id: o.id })
                            }
                          >
                            <div>
                              <strong>{o.organization}</strong>
                              <Badge value={o.stage} />
                            </div>
                            <p>{o.notes}</p>
                            {o.value && (
                              <span>{money(o.value, o.currency)}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="Пока нет квалифицированных возможностей"
                        detail="Фиксируйте фактический интерес, разговоры, предложения и заказы вместе с контекстом."
                      />
                    )}
                  </section>
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Кому написали</h2>
                      </div>
                      {sentInPeriod.map((m) => (
                        <div className="mini-row" key={m.id}>
                          <div>
                            <strong>{m.organization}</strong>
                            <p>{m.recipient}</p>
                          </div>
                          <span>{dateTime(m.sent_at)}</span>
                        </div>
                      ))}
                      {sentInPeriod.length === 0 && (
                        <p className="muted padded">
                          За период нет подтверждённых SMTP отправок.
                        </p>
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Ответы компаний</h2>
                      </div>
                      {data.events
                        .filter(
                          (e) =>
                            ["reply", "positive_reply", "opt_out"].includes(
                              e.kind,
                            ) &&
                            period(e.created_at) &&
                            data.messages.some(
                              (m) =>
                                m.id === e.message_id &&
                                inOrg(m.organization_id),
                            ),
                        )
                        .map((e) => (
                          <div className="mini-row" key={e.id}>
                            <div>
                              <strong>
                                {
                                  data.messages.find(
                                    (m) => m.id === e.message_id,
                                  )?.organization
                                }
                              </strong>
                              <p>{e.detail}</p>
                            </div>
                            <Badge value={e.kind} />
                          </div>
                        ))}
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Еженедельные расходы · все организации</h2>
                    </div>
                    {data.weeklySpend.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Неделя с</th>
                              <th>Валюта</th>
                              <th>Фактический расход</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.weeklySpend.map((w) => (
                              <tr key={`${w.week}-${w.currency}`}>
                                <td>{w.week}</td>
                                <td>{w.currency}</td>
                                <td>{money(w.amount, w.currency)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="muted padded">
                        Расходы за период не внесены.
                      </p>
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Сохранённые еженедельные отчёты</h2>
                      <span className="muted fine">
                        Cron · завершённые недели · все компании
                      </span>
                    </div>
                    {data.reports.length ? (
                      data.reports.map((r) => (
                        <details className="history-details" key={r.week}>
                          <summary>
                            Неделя с {r.week} · обновлено{" "}
                            {dateTime(r.generated_at)}
                          </summary>
                          <p>
                            Письма: {r.report.sent.length}. Ответы:{" "}
                            {r.report.replies.length}. События переговоров:{" "}
                            {r.report.opportunities.length}.
                          </p>
                          {r.report.sent.map((m, i) => (
                            <p key={i}>
                              {m.organization} → {m.recipient}: {m.subject}
                            </p>
                          ))}
                          {r.report.replies.map((e, i) => (
                            <p key={i}>
                              {e.organization}: {e.kind} · {e.detail}
                            </p>
                          ))}
                          {r.report.opportunities.map((o, i) => (
                            <p key={i}>
                              {o.organization}: {statuses[o.stage]} · {o.notes}
                            </p>
                          ))}
                          {r.report.spend.map((s) => (
                            <p key={s.currency}>
                              {money(s.amount, s.currency)}
                            </p>
                          ))}
                        </details>
                      ))
                    ) : (
                      <p className="muted padded">
                        Сохранённые отчёты появятся после первого безопасного
                        фонового запуска.
                      </p>
                    )}
                  </section>
                  <p className="muted">
                    Отчёт скачивается в Markdown и включает действия, расходы и
                    контекст переговоров. Прямая атрибуция заказов к рекламе не
                    настроена.
                  </p>
                </>
              )}
              {section === "integrations" && (
                <>
                  <div className="card-grid integrations-grid">
                    {[
                      {
                        key: "database",
                        name: "PostgreSQL",
                        text: "Рабочие записи, миграции, блокировки отправки и журнал.",
                      },
                      {
                        key: "smtp",
                        name: "Porkbun SMTP",
                        text: "SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, OUTREACH_FOOTER. Наличие конфигурации не подтверждает соединение.",
                      },
                      {
                        key: "imap",
                        name: "Ответы · IMAP",
                        text: "Входящие ответы на отправленные письма связываются по заголовкам переписки и адресу отправителя. IMAP_HOST, IMAP_PORT, IMAP_MAILBOX; учётные данные — корпоративного ящика. Позитивный ответ и отказ отмечаются вручную.",
                      },
                      {
                        key: "search",
                        name: "Публичный поиск",
                        text: "Brave Search API: BRAVE_SEARCH_API_KEY. Без ключа доступны публичные поисковые ссылки и ручное добавление.",
                      },
                      {
                        key: "research",
                        name: "Исследования ChatGPT",
                        text: "GitHub inbox приложения, импорт JSON и HTTPS-приёмник /api/research/ingest. Настройки и успешные импорты учитываются отдельно.",
                      },
                      {
                        key: "adsScripts",
                        name: "Google Ads Scripts",
                        text: "Приёмник /api/ads/ingest, отдельный ADS_INGEST_SECRET и read-only скрипт. Подтверждённый обмен отображается ниже.",
                      },
                      {
                        key: "cron",
                        name: "Vercel Cron",
                        text: "CRON_SECRET. Ежедневная проверка в 06:00 UTC. Ответы IMAP, проверка источников, оповещения и журнал; внешние отправки исключены.",
                      },
                    ].map((i) => (
                      <div className="integration-card" key={i.key}>
                        <div>
                          <Plug size={21} />
                          <span
                            className={`connection-badge ${data.connections[i.key] ? "connected" : ""}`}
                          >
                            {data.connections[i.key]
                              ? "Настроено"
                              : "Не подключено"}
                          </span>
                        </div>
                        <h3>{i.name}</h3>
                        <p>{i.text}</p>
                        {i.key === "imap" && (
                          <>
                            <p>
                              Последняя успешная проверка:{" "}
                              {mailboxIntegration?.last_success_at
                                ? dateTime(mailboxIntegration.last_success_at)
                                : "ещё не выполнена"}
                            </p>
                            {mailboxIntegration?.detail && (
                              <p>{mailboxIntegration.detail}</p>
                            )}
                            <button
                              className="secondary"
                              disabled={busy || !data.connections.imap}
                              onClick={() => invoke("mailbox.sync", { force: true })}
                            >
                              <RefreshCw size={16} />
                              Проверить ответы
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Фактические импорты и синхронизации</h2>
                    </div>
                    {data.integrations.length ? (
                      data.integrations.map((i) => (
                        <div className="mini-row" key={i.name}>
                          <div>
                            <strong>
                              {i.name === "porkbun_imap"
                                ? "Ответы · Porkbun IMAP"
                                : i.name}
                            </strong>
                            <p>{i.detail}</p>
                          </div>
                          <span>{dateTime(i.last_success_at)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="muted padded">
                        Успешных внешних синхронизаций пока нет.
                      </p>
                    )}
                  </section>
                  <section className="panel info-panel">
                    <h2>Контроль расходов и запуск</h2>
                    <p>
                      Дневные пороги задаются серверной переменной DAILY_BUDGETS
                      по валютам. Текущие пороги:{" "}
                      {Object.keys(data.budgets).length
                        ? Object.entries(data.budgets)
                            .map(([c, v]) => money(v, c))
                            .join(" · ")
                        : "не заданы"}
                      .
                    </p>
                    <p>
                      Оповещения появляются в следующих действиях при ежедневном
                      Cron или ручном запуске проверок. Рекламные бюджеты в
                      Google Ads не изменяются.
                    </p>
                    <p>
                      Секреты настраиваются в окружении сервера. В этой панели
                      они не отображаются и не редактируются.
                    </p>
                  </section>
                </>
              )}
              {section === "activity" && (
                <>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        Последние действия{" "}
                        <span className="count">{data.activity.length}</span>
                      </h2>
                    </div>
                    {data.activity.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Время</th>
                              <th>Действие</th>
                              <th>Оператор</th>
                              <th>Контекст</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.activity.map((a) => (
                              <tr key={a.id}>
                                <td>{dateTime(a.created_at)}</td>
                                <td>
                                  <code>{a.action}</code>
                                </td>
                                <td>{a.actor}</td>
                                <td>
                                  <small>{JSON.stringify(a.detail)}</small>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="Журнал пока пуст"
                        detail="Изменения записей и операции будут записываться здесь."
                      />
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Фоновые проверки</h2>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => invoke("jobs.run", {})}
                      >
                        Запустить вручную
                      </button>
                    </div>
                    {data.jobs.map((j) => (
                      <div className="mini-row" key={j.id}>
                        <div>
                          <strong>{j.job_key}</strong>
                          <p>
                            {dateTime(j.started_at)}
                            {j.error ? ` · ${j.error}` : ""}
                          </p>
                          <small>{JSON.stringify(j.result)}</small>
                        </div>
                        <Badge value={j.status} />
                      </div>
                    ))}
                  </section>
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>SHEDKO ADVISORY · MARKETING OPERATIONS</span>
            <span>Источники → контакты → диалог → сделка</span>
          </footer>
        </div>
      </main>
      {modal && data && (
        <Modal
          title={modalTitles[modal.kind] || "Запись"}
          onClose={() => setModal(null)}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          {modal.kind === "research-import" ? (
            <ResearchJsonForm
              busy={busy}
              submit={(json) => invoke("research.import", { json })}
            />
          ) : modal.kind === "import" ? (
            <CsvImportForm busy={busy} invoke={invoke} />
          ) : (
            <Forms
              modal={modal}
              data={data}
              invoke={invoke}
              open={open}
              busy={busy}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
function CsvImportForm({
  busy,
  invoke,
}: {
  busy: boolean;
  invoke: (action: string, data: unknown) => Promise<unknown>;
}) {
  const [csv, setCsv] = useState("");
  const [fileError, setFileError] = useState("");
  return (
    <Form
      busy={busy}
      submit="Импортировать статистику"
      onSubmit={() => invoke("ads.import", { csv })}
    >
      <p className="notice wide">
        UTF-8 CSV. Заголовки: account_id, campaign_id, campaign, date, currency,
        impressions, clicks, cost, conversions. Дата YYYY-MM-DD, десятичная
        точка. До 2000 строк и 1 МБ.
      </p>
      <label className="wide">
        Загрузить CSV
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            setFileError("");
            if (!file) return;
            if (file.size > 1_000_000) {
              setFileError("Файл превышает 1 МБ");
              return;
            }
            setCsv(await file.text());
          }}
        />
      </label>
      <label className="wide">
        Содержимое CSV
        <textarea
          name="csv"
          required
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={8}
        />
      </label>
      {fileError && <p className="error wide">{fileError}</p>}
      <p className="muted wide">Импорт не меняет активную рекламу.</p>
    </Form>
  );
}
