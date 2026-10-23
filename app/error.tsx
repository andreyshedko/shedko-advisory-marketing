"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="setup">
      <span className="eyebrow">SHEDKO ADVISORY</span>
      <h1>Рабочее пространство недоступно</h1>
      <p>
        Не удалось получить данные. Проверьте подключение к PostgreSQL, миграции
        и серверные настройки авторизации.
      </p>
      <button className="primary" onClick={reset}>
        Повторить загрузку
      </button>
    </main>
  );
}
