import app from './app.js';
import env from './config/env.js';
import { loadIdentityRules } from './config/identity.js';

// Fail at start, not at the first sign-in, when the sign-in settings are missing or wrong.
loadIdentityRules();

const port = env.port;

app.listen(port, () => {
  console.log(`Server running on port ${port} (${env.node_env})`);
});
