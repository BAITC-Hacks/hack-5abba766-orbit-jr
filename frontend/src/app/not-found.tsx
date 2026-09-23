import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { Brand } from "@/components/quest/visuals";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <Link href="/" aria-label="Halyk Career Quest — главная">
        <Brand />
      </Link>
      <section className="not-found-card">
        <div className="not-found-symbol" aria-hidden="true">
          <Compass size={56} />
        </div>
        <span className="eyebrow">404 · НОВЫЙ МАРШРУТ</span>
        <h1>
          Здесь путь заканчивается.
          <br />
          <em>Возможности — нет.</em>
        </h1>
        <p>
          Такой страницы нет. Вернитесь в своё пространство развития и
          продолжите с главной.
        </p>
        <Link href="/" className="primary">
          На главную <ArrowRight size={18} />
        </Link>
      </section>
    </main>
  );
}
