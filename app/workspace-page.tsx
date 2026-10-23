import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import Login from "./login";
import Workspace from "./workspace";
export default async function WorkspacePage({
  section = "overview",
}: {
  section?: string;
}) {
  if (
    !process.env.DATABASE_URL ||
    !process.env.BETTER_AUTH_SECRET ||
    !process.env.ADMIN_EMAIL
  )
    return (
      <main className="setup">
        <span className="eyebrow">SHEDKO ADVISORY</span>
        <h1>Подключите рабочее пространство</h1>
        <p>
          Для запуска нужны PostgreSQL, секрет сессий и учётная запись
          администратора.
        </p>
        <p>
          Настройте переменные из <code>.env.example</code>, выполните миграции
          и <code>npm run admin:create</code>.
        </p>
        <p>Исходящие письма и внешние действия сейчас отключены.</p>
      </main>
    );
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (
    !session ||
    session.user.email.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()
  )
    return <Login />;
  return <Workspace section={section} email={session.user.email} />;
}
