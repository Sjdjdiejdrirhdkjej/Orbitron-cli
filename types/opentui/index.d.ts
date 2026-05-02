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
}

declare module '@opentui/core' {
  export function createCliRenderer(options: { backgroundColor: string; exitOnCtrlC: boolean }): Promise<any>;
  export function createRoot(renderer: any): any;
}