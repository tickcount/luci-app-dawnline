import { defineConfig } from 'vitest/config';
import { catalogOf, parsePo } from './i18n/po.ts';

export default defineConfig({
  // A .po the portal imports is its lookup table, as in the bundle (tsup.config.ts).
  plugins: [
    {
      name: 'po-catalog',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('.po')) return { code: `export default ${JSON.stringify(catalogOf(parsePo(code)))};`, map: null };
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
