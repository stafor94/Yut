import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dismissGoldenYutPicker,
  EMPTY_GOLDEN_YUT_PICKER_PRESENTATION_STATE,
  markGoldenYutRollPresentationCompleted,
  shouldShowGoldenYutPicker,
  syncGoldenYutPickerOpenState,
} from '../../src/app/flows/goldenYutPickerPresentation.js';

test('golden yut picker stays dismissed when the same authoritative pending state reopens it', () => {
  const dismissed = dismissGoldenYutPicker();

  assert.equal(shouldShowGoldenYutPicker(dismissed, false), false);
  assert.equal(shouldShowGoldenYutPicker(dismissed, true), false);
  assert.deepEqual(syncGoldenYutPickerOpenState(dismissed, false), dismissed);
});

test('golden yut picker resets only after the selected roll presentation completes and pending closes', () => {
  const dismissed = dismissGoldenYutPicker();
  const completedWhileStillPending = markGoldenYutRollPresentationCompleted(dismissed);

  assert.equal(shouldShowGoldenYutPicker(completedWhileStillPending, true), false);
  assert.deepEqual(
    syncGoldenYutPickerOpenState(completedWhileStillPending, true),
    completedWhileStillPending,
  );

  const reset = syncGoldenYutPickerOpenState(completedWhileStillPending, false);
  assert.deepEqual(reset, EMPTY_GOLDEN_YUT_PICKER_PRESENTATION_STATE);
  assert.equal(shouldShowGoldenYutPicker(reset, true), true);
});

test('closing the picker before a roll finishes does not unlock a stale duplicate popup', () => {
  const dismissed = dismissGoldenYutPicker();
  const closedBeforeRollCompletion = syncGoldenYutPickerOpenState(dismissed, false);

  assert.deepEqual(closedBeforeRollCompletion, dismissed);
  assert.equal(shouldShowGoldenYutPicker(closedBeforeRollCompletion, true), false);
});
