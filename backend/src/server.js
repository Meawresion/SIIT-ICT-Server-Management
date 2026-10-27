import app from './app.js';
import env, { checkEnv } from './config/env.js';
import { loadIdentityRules } from './config/identity.js';

// Fail at start, not at the first request, when settings are missing or wrong.
checkEnv();
loadIdentityRules();

const port = env.port;

app.listen(port, () => {
  console.log(`Server running on port ${port} (${env.node_env})`);
});
