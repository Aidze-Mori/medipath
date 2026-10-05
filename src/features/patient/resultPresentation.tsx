import { Check, ClipboardCheck, ShieldCheck } from 'lucide-react';
import { isConfirmed, isReadyForAnalysis } from '../../domain';
import type { DocumentRecord } from '../../domain';

export function ResultDate({ value }: { value: string }) {
  if (!value) return <>Дата не указана</>;
  const parsed = /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) return <>{value}</>;
  return <time dateTime={value}>{new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow',
  }).format(parsed)}</time>;
}

function getReadiness(document: DocumentRecord) {
  if (document.origin === 'clinic_adapter' && isReadyForAnalysis(document))
    return { label: 'Источник клиники проверен', ready: true, clinic: true };
  if (isConfirmed(document)) return { label: 'Текст подтверждён', ready: true, clinic: false };
  return { label: 'Нужна сверка текста', ready: false, clinic: false };
}

export function getOrigin(document: DocumentRecord) {
  if (document.sourceValidation?.studyAdapter === 'third_opinion_demo') return 'Учебный адаптер «Третье Мнение»';
  if (document.origin === 'clinic_adapter') return 'Из учебной системы клиники';
  if (document.origin === 'builtin_fixture') return 'Учебный документ';
  if (document.origin === 'paste') return 'Добавлен текстом';
  return document.fixtureId ? 'Учебный документ · исправлен локально' : 'Внешний документ';
}

export function ReadinessLabel({ document }: { document: DocumentRecord }) {
  const readiness = getReadiness(document);
  return <span className={`results-readiness${readiness.ready ? ' is-ready' : ''}`}>
    {readiness.clinic ? <ShieldCheck size={16} /> : readiness.ready ? <Check size={16} /> : <ClipboardCheck size={16} />}
    {readiness.label}
  </span>;
}

