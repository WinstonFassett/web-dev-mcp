/**
 * Server Registry - tracks dev servers registered with the gateway
 */
export class ServerRegistry {
    servers = new Map();
    connectionOrder = [];
    add(server) {
        this.servers.set(server.id, server);
        // Track connection order
        const index = this.connectionOrder.indexOf(server.id);
        if (index !== -1) {
            this.connectionOrder.splice(index, 1);
        }
        this.connectionOrder.push(server.id);
        console.log(`[registry] Registered: ${server.id} (${server.type}) at :${server.port}`);
    }
    remove(id) {
        const server = this.servers.get(id);
        if (server) {
            this.servers.delete(id);
            const index = this.connectionOrder.indexOf(id);
            if (index !== -1) {
                this.connectionOrder.splice(index, 1);
            }
            console.log(`[registry] Removed: ${id}`);
        }
    }
    get(id) {
        return this.servers.get(id);
    }
    getAll() {
        return Array.from(this.servers.values());
    }
    getByType(type) {
        return this.getAll().filter(s => s.type === type);
    }
    getByPort(port) {
        return this.getAll().find(s => s.port === port);
    }
    getLatest() {
        if (this.connectionOrder.length === 0)
            return undefined;
        const latestId = this.connectionOrder[this.connectionOrder.length - 1];
        return this.servers.get(latestId);
    }
    has(id) {
        return this.servers.has(id);
    }
    size() {
        return this.servers.size;
    }
    /**
     * Remove servers whose processes are no longer running
     */
    cleanupDeadServers() {
        let removed = 0;
        for (const server of this.getAll()) {
            try {
                // Check if process is still alive (signal 0 doesn't actually send a signal)
                process.kill(server.pid, 0);
            }
            catch (err) {
                // Process doesn't exist
                this.remove(server.id);
                removed++;
            }
        }
        return removed;
    }
}
//# sourceMappingURL=registry.js.map