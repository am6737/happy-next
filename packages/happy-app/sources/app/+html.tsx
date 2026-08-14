import { ScrollViewStyleReset } from 'expo-router/html';
import '../unistyles';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* 
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native. 
          However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
        */}
        <ScrollViewStyleReset />

        {/* Apply the persisted theme before the main bundle starts. */}
        <script src="/desktop-bootstrap-theme.js" />

        {/* Using raw CSS styles as an escape-hatch to ensure the background color never flickers in dark-mode. */}
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        {/* Add any additional <head> elements that you want globally available on web... */}
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
:root {
  --happy-bootstrap-background: #f5f5f5;
  color-scheme: light dark;
}
html,
body,
#root {
  min-height: 100%;
  background-color: var(--happy-bootstrap-background);
}
@media (prefers-color-scheme: dark) {
  :root {
    --happy-bootstrap-background: #1e1e1e;
  }
}
:root[data-happy-bootstrap-theme='light'] {
  --happy-bootstrap-background: #f5f5f5;
  color-scheme: light;
}
:root[data-happy-bootstrap-theme='dark'] {
  --happy-bootstrap-background: #1e1e1e;
  color-scheme: dark;
}`;
