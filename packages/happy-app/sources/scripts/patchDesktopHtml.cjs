const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.join(process.cwd(), 'dist', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const bootstrapMarkup = `
    <script src="/desktop-bootstrap-theme.js"></script>
    <style id="happy-desktop-bootstrap">
      :root {
        --happy-bootstrap-background: #f5f5f5;
        color-scheme: light dark;
      }
      html, body, #root {
        min-height: 100%;
        background-color: var(--happy-bootstrap-background);
      }
      @media (prefers-color-scheme: dark) {
        :root { --happy-bootstrap-background: #1e1e1e; }
      }
      :root[data-happy-bootstrap-theme='light'] {
        --happy-bootstrap-background: #f5f5f5;
        color-scheme: light;
      }
      :root[data-happy-bootstrap-theme='dark'] {
        --happy-bootstrap-background: #1e1e1e;
        color-scheme: dark;
      }
    </style>
`;

if (!html.includes('id="happy-desktop-bootstrap"')) {
  if (!html.includes('</head>')) {
    throw new Error('Unable to patch desktop HTML: </head> was not found');
  }
  html = html.replace('</head>', `${bootstrapMarkup}</head>`);
  fs.writeFileSync(htmlPath, html);
}
