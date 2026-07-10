import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "КОНЦЕСИИ — прозрачност на концесиите в България" },
    {
      name: "description",
      content:
        "Публичен портал, който събира данните за всички концесии в България — язовири, плажове, добив, публична собственост — и прави всяка сделка проследима до източника.",
    },
  ];
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">КОНЦЕСИИ</h1>
      <p className="text-lg leading-relaxed">
        Платформа за прозрачност на концесиите в България. Порталът събира на
        едно място данните за всички концесии — язовири, морски плажове, добив
        на подземни богатства, обекти на публична собственост — и прави всяка
        сделка проследима до източника: кой обект, на кого е отдаден, за колко
        години и срещу какво възнаграждение.
      </p>
      <p className="leading-relaxed text-gray-600 dark:text-gray-400">
        Порталът е в разработка. Методологията и кодът са публични:{" "}
        <a
          className="underline underline-offset-4"
          href="https://github.com/B353N/koncesii"
        >
          github.com/B353N/koncesii
        </a>
        .
      </p>
    </main>
  );
}
