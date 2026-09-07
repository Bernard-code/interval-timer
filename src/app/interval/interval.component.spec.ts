import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { IntervalComponent } from './interval.component';

describe('IntervalComponent', () => {
  let component: IntervalComponent;
  let now = 0;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IntervalComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(IntervalComponent);
    component = fixture.componentInstance;
    now = 0;
    spyOn(performance, 'now').and.callFake(() => now);
    spyOn(component as unknown as { playTone: () => void }, 'playTone');
    fixture.detectChanges();
  });

  afterEach(() => {
    component.reset();
  });

  it('plays a signal after a random interval, then waits for the break', fakeAsync(() => {
    component.setRoundMinutes(0);
    component.setRoundSeconds(10);
    component.setIntervalMin(2);
    component.setIntervalMax(2);
    component.setBreakSeconds(3);

    component.toggle();
    expect(component.phase()).toBe('interval');
    expect(component.drawnSeconds()).toBe(2);
    expect(component.running()).toBeTrue();

    now += 2000;
    tick(100);
    expect(component.signalCount()).toBe(1);
    expect(component.phase()).toBe('break');

    now += 3000;
    tick(100);
    expect(component.phase()).toBe('interval');
    expect(component.signalCount()).toBe(1);

    now += 2000;
    tick(100);
    expect(component.signalCount()).toBe(2);
    expect(component.phase()).toBe('break');

    now += 3000;
    tick(100);
    expect(component.phase()).toBe('done');
    expect(component.running()).toBeFalse();
    expect(component.signalCount()).toBe(2);
  }));
});
