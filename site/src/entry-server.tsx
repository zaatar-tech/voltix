import { renderToString } from 'react-dom/server';
import App, { setSsrPath } from './App';

export function render(path: string): string {
  setSsrPath(path);
  return renderToString(<App />);
}
