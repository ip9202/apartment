/**
 * useViewport hook
 * Detects viewport width for responsive design
 * SSR-safe: defaults to 'desktop' on server, corrects on mount
 */

import { useState, useEffect } from 'react';

export type ViewportType = 'mobile' | 'tablet' | 'desktop';

export function useViewport() {
  const [viewport, setViewport] = useState<ViewportType>('desktop');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const updateViewport = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setViewport('mobile');
      } else if (width < 1024) {
        setViewport('tablet');
      } else {
        setViewport('desktop');
      }
    };

    updateViewport();
    window.addEventListener('resize', updateViewport);

    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  return { viewport, mounted };
}
