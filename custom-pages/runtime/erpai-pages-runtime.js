/**
 * ERPAI Pages Runtime — JavaScript SDK
 * Shared API layer, UI helpers, and utilities for custom HTML pages.
 * Namespace: window.erpai
 * v1.0.0
 */
(function () {
  'use strict';

  // ===== TABLER ICONS =====
  // Inline Tabler icon catalog (24x24 viewBox). Use erpai.icon(name, opts).
  var TABLER_ICONS = {
    'activity': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12h4l3 8l4-16l3 8h4"/>',
    'adjustments': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 10a2 2 0 1 0 4 0a2 2 0 0 0-4 0m2-6v4m0 4v8m4-4a2 2 0 1 0 4 0a2 2 0 0 0-4 0m2-12v10m0 4v2m4-13a2 2 0 1 0 4 0a2 2 0 0 0-4 0m2-3v1m0 4v11"/>',
    'adjustments-horizontal': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M4 6h8m4 0h4M6 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0m-2 0h2m4 0h10m-5 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M4 18h11m4 0h1"/>',
    'alert-circle': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0m9-4v4m0 4h.01"/>',
    'archive': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2m2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8m-9 4h4"/>',
    'arrow-down': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m6-6l-6 6m-6-6l6 6"/>',
    'arrow-left': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12l6 6m-6-6l6-6"/>',
    'arrow-narrow-right': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14m-4 4l4-4m-4-4l4 4"/>',
    'arrow-right': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14m-6 6l6-6m-6-6l6 6"/>',
    'arrow-up': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m6-8l-6-6m-6 6l6-6"/>',
    'arrows-maximize': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 4h4v4m-6 2l6-6M8 20H4v-4m0 4l6-6m6 6h4v-4m-6-2l6 6M8 4H4v4m0-4l6 6"/>',
    'arrows-minimize': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 9h4V5M3 3l6 6m-4 6h4v4m-6 2l6-6m10-6h-4V5m0 4l6-6m-2 12h-4v4m0-4l6 6"/>',
    'arrows-sort': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m3 9l4-4l4 4M7 5v14m14-4l-4 4l-4-4m4 4V5"/>',
    'award': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M6 9a6 6 0 1 0 12 0A6 6 0 1 0 6 9"/><path d="m12 15l3.4 5.89l1.598-3.233l3.598.232l-3.4-5.889M6.802 12l-3.4 5.89L7 17.657l1.598 3.232l3.4-5.889"/></g>',
    'bell': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6M9 17v1a3 3 0 0 0 6 0v-1"/>',
    'bell-ringing': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6M9 17v1a3 3 0 0 0 6 0v-1m6-10.273A11.05 11.05 0 0 0 18.206 3M3 6.727A11.05 11.05 0 0 1 5.792 3"/>',
    'book': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0M3 6v13m9-13v13m9-13v13"/>',
    'book-2': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M19 4v16H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M19 16H7a2 2 0 0 0-2 2M9 8h6"/></g>',
    'bookmark': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 7v14l-6-4l-6 4V7a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4"/>',
    'bookmark-filled': '<path fill="currentColor" d="M14 2a5 5 0 0 1 5 5v14a1 1 0 0 1-1.555.832L12 18.202l-5.444 3.63a1 1 0 0 1-1.55-.72L5 21V7a5 5 0 0 1 5-5z"/>',
    'books': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M5 5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zm4 0a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1zM5 8h4m0 8h4"/><path d="m13.803 4.56l2.184-.53c.562-.135 1.133.19 1.282.732l3.695 13.418a1.02 1.02 0 0 1-.634 1.219l-.133.041l-2.184.53c-.562.135-1.133-.19-1.282-.732L13.036 5.82a1.02 1.02 0 0 1 .634-1.219zM14 9l4-1m-2 8l3.923-.98"/></g>',
    'brand-github': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2c2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2a4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6c-.6.6-.6 1.2-.5 2V21"/>',
    'brand-google': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.945 11a9 9 0 1 1-3.284-5.997l-2.655 2.392A5.5 5.5 0 1 0 17.125 14H13v-3z"/>',
    'brush': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 21v-4a4 4 0 1 1 4 4z"/><path d="M21 3A16 16 0 0 0 8.2 13.2M21 3a16 16 0 0 1-10.2 12.8"/><path d="M10.6 9a9 9 0 0 1 4.4 4.4"/></g>',
    'building': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21h18M9 8h1m-1 4h1m-1 4h1m4-8h1m-1 4h1m-1 4h1M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/>',
    'building-bank': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21h18M3 10h18M5 6l7-3l7 3M4 10v11m16-11v11M8 14v3m4-3v3m4-3v3"/>',
    'building-community': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m8 9l5 5v7H8v-4m0 4H3v-7l5-5m1 1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17h-8m0-14v.01M17 7v.01M17 11v.01M17 15v.01"/>',
    'bulb': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12h1m8-9v1m8 8h1M5.6 5.6l.7.7m12.1-.7l-.7.7M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0-1 3a2 2 0 0 1-4 0a3.5 3.5 0 0 0-1-3m.7 1h4.6"/>',
    'calculator': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 8a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1zm0 6v.01m4-.01v.01m4-.01v.01M8 17v.01m4-.01v.01m4-.01v.01"/></g>',
    'calendar': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm12-4v4M8 3v4m-4 4h16m-9 4h1m0 0v3"/>',
    'calendar-event': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm12-4v4M8 3v4m-4 4h16"/><path d="M8 15h2v2H8z"/></g>',
    'calendar-month': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm12-4v4M8 3v4m-4 4h16M8 14v4m4-4v4m4-4v4"/>',
    'calendar-stats': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M11.795 21H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4m-1 3v4h4"/><path d="M14 18a4 4 0 1 0 8 0a4 4 0 1 0-8 0m1-15v4M7 3v4m-4 4h16"/></g>',
    'calendar-time': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M11.795 21H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M14 18a4 4 0 1 0 8 0a4 4 0 1 0-8 0m1-15v4M7 3v4m-4 4h16"/><path d="M18 16.496V18l1 1"/></g>',
    'camera': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M5 7h1a2 2 0 0 0 2-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2"/><path d="M9 13a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/></g>',
    'certificate': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 15a3 3 0 1 0 6 0a3 3 0 1 0-6 0"/><path d="M13 17.5V22l2-1.5l2 1.5v-4.5"/><path d="M10 19H5a2 2 0 0 1-2-2V7c0-1.1.9-2 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-1 1.73M6 9h12M6 12h3m-3 3h2"/></g>',
    'chart-arcs': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0"/><path d="M16.924 11.132a5 5 0 1 0-4.056 5.792"/><path d="M3 12a9 9 0 1 0 9-9"/></g>',
    'chart-bar': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 13a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm12-4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM9 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM4 20h14"/>',
    'chart-donut': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10 3.2A9 9 0 1 0 20.8 14a1 1 0 0 0-1-1H16a4.1 4.1 0 1 1-5-5V4a.9.9 0 0 0-1-.8"/><path d="M15 3.5A9 9 0 0 1 20.5 9H16a9 9 0 0 0-1-1z"/></g>',
    'chart-line': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 19h16M4 15l4-6l4 2l4-5l4 4"/>',
    'chart-pie': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10 3.2A9 9 0 1 0 20.8 14a1 1 0 0 0-1-1H13a2 2 0 0 1-2-2V4a.9.9 0 0 0-1-.8"/><path d="M15 3.5A9 9 0 0 1 20.5 9H16a1 1 0 0 1-1-1z"/></g>',
    'chart-pie-2': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 3v9h9"/><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0"/></g>',
    'check': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/>',
    'checks': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m7 12l5 5L22 7M2 12l5 5m5-5l5-5"/>',
    'chevron-down': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9l6 6l6-6"/>',
    'chevron-left': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 6l-6 6l6 6"/>',
    'chevron-right': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 6l6 6l-6 6"/>',
    'chevron-up': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 15l6-6l6 6"/>',
    'circle': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0"/>',
    'circle-check': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0"/><path d="m9 12l2 2l4-4"/></g>',
    'circle-dot': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0"/><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0"/></g>',
    'circle-x': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0m7-2l4 4m0-4l-4 4"/>',
    'clipboard': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2"/></g>',
    'clipboard-copy': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3m9-9V7a2 2 0 0 0-2-2h-2m-2 12v-1a1 1 0 0 1 1-1h1m3 0h1a1 1 0 0 1 1 1v1m0 3v1a1 1 0 0 1-1 1h-1m-3 0h-1a1 1 0 0 1-1-1v-1"/><path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2"/></g>',
    'clipboard-list': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2m0 7h.01M13 12h2m-6 4h.01M13 16h2"/></g>',
    'clipboard-text': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2m0 7h6m-6 4h6"/></g>',
    'clock': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0"/><path d="M12 7v5l3 3"/></g>',
    'clock-hour-3': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0m9 0h3.5M12 7v5"/>',
    'cloud': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6.657 18C4.085 18 2 15.993 2 13.517s2.085-4.482 4.657-4.482c.393-1.762 1.794-3.2 3.675-3.773c1.88-.572 3.956-.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486s-1.551 3.487-3.465 3.487H6.657"/>',
    'coin': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0"/><path d="M14.8 9A2 2 0 0 0 13 8h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1-1.8-1M12 7v10"/></g>',
    'copy': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M7 9.667A2.667 2.667 0 0 1 9.667 7h8.666A2.667 2.667 0 0 1 21 9.667v8.666A2.667 2.667 0 0 1 18.333 21H9.667A2.667 2.667 0 0 1 7 18.333z"/><path d="M4.012 16.737A2 2 0 0 1 3 15V5c0-1.1.9-2 2-2h10c.75 0 1.158.385 1.5 1"/></g>',
    'credit-card': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm0 2h18M7 15h.01M11 15h2"/>',
    'currency-dollar': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16.7 8A3 3 0 0 0 14 6h-4a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6h-4a3 3 0 0 1-2.7-2M12 3v3m0 12v3"/>',
    'dots': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0"/>',
    'dots-vertical': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0m0 7a1 1 0 1 0 2 0a1 1 0 1 0-2 0m0-14a1 1 0 1 0 2 0a1 1 0 1 0-2 0"/>',
    'download': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5l5-5m-5-7v12"/>',
    'droplet': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7.502 19.423c2.602 2.105 6.395 2.105 8.996 0s3.262-5.708 1.566-8.546l-4.89-7.26c-.42-.625-1.287-.803-1.936-.397a1.4 1.4 0 0 0-.41.397l-4.893 7.26C4.24 13.715 4.9 17.318 7.502 19.423"/>',
    'external-link': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6m-7 1l9-9m-5 0h5v5"/>',
    'eye': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0-4 0"/><path d="M21 12q-3.6 6-9 6t-9-6q3.6-6 9-6t9 6"/></g>',
    'eye-off': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10.585 10.587a2 2 0 0 0 2.829 2.828"/><path d="M16.681 16.673A8.7 8.7 0 0 1 12 18q-5.4 0-9-6q1.908-3.18 4.32-4.674m2.86-1.146A9 9 0 0 1 12 6q5.4 0 9 6q-1 1.665-2.138 2.87M3 3l18 18"/></g>',
    'file': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2"/></g>',
    'file-text': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2M9 9h1m-1 4h6m-6 4h6"/></g>',
    'files': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M15 3v4a1 1 0 0 0 1 1h4"/><path d="M18 17h-7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l5 5v7a2 2 0 0 1-2 2"/><path d="M16 17v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2"/></g>',
    'filter': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4h16v2.172a2 2 0 0 1-.586 1.414L15 12v7l-6 2v-8.5L4.52 7.572A2 2 0 0 1 4 6.227z"/>',
    'filter-cog': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m12 20l-3 1v-8.5L4.52 7.572A2 2 0 0 1 4 6.227V4h16v2.172a2 2 0 0 1-.586 1.414L15 12v1.5m2.001 5.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0m2-3.5V17m0 4v1.5m3.031-5.25l-1.299.75m-3.463 2l-1.3.75m0-3.5l1.3.75m3.463 2l1.3.75"/>',
    'flame': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10.941c2.333-3.308.167-7.823-1-8.941c0 3.395-2.235 5.299-3.667 6.706C5.903 10.114 5 12 5 14.294C5 17.998 8.134 21 12 21s7-3.002 7-6.706c0-1.712-1.232-4.403-2.333-5.588c-2.084 3.353-3.257 3.353-4.667 2.235"/>',
    'folder': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2"/>',
    'gift': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 9a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm9-1v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7m2.5-4a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5a2.5 2.5 0 0 1 0 5"/></g>',
    'grid-dots': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 1 0 2 0a1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M4 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M4 19a1 1 0 1 0 2 0a1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0"/>',
    'hash': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 9h14M5 15h14M11 4L7 20M17 4l-4 16"/>',
    'heart': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.5 12.572L12 20l-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.572"/>',
    'help': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0m9 5v.01"/><path d="M12 13.5a1.5 1.5 0 0 1 1-1.5a2.6 2.6 0 1 0-3-4"/></g>',
    'home': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M5 12H3l9-9l9 9h-2M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/><path d="M9 21v-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6"/></g>',
    'home-2': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M5 12H3l9-9l9 9h-2M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/><path d="M10 12h4v4h-4z"/></g>',
    'hourglass': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M6.5 7h11m-11 10h11M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1"/><path d="M6 4v2a6 6 0 1 0 12 0V4a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1"/></g>',
    'id': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="M7 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0m8-2h2m-2 4h2M7 16h10"/></g>',
    'id-badge': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M5 6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/><path d="M10 13a2 2 0 1 0 4 0a2 2 0 1 0-4 0m0-7h4M9 18h6"/></g>',
    'inbox': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13h3l3 3h4l3-3h3"/></g>',
    'info-circle': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0m9-3h.01"/><path d="M11 12h1v4h1"/></g>',
    'key': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1-4.069 0l-.301-.301l-6.558 6.558a2 2 0 0 1-1.239.578L5.172 21H4a1 1 0 0 1-.993-.883L3 20v-1.172a2 2 0 0 1 .467-1.284l.119-.13L4 17h2v-2h2v-2l2.144-2.144l-.301-.301a2.877 2.877 0 0 1 0-4.069l2.643-2.643a2.877 2.877 0 0 1 4.069 0M15 9h.01"/>',
    'language': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M9 6.371C9 10.789 6.761 13 4 13m0-6.629h7"/><path d="M5 9c0 2.144 2.252 3.908 6 4m1 7l4-9l4 9m-.9-2h-6.2M6.694 3l.793.582"/></g>',
    'layers-intersect': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M8 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2z"/><path d="M4 10a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></g>',
    'layout-dashboard': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1m0 12h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1m10-4h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1m0-8h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1"/>',
    'layout-grid': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM4 15a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z"/>',
    'layout-list': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm0 10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
    'link': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 15l6-6m-4-3l.463-.536a5 5 0 0 1 7.071 7.072L18 13m-5 5l-.397.534a5.07 5.07 0 0 1-7.127 0a4.97 4.97 0 0 1 0-7.071L6 11"/>',
    'list': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 6h11M9 12h11M9 18h11M5 6v.01M5 12v.01M5 18v.01"/>',
    'list-details': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5h8m-8 4h5m-5 6h8m-8 4h5M3 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm0 10a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
    'lock': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0-2 0m-3-5V7a4 4 0 1 1 8 0v4"/></g>',
    'lock-open': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M11 16a1 1 0 1 0 2 0a1 1 0 1 0-2 0m-3-5V6a4 4 0 0 1 8 0"/></g>',
    'lock-square-rounded': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9s-9-1.8-9-9s1.8-9 9-9"/><path d="M8 12a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1zm2-1V9a2 2 0 1 1 4 0v2"/></g>',
    'mail': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m3 7l9 6l9-6"/></g>',
    'map': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m3 7l6-3l6 3l6-3v13l-6 3l-6-3l-6 3zm6-3v13m6-10v13"/>',
    'map-pin': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/><path d="M17.657 16.657L13.414 20.9a2 2 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0"/></g>',
    'medal': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v3M8 4v6m8-6v6m-4 8.5L9 20l.5-3.5l-2-2l3-.5l1.5-3l1.5 3l3 .5l-2 2L15 20z"/>',
    'menu-2': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>',
    'message': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9h8m-8 4h6m4-9a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/>',
    'message-circle': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m3 20l1.3-3.9C1.976 12.663 2.874 8.228 6.4 5.726c3.526-2.501 8.59-2.296 11.845.48c3.255 2.777 3.695 7.266 1.029 10.501S11.659 20.922 7.7 19z"/>',
    'messages': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 14l-3-3h-7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1zm-7 1v2a1 1 0 0 1-1 1H6l-3 3V11a1 1 0 0 1 1-1h2"/>',
    'microphone': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M9 5a3 3 0 0 1 3-3a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3a3 3 0 0 1-3-3z"/><path d="M5 10a7 7 0 0 0 14 0M8 21h8m-4-4v4"/></g>',
    'minus': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14"/>',
    'moon': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3h.393a7.5 7.5 0 0 0 7.92 12.446A9 9 0 1 1 12 2.992z"/>',
    'music': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0-6 0m10 0a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/><path d="M9 17V4h10v13M9 8h10"/></g>',
    'palette': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 21a9 9 0 0 1 0-18c4.97 0 9 3.582 9 8c0 1.06-.474 2.078-1.318 2.828S17.693 15 16.5 15H14a2 2 0 0 0-1 3.75A1.3 1.3 0 0 1 12 21"/><path d="M7.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0m4-3a1 1 0 1 0 2 0a1 1 0 1 0-2 0m4 3a1 1 0 1 0 2 0a1 1 0 1 0-2 0"/></g>',
    'paperclip': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3L18 10a3 3 0 0 0-6-6l-6.5 6.5a4.5 4.5 0 0 0 9 9L21 13"/>',
    'pencil': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 20h4L18.5 9.5a2.828 2.828 0 1 0-4-4L4 16zm9.5-13.5l4 4"/>',
    'phone': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    'photo': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M15 8h.01M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="m3 16l5-5c.928-.893 2.072-.893 3 0l5 5"/><path d="m14 14l1-1c.928-.893 2.072-.893 3 0l3 3"/></g>',
    'plus': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14"/>',
    'receipt': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-3-2l-2 2l-2-2l-2 2l-2-2zM9 7h6m-6 4h6m-2 4h2"/>',
    'refresh': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4m-4 4a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
    'reload': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M19.933 13.041a8 8 0 1 1-9.925-8.788c3.899-1 7.935 1.007 9.425 4.747"/><path d="M20 4v5h-5"/></g>',
    'school': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M22 9L12 5L2 9l10 4zv6"/><path d="M6 10.6V16a6 3 0 0 0 12 0v-5.4"/></g>',
    'scissors': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a3 3 0 1 0 6 0a3 3 0 1 0-6 0m0 10a3 3 0 1 0 6 0a3 3 0 1 0-6 0m5.6-8.4L19 19M8.6 15.4L19 5"/>',
    'search': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0m18 11l-6-6"/>',
    'settings': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/></g>',
    'share': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0m12-6a3 3 0 1 0 6 0a3 3 0 1 0-6 0m0 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0m-6.3-7.3l6.6-3.4m-6.6 6l6.6 3.4"/>',
    'shield': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3a12 12 0 0 0 8.5 3A12 12 0 0 1 12 21A12 12 0 0 1 3.5 6A12 12 0 0 0 12 3"/>',
    'shopping-bag': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M6.331 8H17.67a2 2 0 0 1 1.977 2.304l-1.255 8.152A3 3 0 0 1 15.426 21H8.574a3 3 0 0 1-2.965-2.544l-1.255-8.152A2 2 0 0 1 6.331 8"/><path d="M9 11V6a3 3 0 0 1 6 0v5"/></g>',
    'shopping-cart': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M4 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0m11 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"/><path d="M17 17H6V3H4"/><path d="m6 5l14 1l-1 7H6"/></g>',
    'sort-ascending': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h7m-7 6h7m-7 6h9m2-9l3-3l3 3m-3-3v12"/>',
    'sort-descending': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h9m-9 6h7m-7 6h7m4-3l3 3l3-3m-3-9v12"/>',
    'square': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'star': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m12 17.75l-6.172 3.245l1.179-6.873l-5-4.867l6.9-1l3.086-6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z"/>',
    'star-filled': '<path fill="currentColor" d="m8.243 7.34l-6.38.925l-.113.023a1 1 0 0 0-.44 1.684l4.622 4.499l-1.09 6.355l-.013.11a1 1 0 0 0 1.464.944l5.706-3l5.693 3l.1.046a1 1 0 0 0 1.352-1.1l-1.091-6.355l4.624-4.5l.078-.085a1 1 0 0 0-.633-1.62l-6.38-.926l-2.852-5.78a1 1 0 0 0-1.794 0z"/>',
    'star-half': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m12 17.75l-6.172 3.245l1.179-6.873l-5-4.867l6.9-1l3.086-6.253z"/>',
    'sun': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0m-5 0h1m8-9v1m8 8h1m-9 8v1M5.6 5.6l.7.7m12.1-.7l-.7.7m0 11.4l.7.7m-12.1-.7l-.7.7"/>',
    'tag': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0"/><path d="M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592-5.592a2.41 2.41 0 0 0 0-3.408l-7.71-7.71A2 2 0 0 0 11.172 3H6a3 3 0 0 0-3 3"/></g>',
    'thumb-down': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 13V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1za4 4 0 0 1 4 4v1a2 2 0 0 0 4 0v-5h3a2 2 0 0 0 2-2l-1-5a2 3 0 0 0-2-2h-7a3 3 0 0 0-3 3"/>',
    'thumb-up': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1za4 4 0 0 0 4-4V6a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1-2 2h-7a3 3 0 0 1-3-3"/>',
    'trash': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16m-10 4v6m4-6v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>',
    'trending-down': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m3 7l6 6l4-4l8 8"/><path d="M21 10v7h-7"/></g>',
    'trending-up': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m3 17l6-6l4 4l8-8"/><path d="M14 7h7v7"/></g>',
    'triangle': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.363 3.591L2.257 17.125a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636-2.87L13.637 3.59a1.914 1.914 0 0 0-3.274 0"/>',
    'trophy': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 21h8m-4-4v4M7 4h10m0 0v8a5 5 0 0 1-10 0V4M3 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0m14 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"/>',
    'unlink': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 22v-2m-8-5l6-6m-4-3l.463-.536a5 5 0 0 1 7.071 7.072L18 13m-5 5l-.397.534a5.07 5.07 0 0 1-7.127 0a4.97 4.97 0 0 1 0-7.071L6 11m14 6h2M2 7h2m3-5v2"/>',
    'upload': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 9l5-5l5 5m-5-5v12"/>',
    'user': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>',
    'user-circle': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0"/><path d="M9 10a3 3 0 1 0 6 0a3 3 0 1 0-6 0m-2.832 8.849A4 4 0 0 1 10 16h4a4 4 0 0 1 3.834 2.855"/></g>',
    'user-minus': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0M6 21v-2a4 4 0 0 1 4-4h4q.523.002 1.009.128M16 19h6"/>',
    'user-plus': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0m8 12h6m-3-3v6M6 21v-2a4 4 0 0 1 4-4h4"/>',
    'user-star': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0M6 21v-2a4 4 0 0 1 4-4h.5m7.3 5.817l-2.172 1.138a.392.392 0 0 1-.568-.41l.415-2.411l-1.757-1.707a.389.389 0 0 1 .217-.665l2.428-.352l1.086-2.193a.392.392 0 0 1 .702 0l1.086 2.193l2.428.352a.39.39 0 0 1 .217.665l-1.757 1.707l.414 2.41a.39.39 0 0 1-.567.411z"/>',
    'user-x': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0M6 21v-2a4 4 0 0 1 4-4h3.5m8.5 7l-5-5m0 5l5-5"/>',
    'users': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m1-17.87a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85"/>',
    'users-group': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 13a2 2 0 1 0 4 0a2 2 0 0 0-4 0m-2 8v-1a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1M15 5a2 2 0 1 0 4 0a2 2 0 0 0-4 0m2 5h2a2 2 0 0 1 2 2v1M5 5a2 2 0 1 0 4 0a2 2 0 0 0-4 0m-2 8v-1a2 2 0 0 1 2-2h2"/>',
    'users-plus': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0M3 21v-2a4 4 0 0 1 4-4h4c.96 0 1.84.338 2.53.901M16 3.13a4 4 0 0 1 0 7.75M16 19h6m-3-3v6"/>',
    'video': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14zM3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'wallet': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M17 8V5a1 1 0 0 0-1-1H6a2 2 0 0 0 0 4h12a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V6"/><path d="M20 12v4h-4a2 2 0 0 1 0-4z"/></g>',
    'world': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0m.6-3h16.8M3.6 15h16.8"/><path d="M11.5 3a17 17 0 0 0 0 18m1-18a17 17 0 0 1 0 18"/></g>',
    'x': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M6 6l12 12"/>',
    'zoom-in': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0m4 0h6m-3-3v6m11 8l-6-6"/>',
    'zoom-out': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0m4 0h6m8 11l-6-6"/>'
  };

  /**
   * Render a Tabler icon as inline SVG string.
   * @param {string} name - icon name (e.g. "users", "calendar-event")
   * @param {object} [opts] - { size = 16, className = "", color = "currentColor", strokeWidth }
   * @returns {string} HTML string of <svg>
   */
  function icon(name, opts) {
    opts = opts || {};
    var size = opts.size || 16;
    var cls = opts.className || "";
    var color = opts.color || "currentColor";
    var sw = opts.strokeWidth;
    var body = TABLER_ICONS[name];
    if (!body) {
      console.warn("[erpai.icon] Unknown icon:", name);
      // Render a placeholder square so layout doesn\'t break
      body = '<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>';
    }
    if (sw != null) {
      body = body.replace(/stroke-width="\d+(?:\.\d+)?"/g, 'stroke-width="' + sw + '"');
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" style="color:' + color + ';flex-shrink:0;display:inline-block;vertical-align:middle" class="erpai-icon ' + cls + '">' + body + '</svg>';
  }

  /** Returns true if a Tabler icon name exists in the catalog. */
  function hasIcon(name) { return Object.prototype.hasOwnProperty.call(TABLER_ICONS, name); }

  /** Returns the list of all available Tabler icon names. */
  function listIcons() { return Object.keys(TABLER_ICONS).sort(); }

  // ===== CONFIG =====
  const cfg = window.ERPAI || {};
  const TOKEN = cfg.token;
  const BASE_URL = cfg.baseUrl;
  const APP_ID = cfg.appId;
  const ORG_NAME = cfg.orgName;
  const APP_NAME = cfg.appName;
  const THEME = cfg.theme;

  // ===== THEME APPLICATION =====
  // Default is light (no class). Add .dark for dark mode.
  // Matches erpai-dev: light by default, .dark class on <html> for dark.
  if (THEME === 'dark') {
    document.documentElement.classList.add('dark');
  } else if (THEME === 'system' || !THEME) {
    // Follow system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
    // Listen for system changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        document.documentElement.classList.toggle('dark', e.matches);
      });
    }
  }
  // 'light' → no class needed (default)

  // ===== CONFIG VALIDATION =====
  function assertConfig() {
    if (!TOKEN || !BASE_URL || !APP_ID) {
      const el = document.getElementById('app');
      if (el) el.innerHTML = '<div class="error-container"><h3>Missing Configuration</h3><p>window.ERPAI must provide token, baseUrl, and appId.</p></div>';
      throw new Error('window.ERPAI not configured — need token, baseUrl, appId');
    }
  }

  // ===== API LAYER =====

  /** Core fetch wrapper with auth */
  async function api(method, path, body) {
    assertConfig();
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${res.statusText}${text ? ' — ' + text.slice(0, 200) : ''}`);
    }
    return res.json();
  }

  /** Execute SQL query, returns { rows, fields, rowCount } */
  async function runSQL(query) {
    const json = await api('POST', '/v1/agent/app/sql/execute', {
      appId: APP_ID, sqlQuery: query, limit: 1000
    });
    if (!json.success) throw new Error(json.message || 'SQL query failed');
    return json.data;
  }

  /** Get all tables with columnsMetaData */
  async function getTables() {
    const res = await api('GET', `/v1/app-builder/table?appId=${APP_ID}`);
    return res.data;
  }

  /** Get single table metadata */
  async function getTable(tableId) {
    return api('GET', `/v1/app-builder/table/${tableId}`);
  }

  /** Fetch paginated records. filter = { filterCriteria?, q? } */
  async function getRecords(tableId, pageNo, pageSize, filter) {
    if (pageNo === undefined) pageNo = 1;
    if (pageSize === undefined) pageSize = 50;
    let url = `/v1/app-builder/table/${tableId}/paged-record?appId=${APP_ID}&pageNo=${pageNo}&pageSize=${pageSize}`;
    if (filter && filter.q) url += `&q=${encodeURIComponent(filter.q)}`;
    return api('POST', url, filter && filter.filterCriteria ? { filterCriteria: filter.filterCriteria } : {});
  }

  /** Create a record. cells = { columnId: value } */
  async function createRecord(tableId, cells) {
    return api('POST', `/v1/app-builder/table/${tableId}/record?appId=${APP_ID}`, { cells });
  }

  /** Update a record. cells = { columnId: newValue } */
  async function updateRecord(tableId, recordId, cells) {
    return api('PUT', `/v1/app-builder/table/${tableId}/record/${recordId}?appId=${APP_ID}`, { cells });
  }

  /** Delete a record */
  async function deleteRecord(tableId, recordId) {
    return api('DELETE', `/v1/app-builder/table/${tableId}/record/${recordId}?appId=${APP_ID}`);
  }

  /** Get a single record by ID (fetchAllRef expands reference display values) */
  async function getRecordById(tableId, recordId) {
    var res = await api('GET', `/v1/app-builder/table/${tableId}/record/${recordId}?appId=${APP_ID}&fetchAllRef=true`);
    return Array.isArray(res) ? res[0] : res;
  }

  /** Get SQL schema (view names + columns) */
  async function getSQLSchema() {
    return api('GET', `/v1/agent/app/sql/tables?appId=${APP_ID}`);
  }

  // ===== NAVIGATION =====

  /** Build an ERPAI app route URL */
  function erpaiUrl(path) {
    return `/-/${ORG_NAME}/${APP_NAME}/${APP_ID}${path}`;
  }

  /** Navigate the parent frame to an ERPAI route */
  function navigateTo(path) {
    window.parent.location.href = erpaiUrl(path);
  }

  // ===== FORMATTERS =====

  /** XSS-safe text escaping */
  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  /** Format currency: $1,234 */
  function fmt$(n) {
    return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  /** Format percentage: 42% */
  function fmtPct(n) {
    return parseFloat(n || 0).toFixed(0) + '%';
  }

  /** Format number with optional decimals */
  function fmtNum(n, decimals) {
    if (decimals === undefined) decimals = 0;
    return Number(n || 0).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /** Format date: Jan 15, 2026 */
  function fmtDate(d, opts) {
    if (!d) return '—';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** Format a cell value based on column type */
  function formatCell(value, type, column) {
    if (value == null || value === '') return '<span style="color:var(--text-muted);">—</span>';

    switch (type) {
      case 'number':
        return typeof value === 'number' ? fmtNum(value) : String(value);
      case 'currency':
        return fmt$(value);
      case 'date':
        return fmtDate(value);
      case 'checkbox':
        return Array.isArray(value) && value[0] === 1 ? '&#10003;' : '&#10007;';
      case 'rating':
        return '&#9733;'.repeat(Number(value) || 0);
      case 'select': {
        if (Array.isArray(value) && column && column.options) {
          const opt = column.options.find(function (o) { return o.id === value[0]; });
          return '<span class="badge badge-accent">' + esc(opt ? opt.name : String(value[0])) + '</span>';
        }
        return '<span class="badge badge-accent">' + esc(String(value)) + '</span>';
      }
      case 'multi_select': {
        if (Array.isArray(value) && column && column.options) {
          return value.map(function (v) {
            var opt = column.options.find(function (o) { return o.id === v; });
            return '<span class="badge badge-green" style="margin-right:4px;">' + esc(opt ? opt.name : String(v)) + '</span>';
          }).join('');
        }
        return Array.isArray(value) ? value.map(function (v) { return '<span class="badge badge-green" style="margin-right:4px;">' + esc(String(v)) + '</span>'; }).join('') : esc(String(value));
      }
      case 'ref':
      case 'reference':
        return Array.isArray(value) ? value.length + ' ref(s)' : esc(String(value));
      case 'email':
        return '<a href="mailto:' + esc(value) + '" class="erpai-link">' + esc(value) + '</a>';
      case 'url':
        return '<a href="' + esc(value) + '" target="_blank" class="erpai-link">' + esc(value) + '</a>';
      case 'phone':
        return '<a href="tel:' + esc(value) + '" class="erpai-link">' + esc(value) + '</a>';
      case 'rich_text':
        return value;
      default:
        return esc(String(value));
    }
  }

  // ===== THEME COLORS (for Chart.js) =====

  function getThemeColors() {
    var s = getComputedStyle(document.documentElement);
    return {
      text: s.getPropertyValue('--text').trim(),
      muted: s.getPropertyValue('--text-muted').trim(),
      border: s.getPropertyValue('--border').trim(),
      accent: s.getPropertyValue('--accent').trim(),
      green: s.getPropertyValue('--green').trim(),
      amber: s.getPropertyValue('--amber').trim(),
      red: s.getPropertyValue('--red').trim(),
      cyan: s.getPropertyValue('--cyan').trim(),
      purple: s.getPropertyValue('--purple').trim(),
      surface: s.getPropertyValue('--surface').trim(),
      bg: s.getPropertyValue('--bg').trim()
    };
  }

  // ===== UI HELPERS =====

  /** Render a stat card into a container */
  function renderStatCard(containerId, opts) {
    var title = opts.title, value = opts.value, sub = opts.sub, change = opts.change, color = opts.color;
    var changeHtml = '';
    if (change !== undefined && change !== null) {
      var cls = change >= 0 ? 'stat-change-up' : 'stat-change-down';
      var arrow = change >= 0 ? '&uarr;' : '&darr;';
      changeHtml = '<div class="stat-change ' + cls + '">' + arrow + ' ' + Math.abs(change).toFixed(1) + '%</div>';
    }
    var subHtml = sub ? '<div class="stat-sub">' + esc(sub) + '</div>' : '';
    var colorStyle = color ? ' style="color:' + color + ';"' : '';
    document.getElementById(containerId).innerHTML =
      '<div class="stat-label">' + esc(title) + '</div>' +
      '<div class="stat-value"' + colorStyle + '>' + value + '</div>' +
      subHtml + changeHtml;
  }

  /** Render pagination controls */
  function renderPagination(containerId, opts) {
    var page = opts.page, total = opts.total, pageSize = opts.pageSize, onChange = opts.onChange;
    var totalPages = Math.ceil(total / pageSize);
    var el = document.getElementById(containerId);
    if (!el) return;
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    var start = (page - 1) * pageSize + 1;
    var end = Math.min(page * pageSize, total);

    el.innerHTML =
      '<div class="pagination">' +
        '<span class="pagination-info">' + start + '–' + end + ' of ' + fmtNum(total) + '</span>' +
        '<div class="pagination-buttons">' +
          '<button class="btn btn-secondary btn-sm" id="' + containerId + '-first"' + (page === 1 ? ' disabled' : '') + '>&laquo;</button>' +
          '<button class="btn btn-secondary btn-sm" id="' + containerId + '-prev"' + (page === 1 ? ' disabled' : '') + '>&lsaquo;</button>' +
          '<span class="text-small" style="padding:4px 8px;">' + page + ' / ' + totalPages + '</span>' +
          '<button class="btn btn-secondary btn-sm" id="' + containerId + '-next"' + (page === totalPages ? ' disabled' : '') + '>&rsaquo;</button>' +
          '<button class="btn btn-secondary btn-sm" id="' + containerId + '-last"' + (page === totalPages ? ' disabled' : '') + '>&raquo;</button>' +
        '</div>' +
      '</div>';

    document.getElementById(containerId + '-first').onclick = function () { onChange(1); };
    document.getElementById(containerId + '-prev').onclick = function () { onChange(page - 1); };
    document.getElementById(containerId + '-next').onclick = function () { onChange(page + 1); };
    document.getElementById(containerId + '-last').onclick = function () { onChange(totalPages); };
  }

  /** Create debounced search helper */
  function createSearch(inputEl, callback, delay) {
    if (delay === undefined) delay = 300;
    var timeout;
    inputEl.addEventListener('input', function () {
      clearTimeout(timeout);
      var val = inputEl.value;
      timeout = setTimeout(function () { callback(val); }, delay);
    });
  }

  /**
   * createDropdown — custom styled dropdown replacing native <select>
   * @param {HTMLElement|string} container - Element or selector to mount into
   * @param {Object} opts
   * @param {Array<{value:string, label:string}>} opts.options - choices
   * @param {string} [opts.value] - initial selected value
   * @param {string} [opts.placeholder] - placeholder text (default "Select…")
   * @param {boolean} [opts.searchable] - show search input (default: auto if >6 options)
   * @param {function(string, string)} [opts.onChange] - callback(value, label)
   * @returns {{ getValue, setValue, setOptions, destroy }}
   */
  function createDropdown(container, opts) {
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) return null;
    opts = opts || {};
    var options = opts.options || [];
    var selectedValue = opts.value !== undefined ? opts.value : '';
    var placeholder = opts.placeholder || 'Select\u2026';
    var searchable = opts.searchable !== undefined ? opts.searchable : options.length > 6;
    var onChange = opts.onChange || function () {};

    // SVG icons
    var chevronSVG = '<svg class="dd-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
    var checkSVG = '<svg class="dd-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';

    // Build DOM
    var root = document.createElement('div');
    root.className = 'erpai-dropdown';

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'erpai-dropdown-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    var menu = document.createElement('div');
    menu.className = 'erpai-dropdown-menu';
    menu.setAttribute('role', 'listbox');

    var searchInput = null;
    if (searchable) {
      searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'erpai-dropdown-search';
      searchInput.placeholder = 'Search\u2026';
      menu.appendChild(searchInput);
    }

    var listWrap = document.createElement('div');
    listWrap.className = 'erpai-dropdown-list';
    menu.appendChild(listWrap);

    root.appendChild(trigger);
    root.appendChild(menu);
    container.innerHTML = '';
    container.appendChild(root);

    function getLabelForValue(val) {
      for (var i = 0; i < options.length; i++) {
        if (String(options[i].value) === String(val)) return options[i].label;
      }
      return '';
    }

    function renderTrigger() {
      var label = selectedValue !== '' ? getLabelForValue(selectedValue) : placeholder;
      trigger.innerHTML = '<span class="dd-label">' + esc(label || placeholder) + '</span>' + chevronSVG;
    }

    function renderItems(filter) {
      filter = (filter || '').toLowerCase();
      var html = '';
      var count = 0;
      for (var i = 0; i < options.length; i++) {
        var opt = options[i];
        if (filter && opt.label.toLowerCase().indexOf(filter) === -1) continue;
        var sel = String(opt.value) === String(selectedValue) ? ' selected' : '';
        html += '<div class="erpai-dropdown-item' + sel + '" role="option" data-value="' + esc(String(opt.value)) + '">' + checkSVG + '<span>' + esc(opt.label) + '</span></div>';
        count++;
      }
      if (!count) html = '<div class="erpai-dropdown-empty">No results</div>';
      listWrap.innerHTML = html;
    }

    function open() {
      root.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      renderItems();
      if (searchInput) { searchInput.value = ''; searchInput.focus(); }
    }

    function close() {
      root.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function toggle() {
      root.classList.contains('open') ? close() : open();
    }

    // Events
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      // Close other dropdowns
      document.querySelectorAll('.erpai-dropdown.open').forEach(function (d) {
        if (d !== root) d.classList.remove('open');
      });
      toggle();
    });

    listWrap.addEventListener('click', function (e) {
      var item = e.target.closest('.erpai-dropdown-item');
      if (!item) return;
      selectedValue = item.getAttribute('data-value');
      renderTrigger();
      close();
      onChange(selectedValue, getLabelForValue(selectedValue));
    });

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        renderItems(searchInput.value);
      });
      searchInput.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    // Keyboard nav
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(); }
      if (e.key === 'Escape') close();
    });
    menu.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); trigger.focus(); }
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) close();
    });

    // Initial render
    renderTrigger();

    return {
      getValue: function () { return selectedValue; },
      setValue: function (val) { selectedValue = val; renderTrigger(); },
      setOptions: function (newOpts, keepValue) {
        options = newOpts || [];
        searchable = opts.searchable !== undefined ? opts.searchable : options.length > 6;
        if (!keepValue) { selectedValue = ''; }
        if (searchable && !searchInput) {
          searchInput = document.createElement('input');
          searchInput.type = 'text';
          searchInput.className = 'erpai-dropdown-search';
          searchInput.placeholder = 'Search\u2026';
          menu.insertBefore(searchInput, listWrap);
          searchInput.addEventListener('input', function () { renderItems(searchInput.value); });
          searchInput.addEventListener('click', function (e) { e.stopPropagation(); });
        }
        renderTrigger();
      },
      destroy: function () { container.innerHTML = ''; }
    };
  }

  /** Show loading state in #app */
  function showLoading(msg) {
    var el = document.getElementById('app');
    if (!el) return;
    el.innerHTML =
      '<div class="loading-container">' +
        '<div class="loading-text">' +
          '<div class="loading-title">' + esc(msg || 'Loading...') + '</div>' +
        '</div>' +
      '</div>';
  }

  /** Show error state in #app */
  function showError(msg) {
    var el = document.getElementById('app');
    if (!el) return;
    el.innerHTML =
      '<div class="error-container">' +
        '<h3>Error</h3>' +
        '<p>' + esc(msg) + '</p>' +
      '</div>';
  }

  /** Hide loading (clear #loading element if exists) */
  function hideLoading() {
    var el = document.getElementById('loading');
    if (el) el.style.display = 'none';
  }

  // ===== CHART HELPERS (require Chart.js loaded) =====

  var chart = {};

  function chartDefaults() {
    var tc = getThemeColors();
    return {
      scales: {
        x: { ticks: { color: tc.muted, font: { size: 11 } }, grid: { color: tc.border } },
        y: { ticks: { color: tc.muted, font: { size: 11 } }, grid: { color: tc.border } }
      },
      plugins: {
        legend: { labels: { color: tc.text, usePointStyle: true, boxWidth: 8, padding: 12, font: { size: 11 } } }
      }
    };
  }

  /** Bar chart. data = { labels, values, label?, colors? } */
  chart.bar = function (canvasId, data, extraOpts) {
    var tc = getThemeColors();
    var defs = chartDefaults();
    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [{
          label: data.label || '',
          data: data.values,
          backgroundColor: data.colors || tc.accent,
          borderRadius: 6
        }]
      },
      options: Object.assign({ responsive: true }, defs, extraOpts || {})
    });
  };

  /** Line chart. data = { labels, values, label?, color? } */
  chart.line = function (canvasId, data, extraOpts) {
    var tc = getThemeColors();
    var defs = chartDefaults();
    var color = data.color || tc.accent;
    return new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [{
          label: data.label || '',
          data: data.values,
          borderColor: color,
          backgroundColor: color + '1A',
          fill: true,
          tension: 0.3,
          pointRadius: 4
        }]
      },
      options: Object.assign({ responsive: true }, defs, extraOpts || {})
    });
  };

  /** Pie/doughnut chart. data = { labels, values, colors? }, type = 'pie'|'doughnut' */
  chart.pie = function (canvasId, data, extraOpts) {
    var tc = getThemeColors();
    var defaultColors = [tc.accent, tc.green, tc.amber, tc.red, tc.cyan, tc.purple, '#fb923c', '#f472b6'];
    return new Chart(document.getElementById(canvasId), {
      type: data.type || 'pie',
      data: {
        labels: data.labels,
        datasets: [{
          data: data.values,
          backgroundColor: data.colors || defaultColors.slice(0, data.labels.length),
          borderWidth: 0
        }]
      },
      options: Object.assign({
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: tc.text, padding: 12, usePointStyle: true, boxWidth: 8, font: { size: 11 } } }
        }
      }, extraOpts || {})
    });
  };

  chart.doughnut = function (canvasId, data, extraOpts) {
    data.type = 'doughnut';
    return chart.pie(canvasId, data, Object.assign({ cutout: '55%' }, extraOpts || {}));
  };

  // ===== EXPORT CSV =====

  function exportCSV(headers, rows, filename) {
    var csv = [headers].concat(rows).map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename || 'export.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ===== TABLE RENDERER =====

  /** Render a full data table from records API response.
   *  opts = { tableId, containerId, columns?, pageSize?, onRowClick? }
   */
  async function renderRecordTable(opts) {
    var tableId = opts.tableId;
    var containerId = opts.containerId;
    var pageSize = opts.pageSize || 25;
    var page = 1;

    // Get metadata
    var tableMeta = await getTable(tableId);
    var allCols = tableMeta.columnsMetaData || [];
    var columns = opts.columns
      ? allCols.filter(function (c) { return opts.columns.includes(c.id) || opts.columns.includes(c.name); })
      : allCols.filter(function (c) { return !c.hidden && !['CTDT','UTDT','CTBY','UTBY','SFID'].includes(c.id); });

    async function render(searchQuery) {
      var res = await getRecords(tableId, page, pageSize, searchQuery ? { q: searchQuery } : undefined);
      var container = document.getElementById(containerId);
      if (!container) return;

      var html =
        '<div class="flex-between mb-sm">' +
          '<input class="input" type="text" placeholder="Search..." style="max-width:280px;" id="' + containerId + '-search">' +
          '<span class="text-small">' + fmtNum(res.totalCount) + ' records</span>' +
        '</div>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr>' +
        columns.map(function (c) {
          var cls = ['number', 'currency'].includes(c.type) ? ' class="num"' : '';
          return '<th' + cls + '>' + esc(c.name) + '</th>';
        }).join('') +
        '</tr></thead><tbody>';

      // Default: if no onRowClick provided, auto-open records
      var hasRowClick = typeof opts.onRowClick === 'function';
      var clickable = hasRowClick || opts.onRowClick !== false;

      if (!res.data || res.data.length === 0) {
        html += '<tr><td colspan="' + columns.length + '" style="text-align:center;padding:24px;color:var(--text-muted);">No records found</td></tr>';
      } else {
        res.data.forEach(function (rec) {
          html += '<tr' + (clickable ? ' style="cursor:pointer;" data-id="' + rec._id + '"' : '') + '>';
          columns.forEach(function (c) {
            var cls = ['number', 'currency'].includes(c.type) ? ' class="num"' : '';
            html += '<td' + cls + '>' + formatCell(rec.cells[c.id], c.type, c) + '</td>';
          });
          html += '</tr>';
        });
      }

      html += '</tbody></table></div><div id="' + containerId + '-pag"></div>';
      container.innerHTML = html;

      // Pagination
      renderPagination(containerId + '-pag', {
        page: page, total: res.totalCount, pageSize: pageSize,
        onChange: function (p) { page = p; render(searchQuery); }
      });

      // Search
      var searchInput = document.getElementById(containerId + '-search');
      if (searchInput) {
        createSearch(searchInput, function (val) { page = 1; render(val); });
      }

      // Row click — custom handler or default open-record behavior
      if (clickable) {
        container.querySelectorAll('tr[data-id]').forEach(function (tr) {
          tr.addEventListener('click', function () {
            if (hasRowClick) {
              opts.onRowClick(tr.dataset.id);
            } else {
              openRecord(tableId, tr.dataset.id, { onSave: function () { render(searchQuery); } });
            }
          });
        });
      }
    }

    await render();
  }

  // ===== RECORD MODAL =====

  var SYSTEM_FIELDS = ['CTDT', 'UTDT', 'CTBY', 'UTBY', 'SFID'];
  var READONLY_TYPES = ['formula', 'rollup', 'auto_seq', 'auto_fill', 'lookup'];

  /** Get display-ready columns for a table (filter hidden + system) */
  function getVisibleColumns(tableMeta) {
    return (tableMeta.columnsMetaData || []).filter(function (c) {
      return !c.hidden && SYSTEM_FIELDS.indexOf(c.id) === -1;
    });
  }

  /** Check if a column type is inherently read-only */
  function isReadOnlyType(type) {
    return READONLY_TYPES.indexOf(type) !== -1;
  }

  /** Check if a column type needs a wide (full-row) layout */
  function isWideField(type) {
    return ['long_text', 'rich_text', 'json', 'text'].indexOf(type) !== -1;
  }

  /** Convert a date value to YYYY-MM-DD for input[type=date] */
  function toDateInput(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  }

  /** Build the HTML for a single form field */
  function buildFieldHtml(col, value, readOnly) {
    var type = col.type;
    var colReadOnly = readOnly || isReadOnlyType(type) || col.editable === false;
    var wrapCls = 'record-field' + (isWideField(type) ? ' record-field-wide' : '') + (colReadOnly ? ' record-field-readonly' : '');
    var label = '<div class="record-field-label">' + esc(col.name) + '</div>';
    var fieldId = 'rf-' + col.id;

    // Read-only display
    if (colReadOnly) {
      var display = formatCell(value, type, col);
      return '<div class="' + wrapCls + '">' + label + '<div class="record-field-value">' + display + '</div></div>';
    }

    var inputHtml = '';

    switch (type) {
      case 'text':
      case 'email':
      case 'url':
      case 'phone':
      case 'barcode': {
        var inputType = type === 'email' ? 'email' : type === 'url' ? 'url' : type === 'phone' ? 'tel' : 'text';
        inputHtml = '<input class="input" type="' + inputType + '" id="' + fieldId + '" value="' + esc(value || '') + '" data-col="' + col.id + '" data-type="' + type + '">';
        break;
      }
      case 'long_text': {
        inputHtml = '<textarea class="input" id="' + fieldId + '" data-col="' + col.id + '" data-type="long_text" rows="3">' + esc(value || '') + '</textarea>';
        break;
      }
      case 'number': {
        var numVal = value != null ? value : '';
        inputHtml = '<input class="input" type="number" step="any" id="' + fieldId + '" value="' + numVal + '" data-col="' + col.id + '" data-type="number">';
        break;
      }
      case 'date': {
        inputHtml = '<input class="input" type="date" id="' + fieldId + '" value="' + toDateInput(value) + '" data-col="' + col.id + '" data-type="date">';
        break;
      }
      case 'select': {
        var selVal = Array.isArray(value) ? value[0] : value;
        var options = (col.options || []);
        inputHtml = '<select class="input" id="' + fieldId + '" data-col="' + col.id + '" data-type="select">';
        inputHtml += '<option value="">— Select —</option>';
        options.forEach(function (opt) {
          var selected = opt.id === selVal ? ' selected' : '';
          inputHtml += '<option value="' + opt.id + '"' + selected + '>' + esc(opt.name) + '</option>';
        });
        inputHtml += '</select>';
        break;
      }
      case 'multi_select': {
        var msVal = Array.isArray(value) ? value : [];
        var msOpts = (col.options || []);
        inputHtml = '<div class="multi-select-wrap" id="' + fieldId + '" data-col="' + col.id + '" data-type="multi_select">';
        msOpts.forEach(function (opt) {
          var selCls = msVal.indexOf(opt.id) !== -1 ? ' selected' : '';
          inputHtml += '<span class="multi-select-chip' + selCls + '" data-val="' + opt.id + '">' + esc(opt.name) + '</span>';
        });
        inputHtml += '</div>';
        break;
      }
      case 'checkbox': {
        var checked = Array.isArray(value) && value[0] === 1 ? ' checked' : '';
        inputHtml = '<div class="checkbox-wrap"><input type="checkbox" id="' + fieldId + '" data-col="' + col.id + '" data-type="checkbox"' + checked + '><label for="' + fieldId + '">' + esc(col.name) + '</label></div>';
        break;
      }
      case 'rating': {
        var rating = Number(value) || 0;
        var maxStars = 5;
        inputHtml = '<div class="star-rating" id="' + fieldId + '" data-col="' + col.id + '" data-type="rating" data-value="' + rating + '">';
        for (var i = 1; i <= maxStars; i++) {
          inputHtml += '<span class="star' + (i <= rating ? ' filled' : '') + '" data-star="' + i + '">&#9733;</span>';
        }
        inputHtml += '</div>';
        break;
      }
      case 'user': {
        // User fields — show display name, read-only (can't pick users from custom page)
        var userDisplay = '';
        if (Array.isArray(value)) {
          userDisplay = value.map(function (u) { return typeof u === 'object' ? esc(u.name || u.email || u._id) : esc(String(u)); }).join(', ');
        } else if (value) {
          userDisplay = esc(typeof value === 'object' ? value.name || value.email || '' : String(value));
        }
        return '<div class="' + wrapCls.replace('record-field-readonly', '') + ' record-field-readonly">' + label + '<div class="record-field-value">' + (userDisplay || '<span style="color:var(--text-muted);">—</span>') + '</div></div>';
      }
      case 'ref':
      case 'reference': {
        // References — show display value, read-only for now
        var refDisplay = '';
        if (value && value._display) {
          refDisplay = esc(value._display);
        } else if (Array.isArray(value)) {
          refDisplay = value.length + ' linked record(s)';
        } else if (value) {
          refDisplay = esc(String(value));
        }
        return '<div class="' + wrapCls.replace('record-field-readonly', '') + ' record-field-readonly">' + label + '<div class="record-field-value">' + (refDisplay || '<span style="color:var(--text-muted);">—</span>') + '</div></div>';
      }
      case 'attachment': {
        var files = Array.isArray(value) ? value : [];
        var fileHtml = files.length === 0
          ? '<span style="color:var(--text-muted);">No files</span>'
          : files.map(function (f) { return '<span class="badge badge-default">' + esc(f.name || f.filename || 'file') + '</span>'; }).join(' ');
        return '<div class="' + wrapCls.replace('record-field-readonly', '') + ' record-field-readonly">' + label + '<div class="record-field-value">' + fileHtml + '</div></div>';
      }
      default: {
        inputHtml = '<input class="input" type="text" id="' + fieldId + '" value="' + esc(value != null ? String(value) : '') + '" data-col="' + col.id + '" data-type="' + type + '">';
        break;
      }
    }

    return '<div class="' + wrapCls + '">' + label + inputHtml + '</div>';
  }

  /** Collect changed values from the record modal form */
  function collectFormValues(columns, originalCells) {
    var changes = {};
    columns.forEach(function (col) {
      if (isReadOnlyType(col.type) || col.editable === false) return;
      var type = col.type;
      var fieldId = 'rf-' + col.id;
      var el = document.getElementById(fieldId);
      if (!el) return;

      var newVal;
      switch (type) {
        case 'number': {
          var raw = el.value;
          newVal = raw === '' ? null : parseFloat(raw);
          break;
        }
        case 'date': {
          newVal = el.value ? new Date(el.value + 'T00:00:00.000Z').toISOString() : null;
          break;
        }
        case 'select': {
          var sv = el.value;
          newVal = sv ? [parseInt(sv, 10)] : [];
          break;
        }
        case 'multi_select': {
          newVal = [];
          el.querySelectorAll('.multi-select-chip.selected').forEach(function (chip) {
            newVal.push(parseInt(chip.dataset.val, 10));
          });
          break;
        }
        case 'checkbox': {
          newVal = el.checked ? [1] : [0];
          break;
        }
        case 'rating': {
          newVal = parseInt(el.dataset.value, 10) || 0;
          break;
        }
        default: {
          newVal = el.value || el.textContent || '';
          break;
        }
      }

      // Only include changed values
      var orig = originalCells[col.id];
      if (JSON.stringify(newVal) !== JSON.stringify(orig)) {
        changes[col.id] = newVal;
      }
    });
    return changes;
  }

  /** Bind interactive event handlers inside the record modal */
  function bindModalInteractions(overlay) {
    // Multi-select chip toggling
    overlay.querySelectorAll('.multi-select-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        chip.classList.toggle('selected');
      });
    });

    // Star rating
    overlay.querySelectorAll('.star-rating').forEach(function (ratingEl) {
      ratingEl.querySelectorAll('.star').forEach(function (star) {
        star.addEventListener('click', function () {
          var val = parseInt(star.dataset.star, 10);
          // Toggle: clicking same star clears rating
          var current = parseInt(ratingEl.dataset.value, 10) || 0;
          var newVal = val === current ? 0 : val;
          ratingEl.dataset.value = newVal;
          ratingEl.querySelectorAll('.star').forEach(function (s) {
            s.classList.toggle('filled', parseInt(s.dataset.star, 10) <= newVal);
          });
        });
      });
    });
  }

  // ===== postMessage Bridge =====
  // When running inside erpai-dev iframe, delegate record opening/creating
  // to the parent frame which renders the real AddRecordPopup with full
  // entry form capabilities (formulas, validation, line items, etc.)

  /** Check if we're running inside an iframe (production) vs standalone (local testing) */
  function isInIframe() {
    try { return window.parent !== window; } catch (e) { return false; }
  }

  /** Active postMessage listener — only one at a time */
  var _bridgeHandler = null;

  /** Register a one-time listener for parent frame responses */
  function listenForBridgeResponse(opts) {
    // Remove previous listener if any
    if (_bridgeHandler) {
      window.removeEventListener('message', _bridgeHandler);
      _bridgeHandler = null;
    }
    _bridgeHandler = function (event) {
      var msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ERPAI_RECORD_SAVED') {
        window.removeEventListener('message', _bridgeHandler);
        _bridgeHandler = null;
        if (opts.onSave) opts.onSave(msg.recordId || '', {});
      } else if (msg.type === 'ERPAI_RECORD_CLOSED') {
        window.removeEventListener('message', _bridgeHandler);
        _bridgeHandler = null;
        if (opts.onClose) opts.onClose();
      }
    };
    window.addEventListener('message', _bridgeHandler);
  }

  /**
   * Open a record for viewing/editing.
   * In production (iframe): sends postMessage to parent, which renders the real AddRecordPopup.
   * In local testing (standalone): opens a self-contained fallback modal.
   * @param {string} tableId - Table ID
   * @param {string} recordId - Record ID
   * @param {object} [opts] - Options: { readOnly, onSave, onClose }
   */
  function openRecord(tableId, recordId, opts) {
    if (!opts) opts = {};

    if (isInIframe()) {
      // Delegate to parent frame (erpai-dev) for real AddRecordPopup
      window.parent.postMessage({
        type: 'ERPAI_OPEN_RECORD',
        tableId: tableId,
        recordId: recordId,
        viewOnly: opts.readOnly || false
      }, '*');
      listenForBridgeResponse(opts);
      return;
    }

    // Fallback: self-contained modal for local testing
    _openRecordFallback(tableId, recordId, opts);
  }

  /**
   * Open a blank create-record form.
   * In production (iframe): sends postMessage to parent for real AddRecordPopup in create mode.
   * In local testing (standalone): not supported (use the ERPAI UI directly).
   * @param {string} tableId - Table ID
   * @param {object} [opts] - Options: { initialData, onSave, onClose }
   */
  function openCreateForm(tableId, opts) {
    if (!opts) opts = {};

    if (isInIframe()) {
      window.parent.postMessage({
        type: 'ERPAI_CREATE_RECORD',
        tableId: tableId,
        initialData: opts.initialData || {}
      }, '*');
      listenForBridgeResponse(opts);
      return;
    }

    // Fallback: navigate to the table in ERPAI UI
    navigateTo('/table/' + tableId);
  }

  // ===== Fallback Record Modal (for local testing only) =====

  /**
   * Self-contained record modal — used when page runs outside iframe (local dev/testing).
   * Simple form with basic field types. In production, the real AddRecordPopup is used instead.
   */
  async function _openRecordFallback(tableId, recordId, opts) {
    if (!opts) opts = {};
    var readOnly = opts.readOnly || false;

    // Create overlay immediately with loading state
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'erpai-record-modal';
    overlay.innerHTML =
      '<div class="record-modal">' +
        '<div class="record-modal-loading">Loading record...</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // Close on overlay click (not modal click)
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    // Close on Escape
    function onEsc(e) { if (e.key === 'Escape') closeModal(); }
    document.addEventListener('keydown', onEsc);

    function closeModal() {
      document.removeEventListener('keydown', onEsc);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (opts.onClose) opts.onClose();
    }

    try {
      // Fetch table metadata + record in parallel
      var results = await Promise.all([getTable(tableId), getRecordById(tableId, recordId)]);
      var tableMeta = results[0];
      var record = results[1];
      if (!record) throw new Error('Record not found');

      var columns = getVisibleColumns(tableMeta);
      var cells = record.cells || {};
      var tableName = tableMeta.name || 'Record';

      // Find the primary/title column value for the header
      var primaryCol = columns.find(function (c) { return c.isPrimary; }) || columns[0];
      var recordTitle = primaryCol ? (cells[primaryCol.id] || recordId) : recordId;
      if (typeof recordTitle === 'object') recordTitle = recordTitle._display || recordId;

      // Build form fields
      var fieldsHtml = columns.map(function (col) {
        return buildFieldHtml(col, cells[col.id], readOnly);
      }).join('');

      // Build footer
      var footerHtml = '';
      if (!readOnly) {
        footerHtml =
          '<div class="record-modal-footer">' +
            '<div class="record-save-status" id="record-save-status"></div>' +
            '<button class="btn btn-secondary" id="record-close-btn">Close</button>' +
            '<button class="btn btn-primary" id="record-save-btn">Save</button>' +
          '</div>';
      } else {
        footerHtml =
          '<div class="record-modal-footer">' +
            '<button class="btn btn-secondary" id="record-close-btn">Close</button>' +
          '</div>';
      }

      // Render the full modal
      overlay.querySelector('.record-modal').innerHTML =
        '<div class="record-modal-header">' +
          '<div>' +
            '<div class="record-title">' + esc(String(recordTitle)) + '</div>' +
            '<div class="record-subtitle">' + esc(tableName) + '</div>' +
          '</div>' +
          '<button class="modal-close" id="record-x-btn">&times;</button>' +
        '</div>' +
        '<div class="record-modal-body">' +
          '<div class="record-form">' + fieldsHtml + '</div>' +
        '</div>' +
        footerHtml;

      // Bind close buttons
      overlay.querySelector('#record-x-btn').addEventListener('click', closeModal);
      overlay.querySelector('#record-close-btn').addEventListener('click', closeModal);

      // Bind interactive elements (multi-select chips, star ratings)
      bindModalInteractions(overlay);

      // Bind save button
      if (!readOnly) {
        overlay.querySelector('#record-save-btn').addEventListener('click', async function () {
          var saveBtn = overlay.querySelector('#record-save-btn');
          var statusEl = overlay.querySelector('#record-save-status');
          var changes = collectFormValues(columns, cells);

          if (Object.keys(changes).length === 0) {
            statusEl.textContent = 'No changes to save';
            setTimeout(function () { statusEl.textContent = ''; }, 2000);
            return;
          }

          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
          statusEl.textContent = '';

          try {
            await updateRecord(tableId, recordId, changes);
            statusEl.textContent = '\u2713 Saved';
            saveBtn.textContent = 'Save';
            saveBtn.disabled = false;
            // Update original cells so next diff is clean
            Object.keys(changes).forEach(function (k) { cells[k] = changes[k]; });
            if (opts.onSave) opts.onSave(recordId, changes);
            // Auto-close after a brief pause
            setTimeout(closeModal, 600);
          } catch (err) {
            statusEl.style.color = 'var(--red)';
            statusEl.textContent = 'Save failed: ' + err.message;
            saveBtn.textContent = 'Save';
            saveBtn.disabled = false;
          }
        });
      }

    } catch (err) {
      // Show error in the modal
      overlay.querySelector('.record-modal').innerHTML =
        '<div class="record-modal-header">' +
          '<div><div class="record-title">Error</div></div>' +
          '<button class="modal-close" id="record-x-btn">&times;</button>' +
        '</div>' +
        '<div class="record-modal-body">' +
          '<div class="error-container" style="padding:24px 0;"><p>' + esc(err.message) + '</p></div>' +
        '</div>' +
        '<div class="record-modal-footer">' +
          '<button class="btn btn-secondary" id="record-close-btn">Close</button>' +
        '</div>';
      overlay.querySelector('#record-x-btn').addEventListener('click', closeModal);
      overlay.querySelector('#record-close-btn').addEventListener('click', closeModal);
    }
  }

  // ===== DATA CACHE =====
  // Simple in-memory cache with TTL. Avoids refetching on tab switches, back-nav, etc.

  var _cache = {};
  var DEFAULT_TTL = 60000; // 1 minute

  /**
   * Get or fetch data with caching.
   * @param {string} key - Cache key (use descriptive keys like 'stats', 'table-xyz-page-1')
   * @param {function} fetcher - Async function that returns data
   * @param {number} [ttl] - Cache TTL in ms (default 60s). Pass 0 to skip cache.
   * @returns {Promise<{data: *, fromCache: boolean}>}
   */
  async function cached(key, fetcher, ttl) {
    if (ttl === undefined) ttl = DEFAULT_TTL;
    var entry = _cache[key];
    if (entry && ttl > 0 && (Date.now() - entry.time) < ttl) {
      return { data: entry.data, fromCache: true };
    }
    var data = await fetcher();
    if (ttl > 0) {
      _cache[key] = { data: data, time: Date.now() };
    }
    return { data: data, fromCache: false };
  }

  /** Invalidate a specific cache key or all keys matching a prefix */
  function invalidateCache(keyOrPrefix) {
    if (!keyOrPrefix) {
      _cache = {};
      return;
    }
    Object.keys(_cache).forEach(function (k) {
      if (k === keyOrPrefix || k.indexOf(keyOrPrefix) === 0) {
        delete _cache[k];
      }
    });
  }

  // ===== SECTION LOADING =====
  // Per-section loading states — avoids full-page spinner on data refresh.

  /**
   * Show a loading overlay on a specific section/container.
   * The container gets a spinner overlay while preserving existing content (no layout shift).
   * @param {string} containerId - Element ID
   */
  function sectionLoading(containerId) {
    var el = document.getElementById(containerId);
    if (el) el.classList.add('section-loading');
  }

  /** Remove loading overlay from a section */
  function sectionLoaded(containerId) {
    var el = document.getElementById(containerId);
    if (el) el.classList.remove('section-loading');
  }

  /**
   * Fade transition for content updates — dims content during fetch, restores after.
   * Prevents jarring innerHTML swaps. Usage:
   *   sectionUpdating('myTable');
   *   container.innerHTML = newHtml;
   *   sectionUpdated('myTable');
   */
  function sectionUpdating(containerId) {
    var el = document.getElementById(containerId);
    if (el) el.classList.add('section-fade', 'updating');
  }

  function sectionUpdated(containerId) {
    var el = document.getElementById(containerId);
    if (el) el.classList.remove('updating');
  }

  // ===== SKELETON GENERATORS =====
  // Generate placeholder HTML that matches the shape of real content.

  var skeleton = {};

  /** Generate N skeleton stat cards */
  skeleton.stats = function (count) {
    if (!count) count = 4;
    var html = '';
    for (var i = 0; i < count; i++) {
      html +=
        '<div class="stat-card-skeleton">' +
          '<div class="skeleton skeleton-text" style="width:60%;"></div>' +
          '<div class="skeleton skeleton-stat-value"></div>' +
          '<div class="skeleton skeleton-stat-sub"></div>' +
        '</div>';
    }
    return html;
  };

  /** Generate a skeleton table with N rows and M columns */
  skeleton.table = function (rows, cols) {
    if (!rows) rows = 5;
    if (!cols) cols = 4;
    var html = '<div class="table-wrap"><table class="data-table"><thead><tr>';
    for (var c = 0; c < cols; c++) {
      html += '<th><div class="skeleton skeleton-text" style="width:' + (60 + Math.random() * 30) + '%;margin:0;"></div></th>';
    }
    html += '</tr></thead><tbody>';
    for (var r = 0; r < rows; r++) {
      html += '<tr>';
      for (var c2 = 0; c2 < cols; c2++) {
        html += '<td><div class="skeleton skeleton-text" style="width:' + (40 + Math.random() * 50) + '%;margin:0;"></div></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
  };

  /** Generate a skeleton chart area */
  skeleton.chart = function () {
    return '<div class="skeleton skeleton-chart"></div>';
  };

  // ===== TAB MANAGER =====
  // Manages tab state, lazy-loads tab content, caches loaded tabs.

  /**
   * Initialize tabs with lazy loading.
   * @param {object} opts
   * @param {string} opts.containerId - Container with .tabs and tab content divs
   * @param {Array<{id: string, label: string, render: function}>} opts.tabs - Tab definitions
   * @param {string} [opts.defaultTab] - Initial active tab ID (defaults to first)
   */
  function initTabs(opts) {
    var container = document.getElementById(opts.containerId);
    if (!container) return;

    var tabs = opts.tabs;
    var activeTab = opts.defaultTab || tabs[0].id;
    var loadedTabs = {};

    // Build tab bar
    var tabBar = container.querySelector('.tabs');
    if (!tabBar) {
      tabBar = document.createElement('div');
      tabBar.className = 'tabs';
      container.insertBefore(tabBar, container.firstChild);
    }

    tabBar.innerHTML = tabs.map(function (t) {
      return '<div class="tab' + (t.id === activeTab ? ' active' : '') + '" data-tab="' + t.id + '">' + esc(t.label) + '</div>';
    }).join('');

    // Ensure content divs exist
    tabs.forEach(function (t) {
      var div = container.querySelector('[data-tab-content="' + t.id + '"]');
      if (!div) {
        div = document.createElement('div');
        div.setAttribute('data-tab-content', t.id);
        container.appendChild(div);
      }
      div.style.display = t.id === activeTab ? '' : 'none';
    });

    // Tab click handlers
    tabBar.addEventListener('click', function (e) {
      var tabEl = e.target.closest('.tab');
      if (!tabEl) return;
      var tabId = tabEl.dataset.tab;
      if (tabId === activeTab) return;

      // Update active state
      tabBar.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      tabEl.classList.add('active');

      // Show/hide content
      tabs.forEach(function (t) {
        var div = container.querySelector('[data-tab-content="' + t.id + '"]');
        if (div) div.style.display = t.id === tabId ? '' : 'none';
      });

      activeTab = tabId;

      // Lazy load if not yet loaded
      if (!loadedTabs[tabId]) {
        var tabDef = tabs.find(function (t) { return t.id === tabId; });
        if (tabDef && tabDef.render) {
          loadedTabs[tabId] = true;
          tabDef.render(container.querySelector('[data-tab-content="' + tabId + '"]'));
        }
      }
    });

    // Load initial tab
    var initialTab = tabs.find(function (t) { return t.id === activeTab; });
    if (initialTab && initialTab.render) {
      loadedTabs[activeTab] = true;
      initialTab.render(container.querySelector('[data-tab-content="' + activeTab + '"]'));
    }

    // Return API to programmatically switch tabs or reload
    return {
      switchTo: function (tabId) {
        var tabEl = tabBar.querySelector('[data-tab="' + tabId + '"]');
        if (tabEl) tabEl.click();
      },
      reload: function (tabId) {
        loadedTabs[tabId] = false;
        var tabDef = tabs.find(function (t) { return t.id === tabId; });
        if (tabDef && tabDef.render && tabId === activeTab) {
          loadedTabs[tabId] = true;
          tabDef.render(container.querySelector('[data-tab-content="' + tabId + '"]'));
        }
      },
      getActive: function () { return activeTab; }
    };
  }

  // ===== PARALLEL DATA LOADING =====

  /**
   * Load multiple data sources in parallel, rendering each section as it resolves.
   * Prevents the "everything loads at once" waterfall.
   * @param {Array<{id: string, fetch: function, render: function, skeleton?: string}>} sections
   */
  function loadSections(sections) {
    sections.forEach(function (section) {
      var el = document.getElementById(section.id);
      if (!el) return;

      // Show skeleton placeholder immediately
      if (section.skeleton) {
        el.innerHTML = section.skeleton;
      } else {
        sectionLoading(section.id);
      }

      // Fetch and render independently
      section.fetch().then(function (data) {
        sectionLoaded(section.id);
        section.render(el, data);
      }).catch(function (err) {
        sectionLoaded(section.id);
        el.innerHTML = '<div class="error-container" style="padding:16px;"><p>' + esc(err.message) + '</p></div>';
      });
    });
  }

  // ===== PUBLIC API =====
  // ===== PREFETCH / HYDRATION =====

  /** Pre-fetched data injected by the server (page-hydration.service.ts) */
  var PREFETCHED = window.__ERPAI_DATA__ || null;

  /**
   * Get pre-fetched data by key.
   * Returns the data payload if available, or null.
   * Use this to avoid redundant API calls when the server already fetched the data.
   */
  function getData(key) {
    if (!PREFETCHED || !PREFETCHED[key]) return null;
    if (PREFETCHED[key].error) return null;
    return PREFETCHED[key].data;
  }

  /**
   * Check if a specific prefetch key exists and loaded successfully.
   */
  function hasData(key) {
    return !!(PREFETCHED && PREFETCHED[key] && !PREFETCHED[key].error);
  }

  /**
   * Render with prefetched data immediately, then refresh in background.
   * @param {string} key - The prefetch key from <script type="erpai/data">
   * @param {Function} fetcher - Async function that fetches fresh data
   * @param {Function} renderer - Function that renders data to the DOM
   * @returns {Promise<*>} The fresh data
   */
  async function withPrefetch(key, fetcher, renderer) {
    var prefetched = getData(key);
    if (prefetched) {
      renderer(prefetched);
    }
    var fresh = await fetcher();
    if (!prefetched || JSON.stringify(fresh) !== JSON.stringify(prefetched)) {
      renderer(fresh);
    }
    return fresh;
  }

  /**
   * Prefetch-aware runSQL. Checks __ERPAI_DATA__ for matching SQL results first.
   * Falls back to the API if not found.
   */
  var _originalRunSQL = runSQL;
  runSQL = async function runSQLWithPrefetch(query) {
    if (PREFETCHED) {
      var keys = Object.keys(PREFETCHED);
      for (var i = 0; i < keys.length; i++) {
        var entry = PREFETCHED[keys[i]];
        if (entry && entry._type === 'sql' && entry._query === query && !entry.error) {
          return entry.data;
        }
      }
    }
    return _originalRunSQL(query);
  };

  /**
   * Prefetch-aware getRecords. Checks __ERPAI_DATA__ for matching table results first.
   */
  var _originalGetRecords = getRecords;
  getRecords = async function getRecordsWithPrefetch(tableId, pageNo, pageSize, filter) {
    // Only use prefetch for first page with no filters (the common dashboard case)
    if (PREFETCHED && (!pageNo || pageNo === 1) && (!filter || (!filter.q && !filter.filterCriteria))) {
      var keys = Object.keys(PREFETCHED);
      for (var i = 0; i < keys.length; i++) {
        var entry = PREFETCHED[keys[i]];
        if (entry && entry._type === 'records' && entry._tableId === tableId && !entry.error) {
          // Hydrated data may be unwrapped array or full paginated object — normalize
          var d = entry.data;
          if (Array.isArray(d)) {
            return { totalCount: d.length, data: d, pageNo: 1, pageSize: d.length };
          }
          return d;
        }
      }
    }
    return _originalGetRecords(tableId, pageNo, pageSize, filter);
  };

  /**
   * Prefetch-aware getTable. Checks __ERPAI_DATA__ for matching table metadata first.
   */
  var _originalGetTable = getTable;
  getTable = async function getTableWithPrefetch(tableId) {
    if (PREFETCHED) {
      var keys = Object.keys(PREFETCHED);
      for (var i = 0; i < keys.length; i++) {
        var entry = PREFETCHED[keys[i]];
        if (entry && entry._type === 'table' && entry._tableId === tableId && !entry.error) {
          return entry.data;
        }
      }
    }
    return _originalGetTable(tableId);
  };

  /**
   * Invalidate the server-side page data cache for this app.
   * @param {string[]} [slugs] - Specific page slugs to invalidate. If omitted, invalidates all.
   */
  async function invalidatePageCache(slugs) {
    return api('POST', '/v1/agent/app/custom-pages/invalidate-cache', {
      appId: APP_ID,
      slugs: slugs || undefined
    });
  }

  window.erpai = {
    // Config
    config: cfg,
    appId: APP_ID,
    baseUrl: BASE_URL,
    theme: THEME,
    orgName: ORG_NAME,
    appName: APP_NAME,

    // API
    api: api,
    runSQL: runSQL,
    getTables: getTables,
    getTable: getTable,
    getRecordById: getRecordById,
    getRecords: getRecords,
    createRecord: createRecord,
    updateRecord: updateRecord,
    deleteRecord: deleteRecord,
    getSQLSchema: getSQLSchema,

    // Navigation
    erpaiUrl: erpaiUrl,
    navigateTo: navigateTo,

    // Formatters
    esc: esc,
    fmt$: fmt$,
    fmtPct: fmtPct,
    fmtNum: fmtNum,
    fmtDate: fmtDate,
    formatCell: formatCell,

    // Theme
    getThemeColors: getThemeColors,

    // UI helpers
    renderStatCard: renderStatCard,
    renderPagination: renderPagination,
    renderRecordTable: renderRecordTable,
    createSearch: createSearch,
    createDropdown: createDropdown,
    icon: icon,
    hasIcon: hasIcon,
    listIcons: listIcons,
    showLoading: showLoading,
    showError: showError,
    hideLoading: hideLoading,
    exportCSV: exportCSV,

    // State management
    cached: cached,
    invalidateCache: invalidateCache,
    sectionLoading: sectionLoading,
    sectionLoaded: sectionLoaded,
    sectionUpdating: sectionUpdating,
    sectionUpdated: sectionUpdated,
    loadSections: loadSections,

    // Skeleton generators
    skeleton: skeleton,

    // Tabs
    initTabs: initTabs,

    // Record modal (bridge to parent in iframe, fallback modal for local testing)
    openRecord: openRecord,
    openCreateForm: openCreateForm,

    // Charts
    chart: chart,

    // Prefetch / Hydration
    getData: getData,
    hasData: hasData,
    withPrefetch: withPrefetch,
    invalidatePageCache: invalidatePageCache
  };
})();
