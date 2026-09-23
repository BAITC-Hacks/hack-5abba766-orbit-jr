import {
  ArrowUpRight,
  BookOpen,
  Layers3,
  Sparkles,
  ShieldCheck,
  Users,
  Award,
  Coffee,
} from "lucide-react";
import type { EventView } from "../../../../contracts/backend";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <span className={"halyk-brand" + (light ? " light" : "")}>
      <span className="halyk-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none">
          <circle
            cx="20"
            cy="20"
            r="17"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M20 7v26M7 20h26M11 11l18 18M11 29l18-18"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <circle cx="20" cy="20" r="7" fill="currentColor" />
        </svg>
      </span>
      <span className="halyk-wordmark">
        Halyk<span>Career Quest</span>
      </span>
    </span>
  );
}
export function GrowthArt() {
  return (
    <div className="growth-art" aria-hidden="true">
      <div className="growth-orbit orbit-a" />
      <div className="growth-orbit orbit-b" />
      <div className="growth-sun">
        <Sparkles size={34} />
      </div>
      <div className="growth-steps">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="growth-float float-skills">
        <span className="float-icon">
          <Layers3 size={22} />
        </span>
        <span>
          <small>ВАШ КАПИТАЛ</small>
          <strong>Навыки и опыт</strong>
        </span>
      </div>
      <div className="growth-float float-direction">
        <ArrowUpRight size={22} />
        <span>Новые возможности</span>
      </div>
      <div className="growth-dots">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
const icons = {
  course: BookOpen,
  workshop: Layers3,
  mentoring: Users,
  certification: Award,
  compliance: ShieldCheck,
  onboarding: Sparkles,
  meetup: Coffee,
};
export function ActivityArt({
  type,
  compact = false,
}: {
  type: EventView["type"];
  compact?: boolean;
}) {
  const Icon = icons[type] ?? BookOpen;
  return (
    <div
      className={"activity-art art-" + type + (compact ? " art-compact" : "")}
      aria-hidden="true"
    >
      <span className="art-grid" />
      <span className="art-halo" />
      <span className="art-tile tile-back" />
      <span className="art-tile tile-front">
        <Icon size={compact ? 32 : 46} strokeWidth={1.35} />
      </span>
      <span className="art-spark">
        <Sparkles size={18} />
      </span>
    </div>
  );
}
