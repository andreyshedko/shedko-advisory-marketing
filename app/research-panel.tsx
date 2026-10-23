"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Upload, ArrowUpRight } from "lucide-react";
import type { DashboardData } from "@/lib/types";
import { dateTime, External, Badge, Form } from "./ui";
export function ResearchPanel({
  data,
  busy,
  sync,
  importJson,
  openOrganization,
  onSynced,
}: {
  data: DashboardData;
  busy: boolean;
  sync: () => void;
  importJson: () => void;
  openOrganization: (id: string) => void;
  onSynced: () => Promise<void>;
}) {
  useEffect(() => {
    if (!data.connections.researchGithub) return;
    const controller = new AbortController();
    const poll = () => {
      fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "research.sync",
          data: { force: false },
        }),
        signal: controller.signal,
      })
        .then(async (r) => {
          if (r.ok) {
            const result = await r.json();
            if (!result.skipped) await onSynced();
          }
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [data.connections.researchGithub, onSynced]);
  const latest = data.integrations.find((i) => i.name === "research_github");
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ОБЛАЧНЫЙ ПОИСК CHATGPT</span>
          <h2>Полученные исследования</h2>
        </div>
        <div className="button-row">
          <button className="secondary" onClick={importJson}>
            <Upload size={15} />
            Импорт JSON
          </button>
          <button
            className="secondary"
            disabled={busy || !data.connections.researchGithub}
            onClick={sync}
          >
            <RefreshCw size={15} />
            Синхронизировать
          </button>
        </div>
      </div>
      <p className="muted padded">
        {data.connections.researchGithub
          ? "GitHub inbox приложения настроен. Пока панель открыта, проверка выполняется автоматически; новые записи требуют проверки оператором."
          : "Облачные результаты можно загрузить из JSON. Для синхронизации GitHub inbox приложения настройте серверный доступ."}
        {latest &&
          ` Последняя успешная синхронизация: ${dateTime(latest.last_success_at)}.`}
      </p>
      {latest?.status === "error" && (
        <p className="error padded">
          Синхронизация не удалась. Проверьте доступ к репозиторию приложения и
          формат JSON.
        </p>
      )}
      {data.researchRuns.map((run) => (
        <details key={run.id} className="history-details">
          <summary>
            {dateTime(run.received_at)} · {run.producer} · новых{" "}
            {run.created_count}, совпадений {run.matched_count}, конфликтов{" "}
            {run.conflict_count}
          </summary>
          <p>{run.query}</p>
          <p className="muted">
            Run ID: {run.run_key} · Канал: {run.transport} · Исследование:{" "}
            {dateTime(run.researched_at)}
          </p>
          {data.researchRecords
            .filter((r) => r.run_id === run.id)
            .map((record) => (
              <div className="mini-row" key={record.id}>
                <div>
                  <strong>{record.candidate.name}</strong>
                  <p>{record.candidate.relevance}</p>
                  {record.candidate.sources.map((source) => (
                    <div key={source.url}>
                      <External href={source.url}>Источник</External>
                      <p>{source.note}</p>
                    </div>
                  ))}
                  {record.organization_id && (
                    <button
                      className="text-button"
                      onClick={() => openOrganization(record.organization_id!)}
                    >
                      Открыть компанию
                      <ArrowUpRight size={14} />
                    </button>
                  )}
                  {record.outcome === "conflict" && (
                    <p className="error">
                      Имя или домен совпали неоднозначно. Проверьте запись
                      вручную; существующая компания не изменена.
                    </p>
                  )}
                </div>
                <Badge
                  value={
                    record.outcome === "conflict" ? "review" : "unverified"
                  }
                />
              </div>
            ))}
        </details>
      ))}
      {!data.researchRuns.length && (
        <p className="muted padded">
          Исследования пока не импортированы. Наличие настроек не означает
          успешной передачи данных.
        </p>
      )}
    </section>
  );
}
export function ResearchJsonForm({
  busy,
  submit,
}: {
  busy: boolean;
  submit: (json: string) => Promise<unknown>;
}) {
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  return (
    <Form
      busy={busy}
      submit="Импортировать результаты"
      onSubmit={() => submit(json)}
    >
      <p className="notice wide">
        JSON версии 1, до 50 компаний и 1 МБ. Каждая компания должна содержать
        публичный источник. Записи импортируются как непроверенные, повторная
        загрузка того же runId не создаёт дублей.
      </p>
      <label className="wide">
        Файл результатов
        <input
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            setError("");
            if (!f) return;
            if (f.size > 1_000_000) {
              setError("Файл превышает 1 МБ");
              return;
            }
            setJson(await f.text());
          }}
        />
      </label>
      <label className="wide">
        Результаты ChatGPT
        <textarea
          rows={12}
          required
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />
      </label>
      {error && <p className="error wide">{error}</p>}
      <p className="muted wide">
        Утверждение контактов, письма и заявки выполняются отдельно.
      </p>
    </Form>
  );
}
