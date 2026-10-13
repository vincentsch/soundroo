// Preloaded with --import: any outbound connection, DNS lookup of another
// host or fetch is reported on stderr and fails, so tests can prove a command
// stayed offline. Resolving the loopback address the studio listens on is
// allowed; it involves no network.
import net from 'node:net';
import dns from 'node:dns';

const refuse = what => { process.stderr.write(`NETWORK ATTEMPT: ${what}\n`); throw new Error('This test forbids network access.'); };
const loopback = host => ['127.0.0.1', '::1', 'localhost'].includes(String(host));
const lookup = dns.lookup;
net.Socket.prototype.connect = function connect() { refuse('socket'); };
dns.lookup = (host, ...args) => (loopback(host) ? lookup(host, ...args) : refuse(`dns ${host}`));
dns.promises.lookup = async host => refuse(`dns ${host}`);
globalThis.fetch = async url => refuse(`fetch ${url}`);
