/**
 * Ambient types for react-test-renderer@19 — installed as a transitive dependency of
 * jest-expo, with no @types package (dependencies are frozen: native linking is fragile).
 * Only the surface the render tests use is declared.
 */
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export interface ReactTestInstance {
    /** Host string ('View', 'Text', …) or the composite component. */
    type: string | ((...args: unknown[]) => unknown) | object;
    props: Record<string, any>;
    parent: ReactTestInstance | null;
    children: Array<ReactTestInstance | string>;
    instance: unknown;
    find(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance;
    findAll(predicate: (node: ReactTestInstance) => boolean, options?: { deep: boolean }): ReactTestInstance[];
    findByType(type: unknown): ReactTestInstance;
    findAllByType(type: unknown, options?: { deep: boolean }): ReactTestInstance[];
    findByProps(props: Record<string, unknown>): ReactTestInstance;
    findAllByProps(props: Record<string, unknown>, options?: { deep: boolean }): ReactTestInstance[];
  }

  export interface ReactTestRendererJSON {
    type: string;
    props: Record<string, any>;
    children: null | Array<ReactTestRendererJSON | string>;
  }

  export interface ReactTestRenderer {
    root: ReactTestInstance;
    toJSON(): ReactTestRendererJSON | ReactTestRendererJSON[] | null;
    toTree(): unknown;
    update(element: ReactElement): void;
    unmount(): void;
    getInstance(): unknown;
  }

  export interface TestRendererOptions {
    createNodeMock?: (element: ReactElement) => unknown;
    unstable_isConcurrent?: boolean;
  }

  export function create(element: ReactElement, options?: TestRendererOptions): ReactTestRenderer;
  export function act(callback: () => Promise<void>): Promise<void>;
  export function act(callback: () => void): void;
}
