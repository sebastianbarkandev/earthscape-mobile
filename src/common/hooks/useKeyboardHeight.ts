import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Height of the on-screen keyboard, 0 when it is closed.
 *
 * `KeyboardAvoidingView` only moves what it wraps in normal layout flow. The Go Live
 * controls are `position: absolute; bottom: 0` over a full-bleed camera preview, so they
 * ignore it entirely and the keyboard covered the stream-name field and the Go live button
 * (UI-001). This gives the screen the number it needs to lift that bar itself.
 *
 * iOS uses the `will*` events so the lift animates with the keyboard; Android only has `did*`.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      const h = e?.endCoordinates?.height;
      setHeight(Number.isFinite(h) ? (h as number) : 0);
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
