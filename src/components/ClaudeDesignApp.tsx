"use client";

import { useState, useEffect } from 'react';
import { useViewport, type ViewportType } from './useViewport';
import { type Screen } from './demo-data';
import MobileApp from './MobileApp';
import TabletApp from './TabletApp';
import DesktopApp from './DesktopApp';

/**
 * ClaudeDesignApp - Responsive router
 * Switches between viewport-specific components:
 * - MobileApp: login/signup/verify screens only (390px phone frame)
 * - TabletApp: full app for tablet and mobile non-auth screens (fluid layout)
 * - DesktopApp: full app with sidebar for desktop (256px sidebar + 1000px main)
 */
export default function ClaudeDesignApp() {
  const { viewport, mounted } = useViewport();
  const [currentScreen, setCurrentScreen] = useState<Screen>('login');

  // Sync screen state between components (simplified - state may reset on viewport change)
  useEffect(() => {
    // In production, you'd lift state to a context or use URL-based routing
    // For this demo, it's acceptable that state resets on viewport change
  }, [viewport]);

  // Hydration handling - avoid flash of wrong content
  if (!mounted) {
    return null; // or render a neutral loading div
  }

  // Responsive matrix:
  // - width < 768px (mobile):
  //   - On login/verify screens → render MOBILE template
  //   - On other screens → render TABLET template (fluid enough)
  // - 768px ≤ width < 1024px (tablet): render TABLET template
  // - width ≥ 1024px (desktop): render DESKTOP template

  if (viewport === 'mobile') {
    // Mobile: use MobileApp for auth screens, TabletApp for others
    if (['login', 'signup', 'verify'].includes(currentScreen)) {
      return <MobileApp />;
    }
    // For non-auth screens on mobile, use TabletApp (fluid layout)
    return <TabletApp />;
  }

  if (viewport === 'tablet') {
    // Tablet: always use TabletApp
    return <TabletApp />;
  }

  // Desktop: always use DesktopApp
  return <DesktopApp />;
}
