/** Shared chart styling so every tab uses one palette, font and axis style. */
export const C = {
  orange: '#EA7024',
  orangeSoft: '#F4A26F',
  orangeFaint: 'rgba(234,112,36,0.16)',
  green: '#175235',
  greenSoft: '#2E7D55',
  ink: '#333333',
  grey: '#8A9099',
  greyLight: '#DCDFE3',
  red: '#B42318',
  redFaint: 'rgba(180,35,24,0.10)',
  text: '#555B63',
};

export const FONT = "'Inter Variable', Inter, system-ui, sans-serif";

export const ANIM = {
  animationDuration: 400,
  animationDurationUpdate: 400,
  animationEasing: 'cubicOut',
  animationEasingUpdate: 'cubicOut',
} as const;

export const base = {
  textStyle: { fontFamily: FONT, color: C.text, fontSize: 11 },
  ...ANIM,
};

export const grid = (o: Partial<{ top: number; right: number; bottom: number; left: number }> = {}) => ({
  top: o.top ?? 16,
  right: o.right ?? 12,
  bottom: o.bottom ?? 28,
  left: o.left ?? 52,
});

export const axisCommon = {
  axisLine: { lineStyle: { color: C.greyLight } },
  axisTick: { show: false },
  axisLabel: { color: C.text, fontSize: 11, fontFamily: FONT },
  splitLine: { lineStyle: { color: '#EEF0F2' } },
};

export const tooltip = {
  trigger: 'axis' as const,
  backgroundColor: '#ffffff',
  borderColor: C.greyLight,
  textStyle: { color: C.ink, fontFamily: FONT, fontSize: 12 },
  extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-radius: 8px;',
};

export const moneyAxis = (fmt: (v: number) => string) => ({
  type: 'value' as const,
  ...axisCommon,
  axisLabel: { ...axisCommon.axisLabel, formatter: fmt },
});
