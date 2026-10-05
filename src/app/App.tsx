import { useEffect, useState } from 'react';
import { Archive, HeartPulse, Bell, CalendarDays, ChevronRight, FilePlus2, FileSearch, FlaskConical, ListChecks, Menu, RotateCcw, Users } from 'lucide-react';
import { PatientFlow } from '../features/patient/PatientFlow';
import type { PatientSection } from '../features/patient/PatientFlow';
import { ClinicFlow } from '../features/clinic/ClinicFlow';
import { DemoPanel } from '../features/demo/DemoPanel';
import type { DemoProcessing, DemoScenario } from '../features/demo/DemoPanel';
import { resetDemoBridge } from '../features/demo/bridge';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';

const nav = [
  { id: 'results', title: 'Моя медкарта', Icon: FileSearch },
  { id: 'new', title: 'Новый маршрут', Icon: FilePlus2 },
  { id: 'plans', title: 'Мои планы', Icon: ListChecks },
  { id: 'bookings', title: 'Записи', Icon: CalendarDays },
  { id: 'archive', title: 'Архив', Icon: Archive },
] as const;
type Workspace = 'work' | 'demo';
const demoEnabled = import.meta.env.VITE_DEMO_ENABLED !== 'false';

export function App() {
  const [role, setRole] = useState(location.pathname.startsWith('/clinic') ? 'clinic' : 'patient');
  const [mode, setMode] = useState<Workspace>('work');
  const [sections, setSections] = useState<Record<Workspace, PatientSection>>({ work: 'new', demo: 'new' });
  const [sessions, setSessions] = useState({ work: 0, demo: 0 });
  const [clinicQueueTokens, setClinicQueueTokens] = useState({ work: 0, demo: 0 });
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(false);
  const [utility, setUtility] = useState<'account' | 'notifications' | null>(null);
  const [processing, setProcessing] = useState<DemoProcessing>('local');
  const [scenario, setScenario] = useState<DemoScenario | null>(null);
  const [incoming, setIncoming] = useState<{ scenario: DemoScenario; at: string; read: boolean } | null>(null);
  const section = sections[mode];
  const navSection = section === 'plan-detail' || section === 'plan-edit' ? 'plans' : section === 'result-detail' ? 'results' : section === 'review' ? 'new' : section;
  const demo = mode === 'demo';
  useEffect(() => {
    if (location.pathname === '/') history.replaceState({}, '', '/patient');
    const pop = () => setRole(location.pathname.startsWith('/clinic') ? 'clinic' : 'patient');
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  function navigate(next: string) {
    setRole(next);
    window.scrollTo(0, 0);
    if (location.pathname !== `/${next}`) history.pushState({}, '', `/${next}`);
    setMenu(false);
  }
  function reset(target: Workspace = mode) {
    if (!window.confirm(`Удалить документы, правки, записи и задачи ${target === 'demo' ? 'демонстрационной' : 'рабочей'} сессии? Другая сессия сохранится.`)) return;
    setSessions(values => ({ ...values, [target]: values[target] + 1 }));
    setSections(values => ({ ...values, [target]: 'new' }));
    if (target === 'demo') { setScenario(null); setIncoming(null); resetDemoBridge(); }
    setMenu(false);
    setUtility(null);
  }
  function openScenario(next: DemoScenario) {
    setPanel(false); setMode('demo'); setProcessing(next.processing); navigate('patient');
    if (next.kind === 'notification') {
      setIncoming({ scenario: next, at: new Date().toISOString(), read: false }); setUtility('notifications');
      setSections(values => ({ ...values, demo: 'results' }));
    } else setScenario(next);
  }
  const links = role === 'patient' ? nav.map(({ id, title, Icon }) => (
    <button className={`nav-button ${navSection === id ? 'active' : ''}`} key={id}
      aria-current={navSection === id ? 'page' : undefined}
      onClick={() => { setSections(values => ({ ...values, [mode]: id })); setMenu(false); }}>
      <Icon size={21} /><span>{title}</span>
    </button>
  )) : <button className="nav-button active" aria-current="page" onClick={() => { setMenu(false); setClinicQueueTokens(values => ({ ...values, [mode]: values[mode] + 1 })); }}><Users size={21} /><span>Пациенты</span></button>;
  const roleLinks = <div className="role-switch" aria-label="Раздел кабинета">
    {([['patient', 'Пациенту'], ['clinic', 'Клинике']] as const).map(([value, label]) => <a key={value} href={`/${value}`} className={role === value ? 'active' : ''} aria-current={role === value ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate(value); setPanel(false); }}>{label}</a>)}
  </div>;
  return <>
    <a className="skip-link" href="#main">Перейти к содержимому</a>
    <header className="clinic-header">
      <div className="clinic-brand"><span className="clinic-brand-mark" aria-hidden="true"><HeartPulse size={25} /></span>Клиника</div><span className="clinic-header-divider" aria-hidden="true" />
      <span className="clinic-header-context">Личный кабинет</span>
      <div className="clinic-header-tools">
        <button className="icon-button" aria-label="Уведомления" onClick={() => setUtility('notifications')}><Bell size={21} />{demo && incoming && !incoming.read && <span className="notification-dot" aria-hidden="true" />}</button>
        <button className="mobile-menu-control icon-button" aria-label="Открыть меню" onClick={() => setMenu(true)}><Menu size={22} /></button>
      </div>
    </header>
    <aside className="sidebar">
      <p className="sidebar-caption">Личный кабинет</p>
      <nav aria-label="Основная навигация">{links}</nav>
      <div className="sidebar-bottom"><strong>MediPath</strong><p>Понятный путь<br />от результата к приёму</p><span className="session-caption">{demo ? 'Демо · учебные данные' : 'Рабочая сессия'}</span></div>
    </aside>
    <main id="main" className="shell-main" tabIndex={-1}>
      <nav className="module-breadcrumb" aria-label="Хлебные крошки" hidden={role === 'clinic'}><button type="button" onClick={() => setSections(values => ({ ...values, [mode]: 'results' }))}>MediPath</button><ChevronRight size={14} /><span aria-current="page">{nav.find(item => item.id === navSection)?.title}</span></nav>
      {role === 'clinic' ? <div className="page-head"><div><h1>Рабочее место клиники</h1><p className="page-subtitle">Пациенты, результаты исследований и предложения записи</p></div></div> : <h1 className="sr-only">Личный кабинет пациента · MediPath</h1>}
      {demo && <div className="workspace-status" role="status"><span><FlaskConical size={16} />Демонстрация · учебные данные</span><Button variant="quiet" onClick={() => setMode('work')}>Вернуться к работе</Button></div>}
      {(['work', ...(demoEnabled ? ['demo'] : [])] as Workspace[]).map(workspace => <div key={`${workspace}:${sessions[workspace]}`} data-workspace={workspace} hidden={workspace !== mode}>
        <PatientFlow demo={workspace === 'demo'} active={workspace === mode && role === 'patient'}
          scenario={workspace === 'demo' ? scenario : null} processingMode={workspace === 'demo' ? processing : 'local'}
          section={sections[workspace]} setSection={next => setSections(values => ({ ...values, [workspace]: next }))} />
        <ClinicFlow demo={workspace === 'demo'} active={workspace === mode && role === 'clinic'} queueToken={clinicQueueTokens[workspace]} onHome={() => { navigate('patient'); setSections(values => ({ ...values, [workspace]: 'results' })); }} onOpenPatient={fixtureId => openScenario({ fixtureId, kind: 'clinic', processing, token: crypto.randomUUID() })} />
      </div>)}
      <footer className="app-footer"><span>MediPath не ставит диагноз и не заменяет консультацию врача.</span><span>Документы хранятся только в этой вкладке.</span><Button variant="quiet" onClick={() => reset()}><RotateCcw size={14} />Сбросить сессию</Button></footer>
    </main>
    {role === 'patient' && <nav className="bottom-nav" aria-label="Навигация на телефоне">{links}</nav>}
    {demoEnabled && <Button className="demo-control" variant="secondary" onClick={() => setPanel(true)}><FlaskConical size={17} />Демопанель</Button>}
    {menu && <Dialog title="Меню" eyebrow="Личный кабинет" onClose={() => setMenu(false)}><div className="stack"><div className="mobile-nav-links">{links}</div><Button variant="secondary" onClick={() => reset()}><RotateCcw size={18} />Новая сессия</Button></div></Dialog>}
    {utility && <Dialog title={utility === 'account' ? 'Текущая сессия' : 'Уведомления'} eyebrow="Личный кабинет" onClose={() => setUtility(null)}><div className="stack">
      {utility === 'account' ? <><p>{demo ? 'Учебные документы и действия' : 'Ваши документы'} сохраняются в памяти этой вкладки до перезагрузки. Рабочий и демонстрационный режимы разделены.</p><p className="muted">Вход в аккаунт и постоянное хранение будут доступны после подключения системы клиники.</p><Button variant="secondary" onClick={() => reset()}>Начать новую сессию</Button></> : demo && incoming ? <article className="incoming-result"><span className="eyebrow">Учебное уведомление · {new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(incoming.at))}</span><h3>Ваш новый результат готов</h3><p>Маммография поступила в медкарту из учебного адаптера «Третье Мнение». Откройте исследование, прочитайте заключение и выберите следующий шаг.</p><Button onClick={() => { const next = incoming.scenario; navigate('patient'); setIncoming({ ...incoming, read: true }); setUtility(null); setScenario({ ...next, kind: 'clinic', token: crypto.randomUUID() }); setSections(values => ({ ...values, demo: 'results' })); }}>Посмотреть результат</Button><p className="small muted">Это сценарий внутри сайта. Настоящее push/SMS не отправлялось.</p></article> : <><div className="empty-state"><Bell size={30} /><h3>{demo ? 'Учебные уведомления' : 'Новых уведомлений нет'}</h3><p className="muted">{demo ? 'Предпросмотр Push и SMS доступен в рабочем месте клиники. Сообщения не отправляются.' : 'Доставка уведомлений появится после подключения системы клиники.'}</p></div>{demo && <Button variant="secondary" onClick={() => { setUtility(null); navigate('clinic'); }}>Открыть рабочее место клиники</Button>}</>}
    </div></Dialog>}
    {demoEnabled && panel && <DemoPanel sessionControls={<>{roleLinks}<Button variant="quiet" onClick={() => { setPanel(false); setUtility('account'); }}>Текущая сессия</Button></>} demo={demo} processing={processing} onProcessing={setProcessing} onClose={() => setPanel(false)} onMode={next => { setMode(next ? 'demo' : 'work'); setPanel(false); }} onScenario={openScenario} onClinic={() => { setMode('demo'); setPanel(false); navigate('clinic'); }} onReset={() => reset('demo')} />}
  </>;
}
