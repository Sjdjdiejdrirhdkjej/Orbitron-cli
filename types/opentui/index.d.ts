declare module '@opentui/react' {
  import React from 'react';

  export interface BoxProps extends React.HTMLAttributes<HTMLDivElement> {
    fg?: string;
    bg?: string;
    style?: React.CSSProperties;
  }

  export const box: React.FC<BoxProps>;

  export interface TextProps extends React.HTMLAttributes<HTMLSpanElement> {
    fg?: string;
    bg?: string;
    style?: React.CSSProperties;
  }

  export const text: React.FC<TextProps>;

  export function useKeyboard(handler: (key: {
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    sequence?: string;
    preventDefault?: () => void;
  }) => void): void;
}

declare module '@opentui/core' {
  export function createCliRenderer(options: { backgroundColor: string; exitOnCtrlC: boolean }): Promise<any>;
  export function createRoot(renderer: any): any;

  export const TextAttributes: {
    BOLD: number;
    DIM: number;
    ITALIC: number;
    UNDERLINE: number;
    BLINK: number;
    REVERSE: number;
    HIDDEN: number;
  };
}