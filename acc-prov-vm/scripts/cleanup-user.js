// ADMIN ONLY: deletes one student's accounts everywhere (pfSense VPN user, Linux user + home on
// every GPU and Hadoop node, the HDFS home). The worker never deletes (D16); this is for the admin
// to run by hand, for example to remove the throwaway test user st9990000001.
//
//   npm run cleanup-user -- <username> --fullname "<Full Name>"          check only, changes nothing
//   npm run cleanup-user -- <username> --fullname "<Full Name>" --yes    check, ask, then delete
//
// The check prints what exists on every system. With --yes it then asks you to type the username,
// checks everything again and deletes, printing each step. An account whose full name differs is
// never deleted. Exit code 0 only when nothing was skipped and nothing failed.
// Systems not configured in .env (PFSENSE_*, GPU_NODES_FILE, BIGDATA_FILE) are skipped.

import { createInterface } from 'node:readline/promises';
import { cleanupUser } from '../src/cleanup.js';
import { loadBigDataConfig, loadGpuConfig, loadPfSenseConfig } from '../src/config.js';
import { connectGpuNode } from '../src/gpu.js';
import { connectHadoopNode } from '../src/hadoop.js';
import { withPfSense } from '../src/pfsense.js';
import { USERNAME_RE } from '../src/validate.js';

const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--fullname');
const fullName = args.includes('--fullname') ? args[args.indexOf('--fullname') + 1] : undefined;
const apply = args.includes('--yes');
if (!USERNAME_RE.test(username ?? '') || !fullName?.trim()) {
  console.error('usage: npm run cleanup-user -- <st|stm|std + student ID> --fullname "<Full Name>" [--yes]');
  process.exit(2);
}

const out = (line) => console.log(`${new Date().toISOString()} ${line}`);
const optional = (name, load) => {
  try {
    return load();
  } catch (err) {
    out(`CONFIG ${name}: not used (${err.message})`);
    return null;
  }
};

const pf = optional('pfSense', () => loadPfSenseConfig());
const gpu = process.env.GPU_NODES_FILE ? loadGpuConfig() : null;
const bigData = loadBigDataConfig();
const deps = {
  pfsense: pf && ((fn) => withPfSense(pf, fn)),
  linuxNodes: [
    ...(gpu?.nodes ?? []).map((n) => ({ label: `gpu ${n.name} ${n.host}`, connect: () => connectGpuNode(n) })),
    ...(bigData?.nodes ?? []).map((n) => ({ label: `hadoop ${n.name} ${n.host}`, connect: () => connectHadoopNode(n) })),
  ],
  hdfs: bigData && (() => {
    const n = bigData.nodes.find((x) => x.hdfsHome);
    return { label: `hdfs via ${n.name}`, connect: () => connectHadoopNode(n), settings: bigData.hdfs };
  })(),
  hue: process.env.HUE_ENABLED === 'true',
};

out(`START cleanup of ${username} ("${fullName}") on: ${[pf && 'pfSense', ...deps.linuxNodes.map((n) => n.label), deps.hdfs?.label]
  .filter(Boolean).join('; ')}`);
const checked = await cleanupUser({ username, fullName, apply: false, deps, out });
let result = checked;

if (apply) {
  if (!checked.wouldDelete) {
    out('NOTHING to delete');
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await rl.question(`Type ${username} to delete everything marked "would delete" above: `)).trim();
    rl.close();
    if (typed !== username) {
      out('STOPPED: the name you typed does not match; nothing was deleted');
      process.exit(1);
    }
    result = await cleanupUser({ username, fullName, apply: true, deps, out });
  }
} else {
  out('CHECK ONLY: nothing was changed. Add --yes to delete.');
}
out('END');
process.exit(result.skipped || result.failed ? 1 : 0);
