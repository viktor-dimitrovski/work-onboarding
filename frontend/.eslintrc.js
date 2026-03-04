module.exports = {
  extends: ['next/core-web-vitals'],
  rules: {
    // This codebase intentionally uses the "run on specific deps, not on function identity" pattern.
    // load/loadX functions are plain async functions (not useCallback) called from useEffect — adding
    // them to deps would cause infinite re-renders. Suppressed project-wide.
    'react-hooks/exhaustive-deps': 'off',
  },
};
