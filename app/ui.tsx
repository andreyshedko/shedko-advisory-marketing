"use client";
import { useRef,
  useId, useEffect, type FormEvent, type ReactNode } from "react";
import { X, ArrowUpRight } from "lucide-react";
export const kinds: Record<string, string> = {
  advisor: "M&A advisers",
  acquirer: "Software acquirers",
  search_fund: "Search funds",
  private_equity: "Private equity",
  corporate_ma: "Corporate M&A",
  directory: "Каталоги",
  partner: "Партнёры",
};
export const statuses: Record<string, string> = {
  discovered: "Найдено",
  researched: "Изучено",
  qualified: "Квалифицировано",
  contacted: "Отправлено",
  replied: "Есть ответ",
  do_not_contact: "Не контактировать",
  draft: "Черновик",
  approved: "Утверждено",
  sending: "Отправляется",
  sent: "SMTP принял",
  uncertain: "Результат неизвестен",
  failed: "Ошибка",
  cancelled: "Отменено",
  review: "На проверке",
  submitted: "Подано вручную",
  accepted: "Принято",
  rejected: "Отклонено",
  open: "Открыта",
  done: "Выполнена",
  negotiation: "Переговоры",
  proposal: "Предложение",
  won: "Заказ",
  lost: "Потеряно",
  running: "Выполняется",
  succeeded: "Успешно",
  manual: "Вручную",
  confirmed: "Подтверждено",
  csv: "Импорт CSV",
  scripts: "Ads Scripts",
  unverified: "Не проверено",
};
export function dateTime(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
}
export function money(value: number | string, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge status-${value}`}>{statuses[value] || value}</span>
  );
}
export function Empty({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">↗</span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {children}
    </div>
  );
}
export function External({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="external"
    >
      {children}
      <ArrowUpRight size={13} />
    </a>
  );
}
export function Field({
  label,
  name,
  type = "text",
  required = true,
  defaultValue,
  placeholder,
  wide = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "wide" : ""}>
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        step={type === "number" ? "0.01" : undefined}
        min={type === "number" ? 0 : undefined}
      />
    </label>
  );
}
export function Area({
  label,
  name,
  defaultValue,
  placeholder,
  required = true,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="wide">
      {label}
      <textarea
        name={name}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        rows={5}
      />
    </label>
  );
}
export function Select({
  label,
  name,
  options,
  defaultValue,
  required = true,
}: {
  label: string;
  name: string;
  options: Record<string, string>;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={defaultValue} required={required}>
        {!defaultValue && <option value="">Выберите…</option>}
        {Object.entries(options).map(([key, value]) => (
          <option key={key} value={key}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Check({
  name,
  children,
  required = false,
}: {
  name: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="check wide">
      <input type="checkbox" name={name} required={required} />
      <span>{children}</span>
    </label>
  );
}
export type FormValues = Record<string, FormDataEntryValue>;
export function Form({
  onSubmit,
  children,
  busy,
  submit = "Сохранить",
  disabled = false,
  onChange,
}: {
  onSubmit: (v: FormValues) => Promise<unknown>;
  children: ReactNode;
  busy: boolean;
  submit?: string;
  disabled?: boolean;
  onChange?: () => void;
}) {
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await onSubmit(Object.fromEntries(new FormData(e.currentTarget)));
  }
  return (
    <form onSubmit={handle} onChange={onChange} className="form-grid">
      {children}
      <div className="form-footer wide">
        <button className="primary" disabled={busy || disabled} type="submit">
          {busy ? "Сохранение…" : submit}
          <ArrowUpRight size={15} />
        </button>
      </div>
    </form>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId=useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      aria-labelledby={titleId}
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="modal"
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Закрыть">
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
