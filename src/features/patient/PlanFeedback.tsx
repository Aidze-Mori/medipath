import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '../../ui/Button';
export type PlanFeedbackValue = 'helpful' | 'unhelpful' | null;
export function PlanFeedback({ value, onChange }: { value: PlanFeedbackValue; onChange: (value: PlanFeedbackValue) => void }) {
  return <section className="plan-feedback" aria-label="Оценка маршрута"><div><h3>Понятен ли вам результат?</h3><p className="small muted">Оцените пояснение и предложенные следующие шаги.</p></div><div className="button-row">
    <Button variant="secondary" aria-pressed={value === 'helpful'} onClick={() => onChange(value === 'helpful' ? null : 'helpful')}><ThumbsUp size={17} />Полезно</Button>
    <Button variant="secondary" aria-pressed={value === 'unhelpful'} onClick={() => onChange(value === 'unhelpful' ? null : 'unhelpful')}><ThumbsDown size={17} />Не помогло</Button>
    {value && <Button variant="quiet" onClick={() => onChange(null)}>Снять оценку</Button>}
  </div><p className="small muted" aria-live="polite">{value ? 'Оценка сохранена в этой сессии. Она не является врачебной проверкой.' : 'Оценку можно изменить. Личные данные и текст документа не передаются.'}</p></section>;
}
