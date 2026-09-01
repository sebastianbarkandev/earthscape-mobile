/** RESP-008: the LIVE pill does not pulse for users with Reduce Motion on. */
import React from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LiveBadge } from '../components/LiveBadge';

async function render(reduceMotion: boolean) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduceMotion);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  const loop = jest.spyOn(Animated, 'loop');
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<LiveBadge />); });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  return { r, loop };
}

describe('LiveBadge', () => {
  it('does not start the pulse loop under Reduce Motion', async () => {
    const { r, loop } = await render(true);
    expect(loop).not.toHaveBeenCalled();
    act(() => { r.unmount(); });
  });

  it('pulses (once the setting is known to be off)', async () => {
    const { r, loop } = await render(false);
    expect(loop).toHaveBeenCalledTimes(1);
    act(() => { r.unmount(); }); // stops the loop
  });

  it('is announced as "Live" and its label is capped for Dynamic Type', async () => {
    const { r } = await render(false);
    const badge = r.root.find((n) => typeof n.type === 'string' && n.props.accessibilityLabel === 'Live');
    expect(badge).toBeTruthy();
    const text = r.root.find((n) => typeof n.type === 'string' && n.type === 'Text');
    expect(text.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.5);
    act(() => { r.unmount(); });
  });
});
