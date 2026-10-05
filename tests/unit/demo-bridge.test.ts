import { beforeEach, describe, expect, it } from 'vitest';
import { getActiveDemoBookings, getDemoActivities, publishDemoActivity, resetDemoBridge, sameDemoRouteStep } from '../../src/features/demo/bridge';
import type { DemoActivityInput } from '../../src/features/demo/bridge';

const vote: DemoActivityInput = {
  fixtureId: 'chest-referral', documentRevision: 1, contextRevision: 1,
  analysisId: 'demo-analysis-1', kind: 'patient_feedback_changed', value: 'helpful',
};
beforeEach(() => resetDemoBridge());

describe('same-tab synthetic activity bridge', () => {
  it('matches the same route across independently created role documents', () => {
    expect(sameDemoRouteStep('8bc1a858-1b4c-4cfb-86b8-c7166356aead:r1:pulmonology', 'ab16625b-e567-4651-a49f-fb4536cf985b:r1:pulmonology')).toBe(true);
    expect(sameDemoRouteStep('8bc1a858-1b4c-4cfb-86b8-c7166356aead:r1:therapy', 'ab16625b-e567-4651-a49f-fb4536cf985b:r1:pulmonology')).toBe(false);
    expect(sameDemoRouteStep(undefined, 'ab16625b-e567-4651-a49f-fb4536cf985b:r1:pulmonology')).toBe(false);
  });
  it('changes and withdraws a vote without duplicating it', () => {
    publishDemoActivity(vote);
    const id = getDemoActivities()[0].id;
    publishDemoActivity(vote);
    publishDemoActivity({ ...vote, value: 'unhelpful' });
    expect(getDemoActivities()).toHaveLength(1);
    expect(getDemoActivities()[0]).toMatchObject({ id, value: 'unhelpful' });
    publishDemoActivity({ ...vote, value: null });
    expect(getDemoActivities()).toHaveLength(1);
    expect(getDemoActivities().filter((item) => item.value)).toHaveLength(0);
  });
  it('keeps distinct revisions and resets only the requested scenario', () => {
    publishDemoActivity(vote);
    publishDemoActivity({ ...vote, documentRevision: 2 });
    publishDemoActivity({ ...vote, fixtureId: 'breast-referral' });
    expect(getDemoActivities()).toHaveLength(3);
    resetDemoBridge('chest-referral');
    expect(getDemoActivities().map((item) => item.fixtureId)).toEqual(['breast-referral']);
  });
  it('allows only prepared cases and copies no additional payload or personal text', () => {
    expect(() => publishDemoActivity({ ...vote, fixtureId: 'personal-document' })).toThrow();
    expect(() => publishDemoActivity({ ...vote, analysisId: 'patient@example.com' })).toThrow();
    expect(() => publishDemoActivity({ ...vote, documentRevision: 0 })).toThrow();
    publishDemoActivity({ ...vote, comment: 'Private text' } as DemoActivityInput);
    expect(getDemoActivities()[0]).not.toHaveProperty('comment');
  });
  it('counts a booking once and keeps other explicit bookings', () => {
    const booking: DemoActivityInput = { ...vote, kind: 'booking_confirmed', value: undefined, bookingId: 'booking-1', stepId: 'route-1' };
    publishDemoActivity(booking);
    publishDemoActivity(booking);
    publishDemoActivity({ ...booking, bookingId: 'booking-2', stepId: 'route-2' });
    expect(getDemoActivities()).toHaveLength(2);
  });
  it('cancels only the matching appointment and retains an auditable confirmation', () => {
    const booking: DemoActivityInput = { fixtureId: 'chest-referral', documentRevision: 1, contextRevision: 1, analysisId: 'analysis-1', kind: 'booking_confirmed', bookingId: 'booking-1', stepId: 'route-1' };
    publishDemoActivity(booking);
    publishDemoActivity({ ...booking, bookingId: 'booking-2' });
    publishDemoActivity({ ...booking, fixtureId: 'breast-referral' });
    publishDemoActivity({ ...booking, documentRevision: 2 });
    const cancellation = { ...booking, kind: 'booking_cancelled' as const, contextRevision: 3, analysisId: 'analysis-3' };
    publishDemoActivity(cancellation);
    publishDemoActivity(cancellation);
    expect(getDemoActivities()).toHaveLength(5);
    const active = getActiveDemoBookings(getDemoActivities());
    expect(active).toHaveLength(3);
    expect(active).toEqual(expect.arrayContaining([
      expect.objectContaining({ bookingId: 'booking-2' }),
      expect.objectContaining({ fixtureId: 'breast-referral', bookingId: 'booking-1' }),
      expect.objectContaining({ documentRevision: 2, bookingId: 'booking-1' }),
    ]));
    expect(getDemoActivities().filter(event => event.kind === 'booking_confirmed')).toHaveLength(4);
  });
  it('requires an exact appointment id for cancellation and permits a new appointment afterwards', () => {
    const booking: DemoActivityInput = { fixtureId: 'chest-referral', documentRevision: 1, kind: 'booking_confirmed', bookingId: 'booking-1', stepId: 'route-1' };
    expect(() => publishDemoActivity({ ...booking, kind: 'booking_cancelled', bookingId: undefined })).toThrow();
    publishDemoActivity(booking);
    publishDemoActivity({ ...booking, kind: 'booking_cancelled' });
    publishDemoActivity({ ...booking, bookingId: 'booking-2' });
    expect(getActiveDemoBookings(getDemoActivities()).map(event => event.bookingId)).toEqual(['booking-2']);
  });
});
