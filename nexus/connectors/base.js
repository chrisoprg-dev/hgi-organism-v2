export class ReadOnlyConnector {
  constructor(name) {
    this.name = name;
  }

  async readChanges() {
    return [];
  }

  async write() {
    throw Object.assign(new Error(`External writes are disabled for connector ${this.name}`), {
      code: 'NEXUS_EXTERNAL_WRITE_BLOCKED',
    });
  }
}

export function assertReadOnlyConnector(connector) {
  if (!connector || typeof connector.readChanges !== 'function' || typeof connector.write !== 'function') {
    throw new Error('Connector must implement readChanges() and write()');
  }
  return connector;
}
