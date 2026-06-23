#!/usr/bin/env tsx
/**
 * HTML to JSX converter for Claude Design template
 * Converts inline style="..." attributes to JSX style={{ }} format
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const CSS_PROPERTY_MAP: Record<string, string> = {
  // Add more mappings as needed
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

// Read the HTML file
const htmlPath = resolve(process.argv[2] || '.moai/design/cd-source.html');
const outputPath = resolve(process.argv[3] || 'src/components/ClaudeDesignApp.tsx');

const html = readFileSync(htmlPath, 'utf-8');

// Extract content inside <x-dc>...</x-dc>
const match = html.match(/<x-dc>([\s\S]*)<\/x-dc>/);
if (!match) {
  console.error('Could not find <x-dc> wrapper in HTML');
  process.exit(1);
}

const content = match[1];

// Convert to JSX
const jsx = convertHtmlToJsx(content);

// Write output
writeFileSync(outputPath, jsx, 'utf-8');
console.log(`✅ Converted ${htmlPath} -> ${outputPath}`);
