import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
  SVGRenderer,
]);

export type ChartOption = EChartsCoreOption;

/**
 * Thin ECharts wrapper. Series keep stable `id`s so a new result animates from the
 * previous values instead of redrawing (fan chart, histogram, waterfall).
 * A chart error is contained to this panel and never blanks the app.
 */
export function Chart({ option, height = 220, ariaLabel }: { option: ChartOption; height?: number; ariaLabel: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'svg' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    try {
      c.setOption(option, { replaceMerge: ['series'] });
      setFailed(false);
    } catch (e) {
      console.error('Chart render failed', e);
      try {
        c.clear();
      } catch {
        /* chart already disposed */
      }
      setFailed(true);
    }
  }, [option]);

  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
      <div ref={el} style={{ height, width: '100%' }} role="img" aria-label={ariaLabel} />
      {failed && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--ink-600)' }}>
          This chart couldn’t be drawn for these values.
        </div>
      )}
    </div>
  );
}
