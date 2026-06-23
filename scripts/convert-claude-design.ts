#!/usr/bin/env tsx
/**
 * Claude Design HTML to JSX converter
 * Converts all three viewport templates with proper handlers and state
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const CSS_PROPERTY_MAP: Record<string, string> = {
  'background': 'backgroundColor',
  'border-radius': 'borderRadius',
  'box-shadow': 'boxShadow',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'letter-spacing': 'letterSpacing',
  'line-height': 'lineHeight',
  'text-align': 'textAlign',
  'text-transform': 'textTransform',
  'white-space': 'whiteSpace',
  'word-break': 'wordBreak',
  '-webkit-font-smoothing': 'WebkitFontSmoothing',
  '-webkit-tap-highlight-color': 'WebkitTapHighlightColor',
  '-webkit-overflow-scrolling': 'WebkitOverflowScrolling',
};

function convertCssProperty(prop: string): string {
  const camelCase = prop.replace(/-([a-z])/g, (_: string, letter: string) => letter.toUpperCase());
  return CSS_PROPERTY_MAP[prop] || camelCase;
}

function convertStyleAttribute(styleStr: string): string {
  if (!styleStr) return '{}';

  const properties = styleStr.split(';').filter(s => s.trim());
  const obj = properties.map(prop => {
    const [key, ...valueParts] = prop.split(':');
    const value = valueParts.join(':').trim();
    if (!key || !value) return null;

    const jsxKey = convertCssProperty(key.trim());
    return `    "${jsxKey}": "${value}"`;
  }).filter(Boolean);

  return `{\n${obj.join(',\n')}\n  }`;
}

function convertHtmlToJsx(html: string): string {
  let jsx = html;

  // Convert style="..." to style={{ }}
  jsx = jsx.replace(/style="([^"]*)"/g, (match, styleStr) => {
    return `style=${convertStyleAttribute(styleStr)}`;
  });

  // Convert class= to className=
  jsx = jsx.replace(/\bclass=/g, 'className=');

  // Convert for= to htmlFor= (in labels)
  jsx = jsx.replace(/\bfor=/g, 'htmlFor=');

  // Convert colspan to colSpan
  jsx = jsx.replace(/\bcolspan=/g, 'colSpan=');

  // Convert rowspan to rowSpan
  jsx = jsx.replace(/\browspan=/g, 'rowSpan=');

  // Self-close void elements
  const voidElements = ['input', 'img', 'br', 'hr', 'meta', 'link'];
  voidElements.forEach(tag => {
    jsx = jsx.replace(new RegExp(`<${tag}([^>]*)>`, 'g'), `<${tag}$1 />`);
  });

  // Replace {{ variable }} placeholders with {variable}
  jsx = jsx.replace(/\{\{([^}]+)\}\}/g, '{$1}');

  // Replace onclick="{{ handler }}" with onClick={handler}
  jsx = jsx.replace(/onclick="\{\{([^}]+)\}\}"/g, (match, handler) => {
    return `onClick={${handler.trim()}}`;
  });

  // Replace onchange="{{ handler }}" with onChange={handler}
  jsx = jsx.replace(/onchange="\{\{([^}]+)\}\}"/g, (match, handler) => {
    return `onChange={${handler.trim()}}`;
  });

  // Replace onkeydown="{{ handler }}" with onKeyDown={handler}
  jsx = jsx.replace(/onkeydown="\{\{([^}]+)\}\}"/g, (match, handler) => {
    return `onKeyDown={${handler.trim()}}`;
  });

  // Replace value="{{ variable }}" with value={variable}
  jsx = jsx.replace(/value="\{\{([^}]+)\}\}"/g, (match, variable) => {
    return `value={${variable.trim()}}`;
  });

  // Replace data-* attributes
  jsx = jsx.replace(/data-([a-z-]+)="([^"]*)"/g, (match: string, name: string, value: string) => {
    const camelName = name.replace(/-([a-z])/g, (_match: string, letter: string) => letter.toUpperCase());
    return `data-${camelName}="${value}"`;
  });

  return jsx;
}

function wrapAsComponent(
  jsx: string,
  componentName: string,
  screenTypes: string[]
): string {
  const screenUnion = screenTypes.map(s => `'${s}'`).join('  \n    | ');

  return `"use client";

import { useState, useCallback } from 'react';
import { NOTICES, SUGGESTIONS, getTimelineColors, getTabStyles, getCatTabStyles, type Screen } from './demo-data';

export default function ${componentName}() {
  const [screen, setScreen] = useState<Screen>('login');
  const [selectedNotice, setSelectedNotice] = useState<typeof NOTICES[0] | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<typeof SUGGESTIONS[0] | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [activeCat, setActiveCat] = useState('all');

  const navigate = useCallback((newScreen: Screen) => {
    setScreen(newScreen);
  }, []);

  const handleNoticeClick = useCallback((notice: typeof NOTICES[0]) => {
    setSelectedNotice(notice);
    navigate('noticeDetail');
  }, [navigate]);

  const handleSuggestionClick = useCallback((suggestion: typeof SUGGESTIONS[0]) => {
    setSelectedSuggestion(suggestion);
    navigate('suggestionDetail');
  }, [navigate]);

  const goHome = useCallback(() => navigate('home'), [navigate]);
  const goLogin = useCallback(() => navigate('login'), [navigate]);
  const goNotices = useCallback(() => navigate('notices'), [navigate]);
  const goSuggestions = useCallback(() => navigate('suggestions'), [navigate]);
  const goParking = useCallback(() => navigate('parking'), [navigate]);
  const goMypage = useCallback(() => navigate('mypage'), [navigate]);
  const goAdmin = useCallback(() => navigate('admin'), [navigate]);
  const goBack = useCallback(() => {
    if (screen === 'noticeDetail') navigate('notices');
    else if (screen === 'suggestionDetail') navigate('suggestions');
    else navigate('home');
  }, [screen, navigate]);

  // Screen rendering
  const renderScreen = () => {
    switch (screen) {
${jsx}
      default:
        return null;
    }
  };

  return renderScreen();
}
`;
}

// Main conversion
const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: tsx convert-claude-design.ts <input.html> <output.tsx> <ComponentName> [screenTypes...]');
  process.exit(1);
}

const [inputPath, outputPath, componentName, ...screenTypes] = args;
const html = readFileSync(resolve(inputPath), 'utf-8');

// Extract content inside <x-dc>...</x-dc>
const match = html.match(/<x-dc>([\s\S]*)<\/x-dc>/);
if (!match) {
  console.error('Could not find <x-dc> wrapper in HTML');
  process.exit(1);
}

const content = match[1];

// Convert to JSX
const jsx = convertHtmlToJsx(content);

// Parse screen-specific blocks from the converted JSX
const screenBlocks: string[] = [];
const screenRegex = /<!-- screen: (\w+) -->([\s\S]*?)<!-- end screen -->/g;

let screenMatch;
while ((screenMatch = screenRegex.exec(jsx)) !== null) {
  const screenName = screenMatch[1];
  const screenContent = screenMatch[2].trim();
  screenBlocks.push(`      case '${screenName}':\n        return (\n          ${screenContent.split('\n').join('\n          ')}\n        );`);
}

// If no screen markers found, treat entire content as login screen
if (screenBlocks.length === 0) {
  screenBlocks.push(`      case 'login':\n      case 'signup':\n      case 'verify':\n        return (\n          ${jsx.split('\n').join('\n          ')}\n        );`);
}

// Wrap as component
const componentCode = wrapAsComponent(screenBlocks.join('\n'), componentName, screenTypes);

// Write output
writeFileSync(resolve(outputPath), componentCode, 'utf-8');
console.log(`✅ Converted ${inputPath} -> ${outputPath}`);
console.log(`   Component: ${componentName}`);
console.log(`   Screens: ${screenTypes.join(', ')}`);
