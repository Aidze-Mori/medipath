import { StyledSelect } from '../../ui/Select';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Bell, FileCheck2, FileText, Play, RefreshCw, RotateCcw, ShieldCheck, Siren, Users } from 'lucide-react';
import { SYNTHETIC_FIXTURES } from '../../domain';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { fetchCapabilities, type RuntimeCapabilities } from '../../privacy/documentAnalysis';
import './DemoPanel.css';

export type DemoProcessing = 'local' | 'live' | 'replay';
export interface DemoScenario {
  fixtureId: string;
  processing: DemoProcessing;
  token: string;
  kind?: 'review' | 'clinic' | 'file' | 'notification';
  openResult?: boolean;
}

const MODEL_CASES = [
  { fixtureId: 'chest-referral', label: 'Направление в исходнике', title: 'Врач уже указан', description: 'Консультация пульмонолога прямо рекомендована в документе. Система показывает основание и помогает выбрать время.', action: 'Открыть явное направление' },
  { fixtureId: 'missing-conclusion', label: 'Недостаточно данных', title: 'Не хватает заключения', description: 'Описание есть, но заключение отсутствует. Уточняем данные, не достраивая медицинские выводы.', action: 'Открыть неполный результат' },
  { fixtureId: 'conflicting-sections', label: 'Противоречие в документе', title: 'Разделы не согласуются', description: 'Описание и заключение расходятся. Следующий шаг — уточнить результат у клиники.', action: 'Открыть противоречие' },
  { fixtureId: 'chest-negative', label: 'Направления нет', title: 'Не добавляем лишний приём', description: 'Явной рекомендации следующего шага нет. Сохраняем результат и объясняем ограничения.', action: 'Открыть результат без направления' },
  { fixtureId: 'clinical-birads4', label: 'Клинический источник', title: 'Предложение по источнику', description: 'Учебное уведомление и переход в общую медкарту. BI-RADS 4 без готового направления к врачу.', action: 'Получить уведомление', kind: 'notification' as const },
  { fixtureId: 'negated-referral', label: 'Отрицательная рекомендация', title: 'Визит не требуется', description: 'В документе явно сказано, что консультация не требуется. Отрицание сохраняется: запись не предлагается.', action: 'Открыть отрицательную рекомендацию' },
];

export function DemoPanel({ sessionControls, demo, processing, onProcessing, onMode, onScenario, onClinic, onReset, onClose }: {
  sessionControls?: ReactNode;
  demo: boolean;
  processing: DemoProcessing;
  onProcessing: (processing: DemoProcessing) => void;
  onMode: (demo: boolean) => void;
  onScenario: (scenario: DemoScenario) => void;
  onClinic: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [fixtureId, setFixtureId] = useState('chest-referral');
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetchCapabilities({ signal: controller.signal }).then(data => {
      if (active) setCapabilities(data);
    }).catch(() => {
      if (active) setCapabilityError(true);
    });
    return () => { active = false; controller.abort(); };
  }, [attempt]);
  const liveReady = capabilities?.configured && capabilities.provider !== 'disabled';
  const providerLabel = capabilities?.provider === 'codex_cli' ? 'Codex CLI' : capabilities?.provider === 'openai' ? 'OpenAI API' : '';

  function retryCapabilities() {
    setCapabilities(null);
    setCapabilityError(false);
    setAttempt(value => value + 1);
  }
  function startFullDemo(nextProcessing: DemoProcessing = 'live') {
    if (nextProcessing === 'live' && !liveReady) return;
    onProcessing(nextProcessing);
    onScenario({ fixtureId: 'doctor-report', kind: 'file', processing: nextProcessing, token: crypto.randomUUID() });
  }
  function openPreparedCase(id: string, kind: 'clinic' | 'notification' = 'clinic', openResult = false) {
    onScenario({ fixtureId: id, kind, openResult, processing: liveReady ? 'live' : 'local', token: crypto.randomUUID() });
  }

  return <Dialog title="Демопанель" eyebrow="Посмотрите, как работает MediPath" className="demo-dialog" onClose={onClose}>
    <div className="demo-panel">
      {sessionControls && <div className="demo-session-tools" aria-label="Управление тестированием">{sessionControls}</div>}
      <div className="demo-overview"><h3>Три истории пациента</h3></div>
      <div className={`demo-server-state${liveReady ? ' is-ready' : ''}`} role="status" aria-live="polite">
          <span className="demo-server-dot" aria-hidden="true" />
          <p>{capabilityError ? 'Не удалось проверить AI-сервер.' : !capabilities ? 'Проверяем настройку AI-сервера…' : liveReady ? `AI настроен · ${providerLabel}` : 'AI-сервер пока не настроен. Локальные сценарии доступны ниже.'}</p>
          {(capabilityError || capabilities && !liveReady) && <Button variant="quiet" onClick={retryCapabilities}><RefreshCw size={14} />Повторить проверку</Button>}
      </div>
      <div className="demo-case-grid" aria-label="Основные сценарии демонстрации">
        <article className="demo-story" aria-labelledby="demo-third-opinion-heading">
          <div className="demo-story-top"><span className="demo-scenario-icon"><Bell size={23} /></span><span className="demo-story-number">01</span></div>
          <div><p className="eyebrow">Готовый результат из клиники</p><h3 id="demo-third-opinion-heading">Результат из «Третьего Мнения»</h3></div>
          <ol className="demo-journey" aria-label="Путь результата из клиники">{['Уведомление', 'Результат', 'Источник', 'Запись'].map((step, index) => <li key={step}><span>{step}</span>{index < 3 && <ArrowRight size={12} aria-hidden="true" />}</li>)}</ol>
          <div className="demo-story-outcome"><strong>Что посмотреть</strong><span>Нет готового направления. Проверьте предложение по клиническому источнику и выберите врача.</span></div>
          <div className="demo-story-launch"><span className="demo-processing-label">{liveReady ? 'Внешний AI при анализе' : 'Подготовленный пример · без внешнего AI'}</span><Button onClick={() => openPreparedCase('clinical-birads4', 'notification', true)} disabled={!capabilities && !capabilityError}><Play size={16} />Открыть результат Третьего Мнения</Button></div>
        </article>
        <article className="demo-story" aria-labelledby="demo-full-heading">
          <div className="demo-story-top"><span className="demo-scenario-icon"><FileCheck2 size={23} /></span><span className="demo-story-number">02</span></div>
          <div><p className="eyebrow">Многостраничный PDF</p><h3 id="demo-full-heading">Большой отчёт врача</h3></div>
          <ol className="demo-journey" aria-label="Этапы демонстрации">{['PDF', 'Проверка', 'Обезличивание', 'AI', 'Запись'].map((step, index) => <li key={step}><span>{step}</span>{index < 4 && <ArrowRight size={12} aria-hidden="true" />}</li>)}</ol>
          <div className="demo-story-outcome"><strong>Что посмотреть</strong><span>Сверка разделов PDF, пояснение и выбор времени приёма.</span></div>
          <div className="demo-story-launch"><span className="demo-processing-label">{liveReady ? 'Внешний AI после сверки текста' : 'Локальный разбор доступен без AI'}</span><Button className="demo-launch" onClick={() => startFullDemo()} disabled={!liveReady}><Play size={16} />Запустить полную демонстрацию</Button>{!liveReady && (capabilities || capabilityError) && <Button variant="secondary" onClick={() => startFullDemo('local')}>Открыть PDF без внешнего AI</Button>}</div>
        </article>
        <article className="demo-story" aria-labelledby="demo-urgent-heading">
          <div className="demo-story-top"><span className="demo-scenario-icon"><Siren size={23} /></span><span className="demo-story-number">03</span></div>
          <div><p className="eyebrow">Явное указание в исходнике</p><h3 id="demo-urgent-heading">Срочный результат</h3></div>
          <ol className="demo-journey" aria-label="Путь срочного результата">{['Результат', 'Разбор', 'Срочный шаг'].map((step, index) => <li key={step}><span>{step}</span>{index < 2 && <ArrowRight size={12} aria-hidden="true" />}</li>)}</ol>
          <div className="demo-story-outcome"><strong>Что посмотреть</strong><span>Срочный шаг прямо из документа. Обычная запись недоступна.</span></div>
          <div className="demo-story-launch"><span className="demo-processing-label">{liveReady ? 'Внешний AI при анализе' : 'Подготовленный пример · без внешнего AI'}</span><Button onClick={() => openPreparedCase('explicit-urgent', 'clinic', true)} disabled={!capabilities && !capabilityError}><Play size={16} />Открыть срочный результат</Button></div>
        </article>
      </div>
      <p className="demo-fixture-note">Все документы синтетические. «Третье Мнение» показано учебным адаптером. Собственный документ можно загрузить обычной кнопкой «Добавить документ» в медкарте.</p>
      <details className="demo-advanced">
        <summary>Дополнительные сценарии и настройки</summary>
        <div className="demo-advanced-content">
          <p className="eyebrow">Технические проверки и редкие случаи</p>
          <div className="demo-technical-cases">{MODEL_CASES.map(item => <article key={item.fixtureId}><span className="eyebrow">{item.label}</span><h4>{item.title}</h4><p>{item.description}</p><Button variant="quiet" onClick={() => openPreparedCase(item.fixtureId, item.kind)}>{item.action}</Button></article>)}</div>
          <div className="demo-additional-cases" aria-label="Дополнительные клинические случаи"><Button variant="quiet" onClick={() => openPreparedCase('clinical-birads0')}>Открыть случай с уточнением</Button><Button variant="quiet" onClick={() => openPreparedCase('clinical-birads2')}>Открыть случай без дообследования</Button><Button variant="quiet" onClick={() => openPreparedCase('exam-without-specialty')}>Открыть рекомендацию обследования</Button></div>
          <p>«Открыть сценарий» добавляет готовый результат из системы клиники. Для проверки распознавания есть отдельный вход с текстом примера или учебным PDF.</p>
          <label>Сценарий пациента<StyledSelect aria-label="Сценарий пациента" value={fixtureId} onChange={event => setFixtureId(event.target.value)}>{SYNTHETIC_FIXTURES.map(fixture => <option key={fixture.id} value={fixture.id}>{fixture.title}</option>)}</StyledSelect></label>
          <label>Режим обработки примера<StyledSelect aria-label="Режим обработки примера" value={processing} onChange={event => onProcessing(event.target.value as DemoProcessing)}><option value="local">Локальный разбор · без внешнего AI</option><option value="live">Внешний AI · нужен настроенный сервер</option><option value="replay">Сохранённый учебный результат · без нового AI-вызова</option></StyledSelect></label>
          <div className="demo-advanced-actions"><Button variant="secondary" onClick={() => onScenario({ fixtureId, kind: 'clinic', processing, token: crypto.randomUUID() })}><Play size={16} />Открыть сценарий</Button><Button variant="secondary" onClick={() => onScenario({ fixtureId, kind: 'review', processing, token: crypto.randomUUID() })}>Проверить текст примера</Button><Button variant="secondary" onClick={() => onScenario({ fixtureId: 'chest-referral', kind: 'file', processing, token: crypto.randomUUID() })}>Загрузить учебный PDF</Button></div>
          <p className="demo-technical-note">Кнопка полной демонстрации всегда выбирает внешний AI. «AI настроен» означает наличие конфигурации, а не успешный запрос: доступность модели проверяется при запуске анализа после сверки текста.</p>
          {capabilities && <p className="demo-technical-note">{capabilities.documentAnalysisAllowed ? 'Сервер разрешает AI-анализ очищенного текста загруженных документов.' : 'Новые личные документы не допускаются к внешнему AI в этом окружении. Учебные примеры проверяются отдельно.'}</p>}
        </div>
      </details>
      <nav className="demo-destinations" aria-label="Демонстрационные рабочие места"><Button variant="quiet" onClick={() => onScenario({ fixtureId: 'clinic-episode', kind: 'clinic', processing, token: crypto.randomUUID() })}><FileText size={16} />Результаты из клиники</Button><Button variant="quiet" onClick={onClinic}><Users size={16} />Открыть учебную очередь</Button></nav>
      <div className="demo-session-state">
        <span className="demo-session-label"><span aria-hidden="true" />{demo ? 'Вы в демонстрации' : 'Сейчас рабочий режим'}</span>
        <Button variant="quiet" onClick={() => onMode(!demo)}>{demo ? 'Перейти в рабочий режим' : 'Включить демонстрацию'}</Button>
      </div>
      <div className="demo-session-actions">
        <p>Возврат к работе сохраняет обе сессии. Повторный запуск сохраняет историю; сброс очищает только демоданные.</p>
        <div>{demo && <Button variant="quiet" onClick={() => startFullDemo()} disabled={!liveReady}><Play size={15} />Пройти заново</Button>}<Button variant="quiet" onClick={onReset}><RotateCcw size={15} />Сбросить демоданные</Button></div>
      </div>
      <p className="demo-safety-note"><ShieldCheck size={17} /><span>Только учебные данные. AI получает текст после удаления прямых идентификаторов. Записи и уведомления не отправляются в клинику.</span></p>
    </div>
  </Dialog>;
}
