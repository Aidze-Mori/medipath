import { Check, ChevronDown } from 'lucide-react';
const steps = [
  ['Документ', 'Файл, фото или текст'],
  ['Проверка данных', 'Сверьте с оригиналом'],
  ['Маршрут', 'Понятный следующий шаг'],
  ['Записи и календарь', 'Всё в одном месте'],
];
export function Stepper({ current, completed = false }: { current: number; completed?: boolean }) {
  const list = (
    <ol className="stepper">
      {steps.map(([title, text], i) => (
        <li
          key={title}
          className={completed || i < current ? 'done' : i === current ? 'current' : 'future'}
          aria-current={!completed && i === current ? 'step' : undefined}
        >
          <span className="step-dot">{completed || i < current ? <Check size={18} /> : i + 1}</span>
          <strong>{title}</strong>
          <span>{text}</span>
        </li>
      ))}
    </ol>
  );
  return (
    <aside className="step-rail">
      <div className="desktop-stepper">{list}</div>
      <details className="mobile-stepper">
        <summary>
          {completed ? 'Маршрут завершён · 4 из 4 этапов' : `Шаг ${current + 1} из 4 · ${steps[current][0]}`}
          <ChevronDown size={18} />
        </summary>
        {list}
      </details>
      <p className="rail-note">{completed ? 'План сохранён. Подтверждённые и отложенные шаги показаны отдельно.' : 'Вы контролируете каждый шаг. Запись создаётся только после подтверждения.'}</p>
    </aside>
  );
}
