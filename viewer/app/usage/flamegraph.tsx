'use client';
import { useEffect, useRef, useState } from 'react';
export function UsageFlamegraph({ example }: { example: 'native' | 'files' }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(node); return () => observer.disconnect();
  }, []);
  const narrow = width > 0 && width < 650, originalWidth = narrow ? 400 : 1400;
  const height = example === 'native' ? 172 : 252;
  const scale = width ? width / originalWidth : 1;
  return <div ref={container} style={{ width: '100%', overflow: 'hidden', height: width ? height * scale : height, position: 'relative', background: '#fff', borderRadius: 8 }}><iframe title="Interactive upstream usage flame graph" src={`/usage-${example}${narrow ? '-mobile' : ''}.svg`} style={{ border: 0, width: originalWidth, height, position: 'absolute', transform: `scale(${scale})`, transformOrigin: 'top left' }} /></div>;
}
