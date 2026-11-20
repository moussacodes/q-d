import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/** A DOM node on web, or a host instance on React Native's new architecture. */
type Measurable = { getBoundingClientRect(): { height: number } };

const isMeasurable = (node: unknown): node is Measurable =>
  typeof (node as Partial<Measurable> | null)?.getBoundingClientRect === 'function';

/**
 * Height of a view, ready before the first paint. Pass `target` as the view's
 * ref and `onLayout` as its onLayout.
 *
 * onLayout alone arrives a frame or two after the view first draws, so anything
 * sized from it jumps. Web and React Native's new architecture both have layout
 * done by the time a layout effect runs, so the height is read there on mount and
 * whenever `watch` changes (pass what changes the view's content), and set before
 * the screen paints. onLayout catches every other change. A 0 reading (a hidden
 * screen, or Jest, which has no layout) is ignored.
 */
export function useMeasuredHeight(watch?: unknown) {
  const node = useRef<Measurable | null>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const measured = node.current?.getBoundingClientRect().height;
    if (measured) setHeight(measured);
  }, [watch]);

  const target = useCallback((instance: unknown) => {
    node.current = isMeasurable(instance) ? instance : null;
  }, []);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height;
    if (measured) setHeight(measured);
  }, []);

  return { height, target, onLayout };
}

/** What a view needs to report its height to `useMeasuredHeight`. */
export type HeightProbe = Pick<ReturnType<typeof useMeasuredHeight>, 'target' | 'onLayout'>;
