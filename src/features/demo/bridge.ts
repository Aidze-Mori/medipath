import { useSyncExternalStore } from 'react';
import { SYNTHETIC_FIXTURES } from '../../domain';

export type DemoActivityKind =
  | 'patient_feedback_changed'
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'recommendation_deferred'
  | 'result_opened'
  | 'explanation_viewed'
  | 'route_viewed'
  | 'doctor_picker_opened';

export interface DemoActivityInput {
  fixtureId: string;
  documentRevision: number;
  contextRevision?: number;
  analysisId?: string;
  kind: DemoActivityKind;
  value?: 'helpful' | 'unhelpful' | null;
  stepId?: string;
  bookingId?: string;
}
export interface DemoActivity extends DemoActivityInput {
  id: string;
  at: string;
}

let activities: readonly DemoActivity[] = [];
const listeners = new Set<() => void>();
const fixtureIds = new Set(SYNTHETIC_FIXTURES.map((fixture) => fixture.id));
const kinds = new Set<DemoActivityKind>([
  'patient_feedback_changed', 'booking_confirmed', 'booking_cancelled', 'recommendation_deferred',
  'result_opened', 'explanation_viewed', 'route_viewed', 'doctor_picker_opened',
]);
const safeId = (value: string | undefined) => value === undefined || /^[a-zA-Z0-9:_-]{1,160}$/.test(value);

function activityKey(activity: DemoActivityInput) {
  return [activity.fixtureId, activity.documentRevision, activity.contextRevision ?? 1,
    activity.analysisId ?? '', activity.kind,
    (activity.kind === 'booking_confirmed' || activity.kind === 'booking_cancelled') ? activity.bookingId ?? activity.stepId ?? '' : activity.stepId ?? '',
  ].join('|');
}

/** In-memory, same-tab demo events only. No document text, comments, or personal identifiers. */
export function publishDemoActivity(input: DemoActivityInput): void {
  if (!fixtureIds.has(input.fixtureId) || !kinds.has(input.kind)
    || !Number.isSafeInteger(input.documentRevision) || input.documentRevision < 1
    || (input.contextRevision !== undefined && (!Number.isSafeInteger(input.contextRevision) || input.contextRevision < 1))
    || (input.kind === 'booking_cancelled' && !input.bookingId)
    || !safeId(input.analysisId) || !safeId(input.stepId) || !safeId(input.bookingId)
    || (input.value !== undefined && input.value !== null && input.value !== 'helpful' && input.value !== 'unhelpful')) {
    throw new Error('В учебный журнал можно добавлять только события подготовленного сценария.');
  }
  const key = activityKey(input);
  const previous = activities.find((event) => activityKey(event) === key);
  if (previous && previous.value === input.value) return;
  // Copy only the closed contract, never arbitrary properties from a caller.
  const event: DemoActivity = {
    id: previous?.id ?? crypto.randomUUID(), at: new Date().toISOString(),
    fixtureId: input.fixtureId, documentRevision: input.documentRevision, kind: input.kind,
    ...(input.contextRevision !== undefined ? { contextRevision: input.contextRevision } : {}),
    ...(input.analysisId !== undefined ? { analysisId: input.analysisId } : {}),
    ...(input.value !== undefined ? { value: input.value } : {}),
    ...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
    ...(input.bookingId !== undefined ? { bookingId: input.bookingId } : {}),
  };
  activities = [...activities.filter((item) => activityKey(item) !== key), event];
  listeners.forEach((listener) => listener());
}

export function resetDemoBridge(fixtureId?: string): void {
  activities = fixtureId ? activities.filter((event) => event.fixtureId !== fixtureId) : [];
  listeners.forEach((listener) => listener());
}

export function getDemoActivities(): readonly DemoActivity[] { return activities; }

/** A cancellation is tied to one appointment, independent of the current analysis context. */
export function getActiveDemoBookings(events: readonly DemoActivity[]): DemoActivity[] {
  return events.filter(event => event.kind === 'booking_confirmed' && !events.some(cancellation =>
    cancellation.kind === 'booking_cancelled' && cancellation.fixtureId === event.fixtureId
    && cancellation.documentRevision === event.documentRevision && cancellation.bookingId === event.bookingId,
  ));
}


// Independent roles instantiate the same fixture with different local document IDs.
// Compare only after the caller has matched the fixture and document revision.
export function sameDemoRouteStep(first: string | undefined, second: string): boolean {
  if (!first) return false;
  const suffix = (value: string) => value.replace(/^[a-f0-9-]{36}:r[1-9]\d*:/i, '');
  return suffix(first) === suffix(second);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useDemoActivities(): readonly DemoActivity[] {
  return useSyncExternalStore(subscribe, getDemoActivities, getDemoActivities);
}
