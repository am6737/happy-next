const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const directory = process.env.AI_TEAM_ACK_BARRIER_DIR;
if (!directory || !/^\/tmp\/ai-team-managed-[A-Za-z0-9_-]+$/.test(directory)) {
    throw new Error('Owned ACK barrier directory required');
}
const serverRoot = process.env.AI_TEAM_ACK_BARRIER_SERVER_ROOT;
if (!serverRoot || !/^\/tmp\/ai-team-frozen-deps-[A-Za-z0-9]+\/packages\/happy-server$/.test(serverRoot)
    || fs.realpathSync(serverRoot) !== serverRoot) {
    throw new Error('Bound fresh Server root required for ACK barrier');
}
const { Socket } = createRequire(path.join(serverRoot, 'package.json'))('socket.io');

const original = Socket.prototype.emitWithAck;
Socket.prototype.emitWithAck = function (event, ...args) {
    const reply = original.call(this, event, ...args);
    const request = args[0];
    if (event !== 'rpc-request'
        || typeof request?.method !== 'string'
        || !request.method.endsWith(':orchestrator-cancel')) return reply;
    return Promise.resolve(reply).then(async (value) => {
        fs.writeFileSync(path.join(directory, 'cancel-ack-returned'), '', { flag: 'wx', mode: 0o600 });
        const release = path.join(directory, 'cancel-ack-release');
        const deadline = Date.now() + 20_000;
        while (!fs.existsSync(release)) {
            if (Date.now() >= deadline) throw new Error('Owned ACK barrier timed out');
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return value;
    });
};
