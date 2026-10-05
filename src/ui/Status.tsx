import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'success' | 'error';
}) {
  const Icon =
    tone === 'success' ? CircleCheck : tone === 'error' || tone === 'warning' ? TriangleAlert : Info;
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={20} />
      <div>{children}</div>
    </div>
  );
}
export function ModeLabel({ mode }: { mode: string }) {
  const names: Record<string, string> = {
    personal_local: 'Локальная обработка',
    synthetic_live: 'Учебный пример · live AI',
    synthetic_replay: 'Учебный пример · сохранённый результат',
    anonymized_live: 'AI-разбор · очищенный документ',
  };
  return <span className="mode-label">{names[mode] ?? mode}</span>;
}
