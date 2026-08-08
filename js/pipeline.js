/* QuantisAI BoQ pipeline compatibility wrapper. Preserve the existing pipeline implementation under pipeline-core.js, then load the deterministic BoQ hardening layer before app.js starts. */
document.write('<script src="js/pipeline-core.js"><\/script>');
document.write('<script src="js/boq-engine.js"><\/script>');
document.write('<script src="js/boq-hardening.js"><\/script>');