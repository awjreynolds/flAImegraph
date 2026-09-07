'use client';
import { useEffect, useRef, useState } from 'react';
import graphSizes from '@/lib/operation-graphs.json';

/** Scale the containing iframe, preserving upstream SVG zoom coordinates. */
export function DollarFlamegraph({ source, title, search }: { source: string; title: string; search: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(400);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setAvailableWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const path = `${source}${availableWidth < 700 ? '-mobile' : ''}.svg`;
  const size = (graphSizes as Record<string, { width: number; height: number }>)[path];
  const scale = size ? availableWidth / size.width : 1;
  return <div ref={container} className="budget-flame-container" style={{ height: size ? Math.ceil(size.height * scale) : 220 }}>
    {size ? <iframe key={path} title={title} sandbox="allow-scripts" src={`${path}${search ? `?s=${encodeURIComponent(search)}` : ''}`} className="op-flamegraph" style={{ width: size.width, height: size.height, transform: `scale(${scale})`, transformOrigin: 'top left', display: 'block' }} /> : <p>This graph has no positive priced samples. The cost comparison retains known totals and unknowns.</p>}
  </div>;
}
