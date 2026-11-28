import type { QualityLevel } from './protocol';

/** Receiver-side FPS and quality feedback. Times use the browser's monotonic clock only. */
export interface VideoPacingSample {
  nowMs: number;
  visible: boolean;
  decodedCount: number;
  inFlightFrames: number;
  oldestFrameAgeMs: number;
  decodeLatencyMs: number;
  backlogRecoveryCount: number;
}

export interface VideoPacingState {
  targetFps: number;
  effectiveFps: number;
  targetQuality?: QualityLevel;
  effectiveQuality?: QualityLevel;
  targetCustomQuality?: number;
  effectiveCustomQuality?: number;
  startedAt: number | null;
  lastSampleAt: number | null;
  lastDecodedCount: number;
  lastProgressAt: number | null;
  pressureSince: number | null;
  healthySince: number | null;
  lastAdjustmentAt: number;
  lastBacklogRecoveryCount: number | null;
  recentRecoveryTimes: number[];
}

export interface VideoPacingResult {
  state: VideoPacingState;
  fps?: number;
  quality?: QualityLevel;
  customQuality?: number;
}

const OVERLOAD_CONFIRM_MS = 750;
const ADJUSTMENT_COOLDOWN_MS = 2000;
const RECOVERY_CONFIRM_MS = 8000;
const ACTIVITY_WINDOW_MS = 1000;
const COLD_START_GRACE_MS = 2000;
const REPEATED_RECOVERY_WINDOW_MS = 4000;
const QUALITY_LADDER: readonly Exclude<QualityLevel, 'custom'>[] = ['low', 'balanced', 'best'];
const MIN_CUSTOM_QUALITY = 20;

function clampCustomQuality(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.round(value!) : 50;
  return Math.min(200, Math.max(MIN_CUSTOM_QUALITY, Math.round(n / 2) * 2));
}

export function createVideoPacing(
  targetFps: number,
  targetQuality?: QualityLevel,
  targetCustomQuality?: number,
): VideoPacingState {
  const cap = Number.isFinite(targetFps) ? Math.max(5, Math.min(120, Math.round(targetFps))) : 30;
  const customCap = targetQuality === 'custom' ? clampCustomQuality(targetCustomQuality) : undefined;
  return {
    targetFps: cap, effectiveFps: cap,
    targetQuality, effectiveQuality: targetQuality,
    targetCustomQuality: customCap, effectiveCustomQuality: customCap,
    startedAt: null, lastSampleAt: null,
    lastDecodedCount: 0, lastProgressAt: null, pressureSince: null,
    healthySince: null, lastAdjustmentAt: -Infinity,
    lastBacklogRecoveryCount: null, recentRecoveryTimes: [],
  };
}

export function advanceVideoPacing(
  previous: VideoPacingState,
  sample: VideoPacingSample,
): VideoPacingResult {
  const { nowMs, decodedCount, inFlightFrames, oldestFrameAgeMs, decodeLatencyMs } = sample;
  const state = { ...previous };
  const freshOutput = decodedCount > previous.lastDecodedCount;
  const clockGap = previous.lastSampleAt !== null &&
    (nowMs < previous.lastSampleAt || nowMs - previous.lastSampleAt > 1500);
  state.lastSampleAt = nowMs;
  state.lastDecodedCount = decodedCount;
  state.startedAt ??= nowMs;
  const recoveryCount = sample.backlogRecoveryCount;
  const newRecoveries = previous.lastBacklogRecoveryCount === null
    ? 0 : Math.max(0, recoveryCount - previous.lastBacklogRecoveryCount);
  state.lastBacklogRecoveryCount = recoveryCount;

  // Never count background time or an idle scheduler gap as evidence of load/recovery.
  if (!sample.visible || clockGap || decodedCount < previous.lastDecodedCount ||
    (previous.lastBacklogRecoveryCount !== null && recoveryCount < previous.lastBacklogRecoveryCount)) {
    state.pressureSince = state.healthySince = state.lastProgressAt = null;
    state.recentRecoveryTimes = [];
    state.startedAt = nowMs;
    return { state };
  }
  if (freshOutput) state.lastProgressAt = nowMs;
  const active = state.lastProgressAt !== null && nowMs - state.lastProgressAt <= ACTIVITY_WINDOW_MS;
  const warmingUp = decodedCount === 0 && nowMs - state.startedAt < COLD_START_GRACE_MS;
  state.recentRecoveryTimes = previous.recentRecoveryTimes
    .filter(time => nowMs - time <= REPEATED_RECOVERY_WINDOW_MS);
  for (let index = 0; index < Math.min(newRecoveries, 2); index++) state.recentRecoveryTimes.push(nowMs);
  state.recentRecoveryTimes = state.recentRecoveryTimes.slice(-2);
  // A successful keyframe recovery clears pending age/size. Repeated recoveries
  // are still overload, even when every 250ms sample catches a freshly empty codec.
  const repeatedRecovery = !warmingUp && state.recentRecoveryTimes.length >= 2;
  const overloaded = repeatedRecovery || (!warmingUp && inFlightFrames > 0 && (
    oldestFrameAgeMs >= 200 ||
    (inFlightFrames >= 4 && oldestFrameAgeMs >= 80) ||
    (freshOutput && inFlightFrames >= 2 && decodeLatencyMs >= 120)
  ));
  // A slow device can still recover from 5 FPS when its decode time fits the next
  // frame interval. A fixed 80ms ceiling would strand a healthy 90ms decoder there.
  const recoveryLatencyMs = Math.max(80, 800 / Math.min(state.targetFps, state.effectiveFps + 2));
  const healthy = newRecoveries === 0 && active && inFlightFrames <= 1 && oldestFrameAgeMs < 80 && decodeLatencyMs < recoveryLatencyMs;

  if (overloaded) {
    state.healthySince = null;
    state.pressureSince ??= nowMs;
    if ((repeatedRecovery || nowMs - state.pressureSince >= OVERLOAD_CONFIRM_MS) &&
      nowMs - state.lastAdjustmentAt >= ADJUSTMENT_COOLDOWN_MS) {
      state.pressureSince = null;

      // Sacrifice image quality first to preserve smoothness before reducing FPS.
      if (state.effectiveQuality === 'custom' && state.effectiveCustomQuality !== undefined &&
        state.effectiveCustomQuality > MIN_CUSTOM_QUALITY) {
        const nextCustom = Math.max(
          MIN_CUSTOM_QUALITY,
          Math.floor((state.effectiveCustomQuality * 0.75) / 2) * 2,
        );
        if (nextCustom < state.effectiveCustomQuality) {
          state.effectiveCustomQuality = nextCustom;
          state.lastAdjustmentAt = nowMs;
          state.recentRecoveryTimes = [];
          return { state, quality: 'custom', customQuality: nextCustom, fps: state.effectiveFps };
        }
      } else if (state.effectiveQuality && state.effectiveQuality !== 'custom') {
        const idx = QUALITY_LADDER.indexOf(state.effectiveQuality);
        if (idx > 0) {
          const nextQuality = QUALITY_LADDER[idx - 1];
          state.effectiveQuality = nextQuality;
          state.lastAdjustmentAt = nowMs;
          state.recentRecoveryTimes = [];
          return { state, quality: nextQuality, fps: state.effectiveFps };
        }
      }

      const fps = Math.max(5, Math.floor(state.effectiveFps * 0.75));
      if (fps < state.effectiveFps) {
        state.effectiveFps = fps;
        state.lastAdjustmentAt = nowMs;
        state.recentRecoveryTimes = [];
        return { state, fps };
      }
    }
  } else {
    state.pressureSince = null;
    if (healthy) {
      state.healthySince ??= nowMs;
      if (nowMs - state.healthySince >= RECOVERY_CONFIRM_MS) {
        if (state.effectiveFps < state.targetFps) {
          const fps = Math.min(state.targetFps, state.effectiveFps + 2);
          state.effectiveFps = fps;
          state.lastAdjustmentAt = nowMs;
          state.healthySince = nowMs;
          return { state, fps };
        }
        if (state.targetQuality === 'custom' && state.effectiveCustomQuality !== undefined &&
          state.targetCustomQuality !== undefined && state.effectiveCustomQuality < state.targetCustomQuality) {
          const nextCustom = Math.min(state.targetCustomQuality, state.effectiveCustomQuality + 20);
          state.effectiveCustomQuality = nextCustom;
          state.lastAdjustmentAt = nowMs;
          state.healthySince = nowMs;
          return { state, quality: 'custom', customQuality: nextCustom, fps: state.effectiveFps };
        }
        if (state.targetQuality && state.targetQuality !== 'custom' &&
          state.effectiveQuality && state.effectiveQuality !== 'custom') {
          const curIdx = QUALITY_LADDER.indexOf(state.effectiveQuality);
          const targetIdx = QUALITY_LADDER.indexOf(state.targetQuality);
          if (curIdx >= 0 && curIdx < targetIdx) {
            const nextQuality = QUALITY_LADDER[curIdx + 1];
            state.effectiveQuality = nextQuality;
            state.lastAdjustmentAt = nowMs;
            state.healthySince = nowMs;
            return { state, quality: nextQuality, fps: state.effectiveFps };
          }
        }
      }
    } else {
      state.healthySince = null;
    }
  }
  return { state };
}
