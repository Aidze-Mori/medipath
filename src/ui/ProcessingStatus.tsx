import { useEffect, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { Button } from './Button';
export function ProcessingStatus({ stage, live, detail, onCancel }: { stage: string; live: boolean; detail: string; onCancel: () => void }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { const start = Date.now(); const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000); return () => clearInterval(timer); }, []);
  const steps = live ? ['Обезличивание', 'Анализ', 'Проверка ответа'] : ['Проверка текста', 'Основания', 'Результат'];
  const current = /Проверяем ответ/.test(stage) ? 2 : /Анализируем/.test(stage) ? 1 : 0;
  return <section className="processing-strip processing-status" aria-label="Обработка документа" aria-busy="true">
    <div className="processing-heading"><span className="processing-orbit" aria-hidden="true"><LoaderCircle size={24} /></span><div><strong role="status">{stage}</strong><p className="small muted">{seconds < 15 ? 'Обработка продолжается' : `Обработка продолжается · ${seconds} с`}</p></div></div>
    <ol className="processing-steps">{steps.map((step, index) => <li key={step} className={index < current ? 'is-done' : index === current ? 'is-current' : ''}><span>{index < current ? <Check size={12} /> : index + 1}</span>{step}</li>)}</ol>
    <p className="small muted">{detail}</p><Button variant="quiet" onClick={onCancel}>Отменить обработку</Button>
  </section>;
}
