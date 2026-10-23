"use client";
import { useState } from "react";
import type { DashboardData, Message } from "@/lib/types";
import {
  Field,
  Area,
  Select,
  Check,
  Form,
  Badge,
  External,
  dateTime,
  kinds,
  statuses,
} from "./ui";
export type ModalState = { kind: string; id?: string };
export type Invoke = (
  action: string,
  data: unknown,
  keepOpen?: boolean,
) => Promise<unknown>;
const s = (v: FormDataEntryValue | undefined) =>
  typeof v === "string" ? v : "";
export default function Forms({
  modal,
  data,
  invoke,
  open,
  busy,
}: {
  modal: ModalState;
  data: DashboardData;
  invoke: Invoke;
  open: (state: ModalState) => void;
  busy: boolean;
}) {
  const [openedAt] = useState(() => Date.now());
  const orgOptions = Object.fromEntries(
    data.organizations.filter((o) => !o.demo).map((o) => [o.id, o.name]),
  );
  const org = data.organizations.find((o) => o.id === modal.id);
  const msg = data.messages.find((m) => m.id === modal.id);
  const partner = data.partners.find((p) => p.id === modal.id);
  const opp = data.opportunities.find((o) => o.id === modal.id);
  if (modal.kind === "organization")
    return (
      <Form
        busy={busy}
        onSubmit={(v) =>
          invoke("organization.create", {
            name: s(v.name),
            website: s(v.website),
            country: s(v.country),
            kind: s(v.kind),
            relevance: s(v.relevance),
            sourceUrl: s(v.sourceUrl),
            sourceNote: s(v.sourceNote),
            verified: v.verified === "on",
            contactChannel: s(v.contactChannel),
          })
        }
      >
        <Field label="Название компании" name="name" />
        <Field
          label="Сайт"
          name="website"
          type="url"
          placeholder="https://company.com"
        />
        <Select label="Тип организации" name="kind" options={kinds} />
        <Field
          label="Страна / регион"
          name="country"
          placeholder="United Kingdom"
        />
        <Area
          label="Почему компания релевантна"
          name="relevance"
          placeholder="Укажите подтверждённую связь с технологическими сделками и due diligence."
        />
        <Field wide label="URL источника" name="sourceUrl" type="url" />
        <Area label="Что подтверждает источник" name="sourceNote" />
        <Field
          wide
          label="Публичный контактный канал"
          name="contactChannel"
          required={false}
        />
        <Check name="verified">
          Я открыл источник и проверил сведения. Иначе запись сохранится как
          непроверенная.
        </Check>
      </Form>
    );
  if (modal.kind === "org-detail" && org)
    return (
      <>
        <div className="profile-head">
          <div className="avatar">{org.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <h3>{org.name}</h3>
            <External href={org.website}>{org.domain}</External>
          </div>
          <Badge value={org.status} />
        </div>
        <p>{org.relevance}</p>
        <p className="muted">
          {kinds[org.kind]} · {org.country} · Проверка:{" "}
          {dateTime(org.verified_at)}
          {org.demo ? " · DEMO" : ""}
        </p>
        <h3>Источники</h3>
        {data.evidence
          .filter((e) => e.organization_id === org.id)
          .map((e) => (
            <div className="mini-row" key={e.id}>
              <div>
                <External href={e.url}>Открыть источник</External>
                <p>{e.note}</p>
              </div>
              <Badge value={e.checked_at ? "researched" : "unverified"} />
            </div>
          ))}
        <button
          className="secondary"
          onClick={() => open({ kind: "evidence", id: org.id })}
        >
          Добавить источник
        </button>
        <h3>Контакты</h3>
        {data.contacts
          .filter((c) => c.organization_id === org.id)
          .map((c) => (
            <div className="mini-row" key={c.id}>
              <div>
                <strong>{c.name || "Контакт компании"}</strong>
                <p>
                  {c.email} · {c.role || "Роль не указана"}
                </p>
                <External href={c.evidence_url}>Источник контакта</External>
              </div>
              <Badge
                value={c.do_not_contact ? "do_not_contact" : "researched"}
              />
            </div>
          ))}
        <div className="button-row">
          <button
            className="secondary"
            onClick={() => open({ kind: "contact", id: org.id })}
          >
            Добавить контакт
          </button>
          <button
            className="secondary"
            onClick={() => open({ kind: "draft", id: org.id })}
          >
            Подготовить письмо
          </button>
          <button
            className="secondary"
            onClick={() => open({ kind: "partner", id: org.id })}
          >
            Партнёрская заявка
          </button>
        </div>
        <hr />
        <Form
          busy={busy}
          submit="Обновить компанию"
          onSubmit={(v) =>
            invoke("organization.update", {
              id: org.id,
              status: s(v.status),
              nextAction: s(v.nextAction),
            })
          }
        >
          <Select
            label="Статус"
            name="status"
            options={Object.fromEntries(
              [
                "discovered",
                "researched",
                "qualified",
                "contacted",
                "replied",
                "do_not_contact",
              ].map((k) => [k, statuses[k]]),
            )}
            defaultValue={org.status}
          />
          <Field
            label="Следующее действие"
            name="nextAction"
            defaultValue={org.next_action || ""}
            required={false}
          />
        </Form>
      </>
    );
  if (modal.kind === "contact")
    return (
      <Form
        busy={busy}
        onSubmit={(v) =>
          invoke("contact.create", {
            organizationId: s(v.organizationId),
            name: s(v.name),
            role: s(v.role),
            email: s(v.email),
            evidenceUrl: s(v.evidenceUrl),
            verified: v.verified === "on",
          })
        }
      >
        <Select
          label="Компания"
          name="organizationId"
          options={orgOptions}
          defaultValue={modal.id}
        />
        <Field
          label="Публичный корпоративный email"
          name="email"
          type="email"
        />
        <Field label="Имя" name="name" required={false} />
        <Field label="Роль" name="role" required={false} />
        <Field
          wide
          label="Публичный источник контакта"
          name="evidenceUrl"
          type="url"
        />
        <Check name="verified" required>
          Контакт опубликован в указанном источнике; я проверил адрес и
          допустимость делового обращения.
        </Check>
      </Form>
    );
  if (modal.kind === "evidence")
    return (
      <Form
        busy={busy}
        onSubmit={(v) =>
          invoke("evidence.create", {
            organizationId: modal.id,
            url: s(v.url),
            note: s(v.note),
            verified: v.verified === "on",
          })
        }
      >
        <Field wide label="URL источника" name="url" type="url" />
        <Area label="Подтверждаемые сведения" name="note" />
        <Check name="verified">Источник открыт и проверен мной.</Check>
      </Form>
    );
  if (modal.kind === "draft") {
    const contacts = data.contacts.filter(
      (c) => !c.do_not_contact && (!modal.id || c.organization_id === modal.id),
    );
    return (
      <>
        <p className="notice">
          Черновик использует сохранённую причину релевантности. Проверьте
          формулировки перед утверждением.
        </p>
        <Form
          busy={busy}
          submit="Создать черновик"
          onSubmit={(v) => {
            const c = data.contacts.find((c) => c.id === s(v.contactId));
            return invoke("message.draft", {
              organizationId: c?.organization_id,
              contactId: s(v.contactId),
              ...(s(v.subject) ? { subject: s(v.subject) } : {}),
              ...(s(v.body) ? { body: s(v.body) } : {}),
            });
          }}
        >
          <Select
            label="Проверенный контакт"
            name="contactId"
            options={Object.fromEntries(
              contacts.map((c) => [
                c.id,
                `${data.organizations.find((o) => o.id === c.organization_id)?.name} · ${c.email}`,
              ]),
            )}
          />
          <Field
            label="Тема (или автоматический черновик)"
            name="subject"
            required={false}
          />
          <Area label="Текст (необязательно)" name="body" required={false} />
        </Form>
        {!contacts.length && (
          <p>Сначала добавьте проверенный контакт в карточке компании.</p>
        )}
      </>
    );
  }
  if (modal.kind === "message" && msg)
    return (
      <MessageDialog
        key={`${msg.id}-${msg.status}-${msg.revision}`}
        msg={msg}
        data={data}
        invoke={invoke}
        open={open}
        busy={busy}
      />
    );
  if (modal.kind === "reply" && msg)
    return (
      <Form
        busy={busy}
        submit="Записать ответ"
        onSubmit={(v) =>
          invoke("message.reply", {
            id: msg.id,
            kind: s(v.kind),
            detail: s(v.detail),
          })
        }
      >
        <p className="notice wide">
          IMAP не подключён. Внесите фактический ответ вручную. Отказ блокирует
          дальнейшие обращения компании и этому адресу.
        </p>
        <Select
          label="Тип ответа"
          name="kind"
          options={{
            reply: "Ответ",
            positive_reply: "Позитивный ответ",
            opt_out: "Отказ от дальнейших сообщений",
          }}
        />
        <Area label="Содержание / заметка об ответе" name="detail" />
      </Form>
    );
  if (modal.kind === "followup" && msg)
    return (
      <Form
        busy={busy}
        submit="Назначить задачу"
        onSubmit={(v) =>
          invoke("message.followup", {
            id: msg.id,
            dueAt: new Date(s(v.dueAt)).toISOString(),
          })
        }
      >
        <p className="notice wide">
          Не раньше семи дней после письма. Задача не отправляет письмо. После
          ответа follow-up отменяется.
        </p>
        <Field
          label="Дата и время"
          name="dueAt"
          type="datetime-local"
          defaultValue={new Date(
            Math.max(
              openedAt + 86400000,
              new Date(msg.sent_at || openedAt).getTime() + 8 * 86400000,
            ),
          )
            .toISOString()
            .slice(0, 16)}
        />
      </Form>
    );
  if (modal.kind === "followup-draft" && msg)
    return (
      <Form
        busy={busy}
        submit="Создать один follow-up"
        onSubmit={(v) =>
          invoke("message.draft", {
            organizationId: msg.organization_id,
            contactId: msg.contact_id,
            parentId: msg.id,
            subject: s(v.subject),
            body: s(v.body),
          })
        }
      >
        <Field
          wide
          label="Тема"
          name="subject"
          defaultValue={`Re: ${msg.subject}`}
        />
        <Area
          label="Текст follow-up"
          name="body"
          defaultValue={`Hello,\n\nA brief follow-up on my note about independent technical due diligence support for ${msg.organization}. If this is relevant, would a short conversation be useful?\n\nIf not, no further follow-up is planned.\n\nShedko Advisory\nhttps://shedkoadvisory.com`}
        />
        <Check name="reviewed" required>
          Сообщение остаётся уместным. Я проверил отсутствие ответа или отказа.
        </Check>
      </Form>
    );
  if (modal.kind === "resolve" && msg)
    return (
      <Form
        busy={busy}
        submit="Зафиксировать проверенный результат"
        onSubmit={(v) =>
          invoke("message.resolve", {
            id: msg.id,
            delivered: s(v.result) === "delivered",
            note: s(v.note),
          })
        }
      >
        <Select
          label="Результат проверки корпоративного ящика"
          name="result"
          options={{
            delivered: "Подтверждена отправка",
            cancelled: "Отменить попытку; повторно не отправлять",
          }}
        />
        <Area label="Основание и результат проверки" name="note" />
      </Form>
    );
  if (modal.kind === "partner")
    return (
      <Form
        busy={busy}
        submit="Подготовить заявку"
        onSubmit={(v) =>
          invoke("partner.create", {
            organizationId: s(v.organizationId),
            url: s(v.url),
            channel: s(v.channel),
            materials: s(v.materials),
            ...(s(v.terms) ? { terms: s(v.terms) } : {}),
            ...(s(v.termsUrl) ? { termsUrl: s(v.termsUrl) } : {}),
          })
        }
      >
        <Select
          label="Платформа / партнёр"
          name="organizationId"
          options={orgOptions}
          defaultValue={modal.id}
        />
        <Select
          label="Канал"
          name="channel"
          options={{
            directory: "Каталог",
            application: "Заявка",
            contact_form: "Контактная форма",
            partner_program: "Партнёрская программа",
          }}
        />
        <Field wide label="URL программы или формы" name="url" type="url" />
        <Area
          label="Необходимые материалы"
          name="materials"
          defaultValue="Описание практики, профиль основателя, перечень услуг, контакты, логотип. Уточнить требования по источнику."
        />
        <Area
          label="Подтверждённые условия участия (необязательно)"
          name="terms"
          required={false}
        />
        <Field
          wide
          label="Источник условий участия"
          name="termsUrl"
          type="url"
          required={false}
        />
      </Form>
    );
  if (modal.kind === "partner-detail" && partner)
    return (
      <>
        <div className="mini-row">
          <strong>{partner.organization}</strong>
          <Badge value={partner.status} />
        </div>
        <External href={partner.url}>Открыть форму / программу</External>
        <h3>Материалы</h3>
        <p className="preserve">{partner.materials}</p>
        <h3>Условия</h3>
        <p>{partner.terms || "Условия не подтверждены."}</p>
        {partner.terms_evidence_url && (
          <External href={partner.terms_evidence_url}>
            Источник условий
          </External>
        )}
        <Form
          busy={busy}
          submit="Сохранить заявку"
          onSubmit={(v) =>
            invoke("partner.update", {
              id: partner.id,
              draft: s(v.draft),
              status: s(v.status),
              confirmed: v.confirmed === "on",
            })
          }
        >
          <Area
            label="Персонализированный текст"
            name="draft"
            defaultValue={partner.draft}
          />
          <Select
            label="Статус"
            name="status"
            defaultValue={partner.status}
            options={Object.fromEntries(
              [
                "discovered",
                "researched",
                "draft",
                "review",
                "submitted",
                "replied",
                "accepted",
                "rejected",
              ].map((k) => [k, statuses[k]]),
            )}
          />
          <Check name="confirmed">
            Я лично подал проверенную заявку. Этот флажок нужен при переходе из
            «На проверке» в «Подано вручную».
          </Check>
          <p className="muted wide">
            Форма подачи открывается по ссылке. Автоматическая отправка и
            платная регистрация не выполняются.
          </p>
        </Form>
      </>
    );
  if (modal.kind === "spend")
    return (
      <Form
        busy={busy}
        onSubmit={(v) =>
          invoke("spend.create", {
            category: s(v.category),
            label: s(v.label),
            amount: Number(v.amount),
            currency: s(v.currency),
            day: s(v.day),
            confirmation: s(v.confirmation),
            ...(s(v.evidenceUrl) ? { evidenceUrl: s(v.evidenceUrl) } : {}),
          })
        }
      >
        <Field label="Описание" name="label" />
        <Select
          label="Категория"
          name="category"
          options={{
            tools: "Инструменты",
            platforms: "Площадки",
            advertising: "Дополнительная реклама",
          }}
        />
        <Field label="Сумма" name="amount" type="number" />
        <Field label="Валюта ISO" name="currency" defaultValue="USD" />
        <Field
          label="Дата расхода"
          name="day"
          type="date"
          defaultValue={new Date().toISOString().slice(0, 10)}
        />
        <Select
          label="Основание"
          name="confirmation"
          options={{
            manual: "Внесено вручную",
            confirmed: "Подтверждено источником",
          }}
          defaultValue="manual"
        />
        <Field
          wide
          label="URL подтверждения"
          name="evidenceUrl"
          type="url"
          required={false}
        />
        <p className="notice wide">
          Расходы Ads уже учитываются из импорта. Не вносите их повторно. Валюты
          учитываются отдельно.
        </p>
      </Form>
    );
  if (modal.kind === "opportunity")
    return (
      <Form
        busy={busy}
        onSubmit={(v) =>
          invoke("opportunity.create", {
            organizationId: s(v.organizationId),
            stage: s(v.stage),
            notes: s(v.notes),
            ...(s(v.value) ? { value: Number(v.value) } : {}),
            currency: s(v.currency),
          })
        }
      >
        <Select
          label="Компания"
          name="organizationId"
          options={orgOptions}
          defaultValue={modal.id}
        />
        <Select
          label="Стадия"
          name="stage"
          options={Object.fromEntries(
            ["qualified", "negotiation", "proposal", "won", "lost"].map((k) => [
              k,
              statuses[k],
            ]),
          )}
        />
        <Area label="Факты, контекст и результат разговора" name="notes" />
        <Field
          label="Сумма (если известна)"
          name="value"
          type="number"
          required={false}
        />
        <Field label="Валюта" name="currency" defaultValue="USD" />
      </Form>
    );
  if (modal.kind === "opportunity-detail" && opp)
    return (
      <Form
        busy={busy}
        submit="Обновить переговоры"
        onSubmit={(v) =>
          invoke("opportunity.update", {
            id: opp.id,
            stage: s(v.stage),
            notes: s(v.notes),
          })
        }
      >
        <Select
          label="Стадия"
          name="stage"
          defaultValue={opp.stage}
          options={Object.fromEntries(
            ["qualified", "negotiation", "proposal", "won", "lost"].map((k) => [
              k,
              statuses[k],
            ]),
          )}
        />
        <Area label="Заметки" name="notes" defaultValue={opp.notes} />
      </Form>
    );
  if (modal.kind === "task")
    return (
      <Form
        busy={busy}
        onSubmit={(v) =>
          invoke("task.create", {
            title: s(v.title),
            dueAt: new Date(s(v.dueAt)).toISOString(),
            ...(s(v.organizationId)
              ? { organizationId: s(v.organizationId) }
              : {}),
          })
        }
      >
        <Field wide label="Следующее действие" name="title" />
        <Select
          label="Компания (необязательно)"
          name="organizationId"
          options={orgOptions}
          required={false}
        />
        <Field label="Срок" name="dueAt" type="datetime-local" />
      </Form>
    );
  return <p>Запись не найдена.</p>;
}

function MessageDialog({
  msg,
  data,
  invoke,
  open,
  busy,
}: {
  msg: Message;
  data: DashboardData;
  invoke: Invoke;
  open: (value: ModalState) => void;
  busy: boolean;
}) {
  const [dirty, setDirty] = useState(false);
  return (
    <>
      <div className="mini-row">
        <div>
          <strong>{msg.organization}</strong>
          <p>{msg.recipient}</p>
        </div>
        <Badge value={msg.status} />
      </div>
      {msg.last_error && <p className="notice warning">{msg.last_error}</p>}
      {["draft", "approved"].includes(msg.status) ? (
        <Form
          busy={busy}
          onChange={() => setDirty(true)}
          submit="Сохранить текст · сбросить утверждение"
          onSubmit={async (v) => {
            if (
              (await invoke(
                "message.edit",
                { id: msg.id, subject: s(v.subject), body: s(v.body) },
                true,
              )) === true
            )
              setDirty(false);
          }}
        >
          <Field wide label="Тема" name="subject" defaultValue={msg.subject} />
          <Area label="Содержание" name="body" defaultValue={msg.body} />
        </Form>
      ) : (
        <>
          <h3>{msg.subject}</h3>
          <pre className="message-body">{msg.body}</pre>
        </>
      )}
      {msg.status === "draft" && (
        <Form
          busy={busy}
          disabled={dirty}
          submit="Утвердить черновик"
          onSubmit={(v) =>
            invoke(
              "message.approve",
              {
                id: msg.id,
                revision: msg.revision,
                confirmed: v.confirmed === "on",
              },
              true,
            )
          }
        >
          <Check name="confirmed" required>
            Я проверил получателя, источник, точность текста, релевантность и
            допустимость обращения.
          </Check>
        </Form>
      )}
      {msg.status === "approved" && (
        <Form
          busy={busy}
          disabled={dirty || !data.connections.smtp}
          submit="Подтвердить и отправить через SMTP"
          onSubmit={(v) =>
            invoke(
              "message.send",
              {
                id: msg.id,
                revision: msg.revision,
                confirmed: v.confirmed === "on",
              },
              true,
            )
          }
        >
          <p className="notice wide">
            {data.connections.smtp
              ? "SMTP настроен. Нажатие кнопки отправит одно реальное письмо. Корпоративная подпись из OUTREACH_FOOTER будет добавлена сервером."
              : "SMTP не подключён. Отправка заблокирована до настройки корпоративного ящика и подписи."}
          </p>
          <Check name="confirmed" required>
            Отправить это утверждённое письмо на {msg.recipient} сейчас.
          </Check>
        </Form>
      )}
      {["sent", "uncertain", "sending"].includes(msg.status) && (
        <div className="button-row">
          <button
            className="secondary"
            onClick={() => open({ kind: "reply", id: msg.id })}
          >
            Внести ответ / отказ
          </button>
          {msg.status === "sent" && !msg.parent_id && (
            <button
              className="secondary"
              onClick={() => open({ kind: "followup", id: msg.id })}
            >
              Назначить follow-up
            </button>
          )}
          {["uncertain", "sending"].includes(msg.status) && (
            <button
              className="secondary"
              onClick={() => open({ kind: "resolve", id: msg.id })}
            >
              Уточнить результат SMTP
            </button>
          )}
        </div>
      )}
      {dirty && (
        <p className="notice warning">
          Есть несохранённые изменения. Сначала сохраните текст; утверждение и
          отправка доступны только для сохранённой версии.
        </p>
      )}
      <h3>История письма</h3>
      {data.events
        .filter((e) => e.message_id === msg.id)
        .map((e) => (
          <div className="mini-row" key={e.id}>
            <div>
              <strong>{e.kind}</strong>
              <p>{e.detail}</p>
            </div>
            <small>{dateTime(e.created_at)}</small>
          </div>
        ))}
      {msg.smtp_message_id && (
        <p className="muted">Message-ID: {msg.smtp_message_id}</p>
      )}
    </>
  );
}
