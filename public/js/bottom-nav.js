// Phase 3 — Bottom nav removed per design spec.
// Main operational cards on Home page serve as navigation.
// This file is intentionally near-empty for backward compatibility.
(function() {
  // Hide any legacy .tab-bar from old pages
  function cleanup() {
    document.querySelectorAll('.tab-bar').forEach(el => el.style.display = 'none');
    document.body.style.paddingBottom = '20px';
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cleanup);
  } else {
    cleanup();
  }
})();
