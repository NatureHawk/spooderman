'use strict';
/* node tests/life/eval.js "<js expression>" [html]   -> prints JSON of the expression evaluated in the running game */
const { open } = require('./lib.js');
(async () => {
  const { b, p } = await open({ html: process.argv[3] });
  try { console.log(JSON.stringify(await p.evaluate(process.argv[2]), null, 1)); } finally { await b.close(); }
})();
