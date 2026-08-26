import { dragClip, finalizeDrag, startDrag } from '../clippingMachine';

describe('clipping state machine (web dragClipmark port)', () => {
  it('extends the end while dragging right', () => {
    let d = startDrag({ time_start: 10, time_end: 10 }, 'end');
    d = dragClip(d, 15);
    expect(d).toMatchObject({ side: 'end', time_start: 10, time_end: 15 });
  });
  it('flips to the start side when dragging past the start', () => {
    let d = startDrag({ time_start: 10, time_end: 15 }, 'end');
    d = dragClip(d, 5);
    expect(d).toMatchObject({ side: 'start', time_start: 5, time_end: 15 });
    d = dragClip(d, 7);
    expect(d).toMatchObject({ side: 'start', time_start: 7, time_end: 15 });
  });
  it('flips back to the end side when dragging past the end', () => {
    let d = startDrag({ time_start: 10, time_end: 15 }, 'start');
    d = dragClip(d, 20);
    expect(d).toMatchObject({ side: 'end', time_start: 10, time_end: 20 });
  });
  it('moves the current side when inside the range', () => {
    const d = dragClip(startDrag({ time_start: 10, time_end: 20 }, 'end'), 12);
    expect(d).toMatchObject({ time_start: 10, time_end: 12 });
  });
  it('finalizes short drags as timepoints and longer ones as clips', () => {
    expect(finalizeDrag(startDrag({ time_start: 10, time_end: 10.5 }, 'end'))).toEqual({ time_start: 10, time_end: null, type: 'timepoint' });
    expect(finalizeDrag(startDrag({ time_start: 10, time_end: 11.5 }, 'end'))).toEqual({ time_start: 10, time_end: 11.5, type: 'clip' });
  });
});
