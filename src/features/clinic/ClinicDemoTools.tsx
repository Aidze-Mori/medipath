import { useEffect, useState } from 'react';
import { Bell, ClipboardPen, FileText, MessageSquare, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { Analysis, DocumentRecord } from '../../domain';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Select } from '../../ui/Select';
import { Notice } from '../../ui/Status';
import type { DemoActivity } from '../demo/bridge';
import { getActiveDemoBookings, sameDemoRouteStep } from '../demo/bridge';
import {
  createDemoNotification, createStaffFeedback, FEEDBACK_CATEGORIES, FEEDBACK_STATUSES,
  NOTIFICATION_REASONS, updateFeedbackStatus,
} from './demoState';
import type {
  DemoNotification, FeedbackCategory, NotificationChannel, NotificationReason, StaffFeedback, StaffRole,
} from './demoState';
import './Clinic.css';

export function ClinicDemoTools({
  document, analysis, label, activities, bookedStepIds, notifications, feedback,
  onNotificationsChange, onFeedbackChange, onOpenPatient,
}: {
  document: DocumentRecord;
  analysis: Analysis | null;
  label: string;
  activities: readonly DemoActivity[];
  bookedStepIds: readonly string[];
  notifications: DemoNotification[];
  feedback: StaffFeedback[];
  onNotificationsChange: (items: DemoNotification[]) => void;
  onFeedbackChange: (items: StaffFeedback[]) => void;
  onOpenPatient?: (fixtureId: string) => void;
}) {
  const [actionPanel, setActionPanel] = useState<'notification' | 'feedback' | null>(null);
  const [channel, setChannel] = useState<NotificationChannel>('push');
  const [reason, setReason] = useState<NotificationReason>('result_ready');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [role, setRole] = useState<StaffRole>('administrator');
  const [formOpen, setFormOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>('text');
  const [comment, setComment] = useState('');
  const [fragment, setFragment] = useState('');
  const [formError, setFormError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [closingId, setClosingId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [queueError, setQueueError] = useState('');
  const fixtureId = document.fixtureId;
  const caseActivities = activities.filter((item) => item.fixtureId === fixtureId
    && item.documentRevision === document.revision);
  const patientVotes = caseActivities.filter((item) => item.kind === 'patient_feedback_changed' && item.value);
  const patientBookings = getActiveDemoBookings(caseActivities);
  const hasUnbooked = !!analysis?.routeSteps.some((step) => step.bookingAllowed
    && !bookedStepIds.includes(step.id) && !patientBookings.some((booking) => sameDemoRouteStep(booking.stepId, step.id)));
  const notification = notifications.find((item) => item.fixtureId === fixtureId
    && item.revision === document.revision && item.reason === reason && item.channel === channel);
  const canonicalSource = document.origin === 'clinic_adapter' || (document.origin === 'builtin_fixture' && document.revision === 1);
  const notificationAllowed = canonicalSource && (reason !== 'unbooked' || hasUnbooked);
  const template = NOTIFICATION_REASONS[reason];
  const visibleFeedback = feedback.filter((item) => item.fixtureId === fixtureId);
  const shownNotifications = notifications.filter((item) => item.fixtureId === fixtureId
    && item.revision === document.revision && (item.reason !== 'unbooked' || hasUnbooked));

  useEffect(() => {
    setFormOpen(false);
    setActionPanel(null);
    setPreviewOpen(false);
    setClosingId(null);
    setSavedMessage('');
    setFormError('');
  }, [document.id, document.revision]);

  if (!fixtureId) return null;

  function showNotification() {
    if (!fixtureId || !notificationAllowed) return;
    onNotificationsChange(createDemoNotification(notifications, {
      fixtureId, revision: document.revision, channel, reason,
    }));
    setPreviewOpen(true);
  }
  function openNotification() {
    if (!notification || !fixtureId || !onOpenPatient) return;
    onNotificationsChange(notifications.map((item) => item.id === notification.id
      ? { ...item, openedAt: item.openedAt ?? new Date().toISOString() } : item));
    setPreviewOpen(false);
    setActionPanel(null);
    onOpenPatient(fixtureId);
  }
  function saveFeedback() {
    if (!analysis) return;
    try {
      const next = createStaffFeedback({ document, analysis, role, category, comment, fragment });
      onFeedbackChange([...feedback, next]);
      setFormOpen(false);
      setSavedMessage('Отзыв сохранён в демосессии. Реальная команда его не получала.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось сохранить отзыв.');
    }
  }
  function closeFeedback() {
    try {
      onFeedbackChange(feedback.map((item) => item.id === closingId
        ? updateFeedbackStatus(item, 'closed', resolution) : item));
      setClosingId(null);
      setQueueError('');
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'Добавьте результат разбора.');
    }
  }

  return <div className="clinic-demo-tools">
    <div className="clinic-context-actions" aria-label="Действия по пациенту">
      <Button variant="secondary" disabled={!analysis || !hasUnbooked || !canonicalSource} onClick={() => { setReason('unbooked'); setActionPanel('notification'); }}><Send size={17} />Предложить план посещений</Button>
      <Button variant="quiet" disabled={!analysis} onClick={() => { setReason('result_ready'); setActionPanel('notification'); }}><Bell size={17} />Уведомить пациента</Button>
      <Button variant="quiet" onClick={() => setActionPanel('feedback')}><ClipboardPen size={17} />Обратная связь{visibleFeedback.length ? ` · ${visibleFeedback.length}` : ''}</Button>
      {shownNotifications.length > 0 && <span className="small muted">Уведомлений: {shownNotifications.length}</span>}
    </div>
    {actionPanel === 'notification' && !previewOpen && <Dialog title={reason === 'unbooked' ? 'Предложить план посещений' : 'Уведомление пациенту'} eyebrow={label} onClose={() => setActionPanel(null)}>
    <section className="panel stack" aria-labelledby="clinic-notifications-title">
      <div className="panel-head">
        <div><p className="eyebrow">{label}</p><h3 id="clinic-notifications-title">{reason === 'unbooked' ? 'Предложение по результату' : 'Уведомление пациенту'}</h3></div>
        <Bell size={22} aria-hidden="true" />
      </div>
      {reason === 'unbooked' && analysis && <div className="clinic-proposal-summary"><h4>Что предложим пациенту</h4><ul>{analysis.routeSteps.filter(step => step.bookingAllowed && !bookedStepIds.includes(step.id) && !patientBookings.some(booking => sameDemoRouteStep(booking.stepId, step.id))).map(step => <li key={step.id}><strong>{step.title}</strong><span>{step.dueText || 'Срок в документе не указан'}</span></li>)}</ul><p className="small muted">План посещений по исходным направлениям. Диагноз и детали исследования не включаются в текст push или SMS.</p></div>}
      <div className="clinic-form-grid">
        <label>Повод уведомления
          <Select aria-label="Повод уведомления" value={reason} onChange={value => setReason(value as NotificationReason)} options={Object.entries(NOTIFICATION_REASONS).map(([value, item]) => ({ value, label: item.label }))} />
        </label>
        <fieldset className="clinic-channel-field"><legend>Канал</legend>
          <div className="clinic-channel-picker">
            {(['push', 'sms'] as const).map((value) => <button type="button" key={value}
              aria-pressed={channel === value} onClick={() => setChannel(value)}>{value === 'push' ? 'Push' : 'SMS'}</button>)}
          </div>
        </fieldset>
      </div>
      <div className="clinic-notification-preview">
        <span className="clinic-preview-icon">{channel === 'push' ? <Bell size={20} /> : <MessageSquare size={20} />}</span>
        <div><p className="small muted">Демо-клиника · {channel === 'push' ? 'Push' : 'SMS'}</p><strong>{template.title}</strong><p>{template.body}</p></div>
      </div>
      <p className="small muted">{notification ? notification.openedAt ? 'Открыто в демо' : 'Создано в демо' : 'Предпросмотр'} · Реальная отправка не выполняется</p>
      {reason === 'return' && <p className="small muted">Пример организационного приглашения. История реальных посещений не подключена; медицинское показание не создаётся.</p>}
      {!notificationAllowed && <Notice>{!canonicalSource ? 'Текст исправлен локально. Уведомление связано только с исходным результатом учебной системы; для этой редакции переход недоступен.' : 'Все допустимые шаги уже записаны либо актуальной рекомендации нет. Напоминание о записи недоступно.'}</Notice>}
      <Button onClick={showNotification} disabled={!notificationAllowed}><Send size={17} />{reason === 'unbooked' ? 'Создать предложение в демо' : 'Показать демоуведомление'}</Button>
      {shownNotifications.length > 0 && <details className="clinic-details"><summary>Журнал уведомлений · {shownNotifications.length}</summary>
        <ul>{shownNotifications.map((item) => <li key={item.id}>{item.channel === 'push' ? 'Push' : 'SMS'} · {NOTIFICATION_REASONS[item.reason].label} · <strong>{item.openedAt ? 'Открыто в демо' : 'Создано в демо'}</strong></li>)}</ul>
      </details>}
    </section>

    </Dialog>}

    {actionPanel === 'feedback' && !formOpen && !closingId && <Dialog title="Обратная связь по результату" eyebrow={label} onClose={() => setActionPanel(null)}>
    <section className="panel stack" aria-labelledby="clinic-feedback-title">
      <div className="panel-head"><div><p className="eyebrow">Качество пояснений</p><h3 id="clinic-feedback-title">Обратная связь</h3></div><ClipboardPen size={22} aria-hidden="true" /></div>
      <div className="clinic-patient-feedback">
        <strong>Оценка пациента</strong>
        {patientVotes.length ? patientVotes.map((vote) => <p key={vote.id}>{vote.value === 'helpful' ? <ThumbsUp size={16} /> : <ThumbsDown size={16} />}{vote.value === 'helpful' ? 'Пояснение полезно' : 'Пояснение не помогло'}<span className="small muted">Редакция {vote.documentRevision}{vote.contextRevision ? ` · Контекст ${vote.contextRevision}` : ''}</span></p>)
          : <p className="small muted">Пациент ещё не оценивал это пояснение. Оценки появляются после действия в связанном демосценарии.</p>}
        {patientBookings.length > 0 && <p className="small">Подтверждённых записей: {patientBookings.length}.</p>}
      </div>
      <label>Роль сотрудника
        <Select aria-label="Роль сотрудника" value={role} onChange={value => setRole(value as StaffRole)} options={[{ value: 'administrator', label: 'Администратор' }, { value: 'doctor', label: 'Врач' }]} />
      </label>
      <p className="small muted">Переключатель показывает сценарий роли; клиническая проверка не выполняется.</p>
      <Button variant="secondary" disabled={!analysis} onClick={() => {
        setFormOpen(true); setComment(''); setCategory('text'); setFragment(''); setFormError(''); setSavedMessage('');
      }}><ClipboardPen size={17} />Сообщить о проблеме</Button>
      {!analysis && <p className="small muted">Сначала подтвердите исправленный текст и получите актуальный маршрут.</p>}
      {savedMessage && <div role="status"><Notice>{savedMessage}</Notice></div>}
      <div className="stack-small">
        <h4>Очередь замечаний · {visibleFeedback.length}</h4>
        {visibleFeedback.length === 0 ? <p className="small muted">Замечаний по этому учебному случаю пока нет.</p> : visibleFeedback.map((item) => <article key={item.id} className="clinic-feedback-item">
          <div className="panel-head"><strong>{item.role === 'doctor' ? 'Замечание врача' : 'Замечание администратора'} · {FEEDBACK_CATEGORIES[item.category]}</strong><span className="mode-label">{FEEDBACK_STATUSES[item.status]}</span></div>
          <p className="clinic-free-text">{item.comment}</p>
          <p className="small muted">Редакция {item.documentRevision}{item.documentRevision !== document.revision ? ' · Предыдущая редакция' : ''}</p>
          <details className="clinic-details"><summary>Связь с пояснением и источниками</summary>
            <dl className="clinic-feedback-binding"><dt>Ответ</dt><dd>{item.analysisId}</dd><dt>Контекст</dt><dd>{item.contextVersion}</dd><dt>Корпус</dt><dd>{item.corpusVersion}</dd><dt>Обработка</dt><dd>{item.model}</dd><dt>Источники</dt><dd>{item.sourceIds.join(', ') || 'Нет источников'}</dd></dl>
            {item.fragment && <blockquote>{item.fragment}</blockquote>}
          </details>
          {item.status === 'closed' ? <p className="small clinic-free-text"><strong>Результат разбора:</strong> {item.resolution}</p> : <div className="button-row">
            {item.status === 'new' && <Button variant="quiet" onClick={() => onFeedbackChange(feedback.map((entry) => entry.id === item.id ? updateFeedbackStatus(entry, 'reviewing') : entry))}>Взять на рассмотрение</Button>}
            <Button variant="quiet" onClick={() => { setClosingId(item.id); setResolution(''); setQueueError(''); }}>Закрыть с результатом</Button>
          </div>}
        </article>)}
      </div>
      <p className="small muted">Отзывы и статусы хранятся в памяти демосессии. Они не исправляют пояснение и не запускают обучение модели.</p>
    </section>

    </Dialog>}

    {previewOpen && <Dialog title="Демоуведомление" eyebrow={`${channel === 'push' ? 'Push' : 'SMS'} · ${label}`} onClose={() => setPreviewOpen(false)}
      footer={onOpenPatient && <Button onClick={openNotification}><FileText size={18} />Открыть результат пациента</Button>}>
      <div className="stack"><div className="clinic-notification-preview"><Bell size={24} /><div><h3>{template.title}</h3><p>{template.body}</p></div></div>
        <Notice>Создано только в учебном журнале. Никакое SMS или push-сообщение не отправлялось.</Notice>
        {!onOpenPatient && <p className="small muted">Связанный переход недоступен; откройте сценарий пациента из демопанели.</p>}
      </div>
    </Dialog>}
    {formOpen && analysis && <Dialog title="Сообщить о проблеме" eyebrow={role === 'doctor' ? 'Врач' : 'Администратор'} onClose={() => setFormOpen(false)}
      footer={<Button onClick={saveFeedback}>Сохранить отзыв в демо</Button>}>
      <div className="stack"><Notice>Пациент: {label}. Отзыв по редакции {document.revision}. Данные останутся в этой вкладке.</Notice>
        {formError && <Notice tone="error">{formError}</Notice>}
        <fieldset className="clinic-feedback-categories"><legend>Тип замечания</legend>{Object.entries(FEEDBACK_CATEGORIES).map(([key, value]) => <label key={key}><input type="radio" name="feedback-category" value={key} checked={category === key} onChange={() => setCategory(key as FeedbackCategory)} />{value}</label>)}</fieldset>
        <label>Фрагмент пояснения<Select aria-label="Фрагмент пояснения" value={fragment} onChange={setFragment} options={[{ value: '', label: 'Пояснение целиком' }, ...analysis.claims.map((claim, index) => ({ value: claim.id, label: `${index + 1}. ${claim.text.slice(0, 90)}${claim.text.length > 90 ? '…' : ''}` }))]} /></label>
        <label>Комментарий<textarea rows={4} minLength={5} maxLength={500} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Что стоит уточнить в тексте, источнике или маршруте?" /><span className="small muted">{comment.length}/500 · от 5 символов</span></label>
      </div>
    </Dialog>}
    {closingId && <Dialog title="Результат разбора" eyebrow="Учебная очередь замечаний" onClose={() => setClosingId(null)} footer={<Button onClick={closeFeedback}>Закрыть замечание</Button>}>
      <div className="stack"><Notice>Закрытие означает завершение разбора в демо, а не исправление медицинского ответа.</Notice>{queueError && <Notice tone="error">{queueError}</Notice>}
        <label>Результат разбора<textarea rows={4} maxLength={500} value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="Что проверили и какое решение приняли" /></label>
      </div>
    </Dialog>}
  </div>;
}
