import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';

export type RoundPhase = 'idle' | 'interval' | 'break' | 'done';

@Component({
  selector: 'app-interval',
  templateUrl: './interval.component.html',
  styleUrl: './interval.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntervalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private timerId: ReturnType<typeof setInterval> | null = null;
  private pulseId: ReturnType<typeof setTimeout> | null = null;
  private endToneId: ReturnType<typeof setTimeout> | null = null;
  private audioCtx: AudioContext | null = null;
  private lastTickAt = 0;
  private totalRoundMs = 0;

  public readonly roundMinutes = signal(5);
  public readonly roundSeconds = signal(0);
  public readonly intervalMin = signal(2);
  public readonly intervalMax = signal(10);
  public readonly breakSeconds = signal(3);

  public readonly phase = signal<RoundPhase>('idle');
  public readonly running = signal(false);
  public readonly pulse = signal(false);
  public readonly signalCount = signal(0);
  public readonly drawnHundredths = signal<number | null>(null);
  public readonly drawHistory = signal<string[]>([]);
  public readonly roundRemainingMs = signal(0);
  public readonly phaseRemainingMs = signal(0);

  public readonly drawnSeconds = computed(() => {
    const hundredths = this.drawnHundredths();
    return hundredths === null ? null : hundredths / 100;
  });

  public readonly roundLabel = computed(() => this.formatMs(this.roundDurationMs()));

  public readonly displayTime = computed(() => {
    if (this.phase() === 'idle') {
      return this.formatMs(this.roundDurationMs());
    }
    return this.formatMs(this.roundRemainingMs());
  });

  public readonly phaseTime = computed(() => this.formatMs(this.phaseRemainingMs()));

  public readonly drawnLabel = computed(() => {
    const hundredths = this.drawnHundredths();
    return hundredths === null ? '' : this.formatHundredths(hundredths);
  });

  public readonly progress = computed(() => {
    if (this.phase() === 'idle' || this.totalRoundMs <= 0) {
      return 100;
    }
    return Math.max(0, Math.min(100, (this.roundRemainingMs() / this.totalRoundMs) * 100));
  });

  public readonly intervalRangeLabel = computed(() => {
    const { lo, hi } = this.intervalBounds();
    return `${lo}–${hi} s`;
  });

  public readonly phaseChip = computed(() => {
    switch (this.phase()) {
      case 'interval':
        return 'Sygnał';
      case 'break':
        return 'Przerwa';
      case 'done':
        return 'Koniec';
      default:
        return 'Gotowe';
    }
  });

  public readonly signalLabel = computed(() => this.pluralizeSignals(this.signalCount()));

  public readonly canStart = computed(() => this.roundDurationMs() > 0);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.stopTimer();
      this.clearPulse();
      this.clearEndTone();
      void this.audioCtx?.close();
    });
  }

  public onNumberChange(event: Event, writer: (value: number) => void): void {
    writer(Number((event.target as HTMLInputElement).value));
  }

  public readonly setRoundMinutes = (value: number): void => {
    this.roundMinutes.set(this.clamp(value, 0, 180));
  };

  public readonly setRoundSeconds = (value: number): void => {
    this.roundSeconds.set(this.clamp(value, 0, 59));
  };

  public readonly setIntervalMin = (value: number): void => {
    this.intervalMin.set(this.clamp(value, 1, 600));
  };

  public readonly setIntervalMax = (value: number): void => {
    this.intervalMax.set(this.clamp(value, 1, 600));
  };

  public readonly setBreakSeconds = (value: number): void => {
    this.breakSeconds.set(this.clamp(value, 0, 600));
  };

  public toggle(): void {
    if (this.running()) {
      this.pause();
      return;
    }
    this.start();
  }

  public reset(): void {
    this.stopTimer();
    this.clearPulse();
    this.clearEndTone();
    this.running.set(false);
    this.phase.set('idle');
    this.pulse.set(false);
    this.signalCount.set(0);
    this.drawnHundredths.set(null);
    this.drawHistory.set([]);
    this.roundRemainingMs.set(0);
    this.phaseRemainingMs.set(0);
    this.totalRoundMs = 0;
  }

  private start(): void {
    if (!this.isBrowser || !this.canStart()) {
      return;
    }

    void this.ensureAudio()?.resume();

    if (this.phase() === 'idle' || this.phase() === 'done') {
      this.totalRoundMs = this.roundDurationMs();
      this.roundRemainingMs.set(this.totalRoundMs);
      this.signalCount.set(0);
      this.beginInterval();
    }

    this.running.set(true);
    this.lastTickAt = performance.now();
    this.stopTimer();
    this.timerId = setInterval(() => this.tick(), 10);
  }

  private pause(): void {
    this.stopTimer();
    this.running.set(false);
  }

  private tick(): void {
    const now = performance.now();
    const delta = Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;
    this.advance(delta);
  }

  private advance(deltaMs: number): void {
    const roundNext = Math.max(0, this.roundRemainingMs() - deltaMs);
    const consumed = this.roundRemainingMs() - roundNext;
    this.roundRemainingMs.set(roundNext);
    if (roundNext <= 0) {
      this.finishRound();
      return;
    }

    let budget = consumed;
    let steps = 0;
    while (budget > 0 && this.phase() !== 'done' && steps < 40) {
      steps += 1;
      const phaseLeft = this.phaseRemainingMs();
      if (phaseLeft > budget) {
        this.phaseRemainingMs.set(phaseLeft - budget);
        break;
      }
      budget -= phaseLeft;
      this.phaseRemainingMs.set(0);
      this.completePhase();
    }
  }

  private completePhase(): void {
    if (this.phase() === 'interval') {
      this.playSignal();
      this.signalCount.update((count) => count + 1);
      this.flash();
      this.beginBreak();
      return;
    }

    if (this.phase() === 'break') {
      this.beginInterval();
    }
  }

  private beginInterval(): void {
    const hundredths = this.randomHundredths();
    this.phase.set('interval');
    this.drawnHundredths.set(hundredths);
    this.phaseRemainingMs.set(hundredths * 10);
    this.drawHistory.update((items) => [...items, this.formatHundredths(hundredths)]);
  }

  private beginBreak(): void {
    const seconds = this.breakSeconds();
    if (seconds <= 0) {
      this.beginInterval();
      return;
    }
    this.phase.set('break');
    this.phaseRemainingMs.set(seconds * 1000);
  }

  private finishRound(): void {
    this.stopTimer();
    this.running.set(false);
    this.phase.set('done');
    this.roundRemainingMs.set(0);
    this.phaseRemainingMs.set(0);
    this.playEndSignal();
  }

  private roundDurationMs(): number {
    return (this.roundMinutes() * 60 + this.roundSeconds()) * 1000;
  }

  private intervalBounds(): { lo: number; hi: number } {
    const min = this.intervalMin();
    const max = this.intervalMax();
    return { lo: Math.min(min, max), hi: Math.max(min, max) };
  }

  private randomHundredths(): number {
    const { lo, hi } = this.intervalBounds();
    const min = lo * 100;
    const max = hi * 100;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  private flash(): void {
    this.clearPulse();
    this.pulse.set(true);
    this.pulseId = setTimeout(() => {
      this.pulse.set(false);
      this.pulseId = null;
    }, 420);
  }

  private clearPulse(): void {
    if (this.pulseId !== null) {
      clearTimeout(this.pulseId);
      this.pulseId = null;
    }
  }

  private stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private ensureAudio(): AudioContext | null {
    if (!this.isBrowser) {
      return null;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return null;
    }
    this.audioCtx ??= new AudioCtx();
    return this.audioCtx;
  }

  private playSignal(): void {
    this.playTone(880, 0.22, 0.18);
  }

  private playEndSignal(): void {
    this.playTone(523, 0.18, 0.16);
    this.clearEndTone();
    this.endToneId = setTimeout(() => {
      this.playTone(392, 0.28, 0.18);
      this.endToneId = null;
    }, 180);
  }

  private clearEndTone(): void {
    if (this.endToneId !== null) {
      clearTimeout(this.endToneId);
      this.endToneId = null;
    }
  }

  private pluralizeSignals(count: number): string {
    if (count === 1) {
      return '1 sygnał';
    }
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return `${count} sygnały`;
    }
    return `${count} sygnałów`;
  }

  private playTone(frequency: number, duration: number, volume: number): void {
    const ctx = this.ensureAudio();
    if (!ctx) {
      return;
    }

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration + 0.02);
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(max, Math.max(min, Math.floor(value)));
  }

  private formatMs(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${this.pad2(minutes)}:${this.pad2(seconds)}`;
  }

  private formatHundredths(hundredths: number): string {
    return `${Math.floor(hundredths / 100)},${this.pad2(hundredths % 100)}`;
  }

  private pad2(value: number): string {
    return value.toString().padStart(2, '0');
  }
}
