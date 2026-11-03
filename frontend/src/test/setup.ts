import '@testing-library/jest-dom/vitest';

// Radix menus and selects settle asynchronously; under a loaded machine the 1 s default flakes.
import { configure } from '@testing-library/react';
configure({ asyncUtilTimeout: 4000 });
